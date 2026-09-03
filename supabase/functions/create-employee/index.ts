import { createClient } from 'npm:@supabase/supabase-js@2';

const EMPLOYEE_EMAIL_DOMAIN = 'employee.local';
const USERNAME_PATTERN = /^[a-z0-9_.]{3,20}$/;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status: number) {
  console.log(`[create-employee] responding ${status}`, body);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  console.log('[create-employee] request received');

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'Missing authorization header' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user: caller },
    error: callerError,
  } = await callerClient.auth.getUser();

  if (callerError || !caller) {
    console.error('[create-employee] caller auth check failed', callerError);
    return json({ error: 'Not authenticated' }, 401);
  }

  console.log('[create-employee] caller authenticated', { callerId: caller.id });

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from('profiles')
    .select('company_id, role')
    .eq('id', caller.id)
    .single();

  if (callerProfileError || !callerProfile) {
    console.error('[create-employee] caller profile lookup failed', callerProfileError);
    return json({ error: 'Profile not found' }, 403);
  }

  if (callerProfile.role !== 'chef') {
    console.warn('[create-employee] caller is not a chef', { callerId: caller.id, role: callerProfile.role });
    return json({ error: 'Only a chef can create employees' }, 403);
  }

  const body = await req.json().catch(() => null);
  const firstName = body?.firstName?.trim();
  const lastName = body?.lastName?.trim();
  const phone = body?.phone?.trim() || null;
  const username = body?.username?.trim().toLowerCase();
  const password = body?.password;

  console.log('[create-employee] parsed body', {
    firstName,
    lastName,
    phone,
    username,
    passwordLength: typeof password === 'string' ? password.length : null,
  });

  if (!firstName || !lastName || !username || !password) {
    console.warn('[create-employee] missing required fields');
    return json({ error: 'Missing required fields' }, 400);
  }

  if (!USERNAME_PATTERN.test(username)) {
    console.warn('[create-employee] username failed pattern check', { username });
    return json(
      { error: 'Username must be 3-20 characters: lowercase letters, numbers, "_" or "."' },
      400
    );
  }

  if (String(password).length < 6) {
    console.warn('[create-employee] password too short');
    return json({ error: 'Password must be at least 6 characters' }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const email = `${username}@${EMPLOYEE_EMAIL_DOMAIN}`;

  console.log('[create-employee] creating auth user', { email });
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    console.error('[create-employee] admin.createUser failed', createError);
    if (createError?.message?.toLowerCase().includes('already been registered')) {
      return json({ error: 'That username is already taken' }, 409);
    }
    return json({ error: createError?.message ?? 'Could not create employee account' }, 400);
  }

  console.log('[create-employee] auth user created', { userId: created.user.id, email });

  const { data: newProfile, error: profileError } = await adminClient
    .from('profiles')
    .insert({
      id: created.user.id,
      company_id: callerProfile.company_id,
      first_name: firstName,
      last_name: lastName,
      role: 'employee',
      phone,
      username,
      employee_password: password,
    })
    .select('id, first_name, last_name, phone, username, role')
    .single();

  if (profileError) {
    console.error('[create-employee] profile insert failed, rolling back auth user', {
      userId: created.user.id,
      profileError,
    });
    const { error: rollbackError } = await adminClient.auth.admin.deleteUser(created.user.id);
    if (rollbackError) {
      console.error(
        '[create-employee] ROLLBACK FAILED — an orphaned auth user with no profile now exists ' +
          'and will be able to sign in but the app will treat them as having no profile',
        { userId: created.user.id, email, rollbackError }
      );
    } else {
      console.log('[create-employee] rollback succeeded, auth user removed', { userId: created.user.id });
    }
    return json({ error: profileError.message }, 400);
  }

  console.log('[create-employee] success', { userId: created.user.id, username, email });
  return json({ profile: newProfile }, 200);
});
