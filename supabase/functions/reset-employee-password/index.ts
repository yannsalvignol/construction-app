import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status: number) {
  console.log(`[reset-employee-password] responding ${status}`, body);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  console.log('[reset-employee-password] request received');

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
    console.error('[reset-employee-password] caller auth check failed', callerError);
    return json({ error: 'Not authenticated' }, 401);
  }

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from('profiles')
    .select('company_id, role')
    .eq('id', caller.id)
    .single();

  if (callerProfileError || !callerProfile || callerProfile.role !== 'chef') {
    console.error('[reset-employee-password] caller is not an authorized chef', {
      callerId: caller.id,
      callerProfileError,
    });
    return json({ error: 'Only a chef can reset an employee password' }, 403);
  }

  const body = await req.json().catch(() => null);
  const employeeId = body?.employeeId;
  const password = body?.password;

  console.log('[reset-employee-password] parsed body', {
    employeeId,
    passwordLength: typeof password === 'string' ? password.length : null,
  });

  if (!employeeId || !password) {
    return json({ error: 'Missing required fields' }, 400);
  }

  if (String(password).length < 6) {
    return json({ error: 'Password must be at least 6 characters' }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: employee, error: employeeError } = await adminClient
    .from('profiles')
    .select('id, company_id, role')
    .eq('id', employeeId)
    .single();

  if (employeeError || !employee) {
    console.error('[reset-employee-password] employee not found', { employeeId, employeeError });
    return json({ error: 'Employee not found' }, 404);
  }

  if (employee.role !== 'employee' || employee.company_id !== callerProfile.company_id) {
    console.warn('[reset-employee-password] caller not authorized for this employee', {
      callerId: caller.id,
      employeeId,
    });
    return json({ error: 'Not authorized to reset this employee' }, 403);
  }

  console.log('[reset-employee-password] updating auth password', { employeeId });
  const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(employeeId, {
    password,
  });

  if (updateAuthError) {
    console.error('[reset-employee-password] auth password update failed', {
      employeeId,
      updateAuthError,
    });
    return json({ error: updateAuthError.message }, 400);
  }

  console.log('[reset-employee-password] auth password updated, syncing display copy', { employeeId });
  const { error: updateProfileError } = await adminClient
    .from('profiles')
    .update({ employee_password: password })
    .eq('id', employeeId);

  if (updateProfileError) {
    console.error(
      '[reset-employee-password] AUTH PASSWORD WAS CHANGED but the profiles.employee_password ' +
        'display copy failed to update — the chef will see a stale password on screen that no ' +
        'longer matches what the employee must actually use to sign in',
      { employeeId, updateProfileError }
    );
    return json({ error: updateProfileError.message }, 400);
  }

  console.log('[reset-employee-password] success', { employeeId });
  return json({ ok: true }, 200);
});
