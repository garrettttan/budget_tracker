// Sync now: the button in Settings → Bank connection.
//
// Auth: the signed-in user's Supabase JWT (verify_jwt = true). Runs the same
// sync as the daily `sync` function, for this user's connection only, logged
// as a manual run. runSync's guard still caps SimpleFIN at 12 requests per
// 24 h and skips a day after a rate-limit warning, so repeated taps can't put
// the Access Token at risk.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { type Connection, runSync } from '../_shared/run-sync.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const CORS = {
  'Access-Control-Allow-Origin': '*', // auth is a bearer token, not cookies
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const { data } = await admin.auth.getUser(jwt);
  if (!data.user) return reply({ error: 'Sign in again and retry.' }, 401);

  const { data: connections, error } = await admin
    .from('connections')
    .select('id, user_id, status')
    .eq('user_id', data.user.id)
    .neq('status', 'disabled');
  if (error) return reply({ error: 'Could not load your bank connection.' }, 500);
  if (!connections.length) return reply({ error: 'No bank connection. Connect SimpleFIN first.' }, 400);

  // one connection per user today; sync each if that ever changes
  const results = [];
  for (const conn of connections as Connection[]) results.push(await runSync(admin, conn, 'manual'));
  return reply({ sync: results[0] });
});
