// A URL import, not an `npm:` specifier: this directory carries a package.json so
// the Node test runner can load handler.ts, and that file makes Deno switch to
// node_modules resolution, which the deploy bundler cannot satisfy.
// eslint-disable-next-line import/no-unresolved -- resolved by Deno at deploy time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createPresenceHandler } from './handler.ts';

// Cron uses a dedicated secret. Mobile clients cannot invoke this worker.
Deno.serve(createPresenceHandler({
  secret: Deno.env.get('PRESENCE_DISPATCH_SECRET'),
  expoAccessToken: Deno.env.get('EXPO_ACCESS_TOKEN'),
  createDatabase: () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
}));
