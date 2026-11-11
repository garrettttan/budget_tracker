// Sync now: the button in Settings → Bank connection.
//
// Auth: the signed-in user's Supabase JWT (verify_jwt = true). Runs the same
// sync as the daily `sync` function, for this user's connection only, logged
// as a manual run. runSync's guard still caps SimpleFIN at 12 requests per
// 24 h and skips a day after a rate-limit warning, so repeated taps can't put
// the Access Token at risk.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { preflight, reply, signedInUser } from '../_shared/http.ts';
import { type Connection, runSync } from '../_shared/run-sync.ts';
import { messages } from '../_shared/messages.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;
  if (req.method !== 'POST') return reply({ error: messages.usePost }, 405);

  const user = await signedInUser(admin, req);
  if (!user) return reply({ error: messages.signInAgain }, 401);

  const { data: connections, error } = await admin
    .from('connections')
    .select('id, user_id, status')
    .eq('user_id', user.id)
    .neq('status', 'disabled');
  if (error) return reply({ error: messages.loadConnectionFailed }, 500);
  if (!connections.length) return reply({ error: messages.noConnection }, 400);

  // one connection per user today; sync each if that ever changes
  const results = [];
  for (const conn of connections as Connection[]) results.push(await runSync(admin, conn, 'manual'));
  return reply({ sync: results[0] });
});
