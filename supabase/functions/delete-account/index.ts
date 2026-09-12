import { createClient } from 'npm:@supabase/supabase-js@2';

// Self-service account deletion (App Store 5.1.1(v), Play account-deletion policy).
//
// The database function delete_own_account() does the actual deletion as the
// caller and returns the Storage paths it orphaned. SQL cannot remove Storage
// bytes, and the caller's own credentials stop working the moment their auth
// user is gone, so this function finishes the job with the service role.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status: number) {
  console.log(`[delete-account] responding ${status}`, body);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

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
    console.error('[delete-account] caller auth check failed', callerError);
    return json({ error: 'Not authenticated' }, 401);
  }

  console.log('[delete-account] deleting account', { callerId: caller.id });

  // Runs as the caller: the function only ever deletes auth.uid().
  const { data, error } = await callerClient.rpc('delete_own_account');
  if (error) {
    console.error('[delete-account] delete_own_account failed', error);
    return json({ error: error.message }, 400);
  }

  const files: { bucket: string; path: string }[] = data?.files ?? [];
  if (files.length > 0) {
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const byBucket = new Map<string, string[]>();
    for (const file of files) {
      byBucket.set(file.bucket, [...(byBucket.get(file.bucket) ?? []), file.path]);
    }
    for (const [bucket, paths] of byBucket) {
      const { error: removeError } = await adminClient.storage.from(bucket).remove(paths);
      if (removeError) {
        // The account is already gone; the presence worker's orphan sweep will
        // retry the proofs, so this is logged rather than reported as a failure.
        console.error('[delete-account] storage removal failed', { bucket, count: paths.length, removeError });
      } else {
        console.log('[delete-account] storage removed', { bucket, count: paths.length });
      }
    }
  }

  return json({ ok: true }, 200);
});
