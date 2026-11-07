// Connect SimpleFIN: called from Settings with a one-time Setup Token.
//
// Auth: the signed-in user's Supabase JWT (verify_jwt = true). Claims the
// token, stores the Access URL in Vault, then runs the first sync so accounts
// and transactions show up right away.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { preflight, reply, signedInUser } from '../_shared/http.ts';
import { runSync } from '../_shared/run-sync.ts';
import { SimplefinError, claimAccessUrl } from '../_shared/simplefin.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const user = await signedInUser(admin, req);
  if (!user) return reply({ error: 'Sign in again and retry.' }, 401);

  const { setupToken } = await req.json().catch(() => ({}));
  if (typeof setupToken !== 'string' || !setupToken.trim()) return reply({ error: 'Paste your SimpleFIN Setup Token.' }, 400);

  let accessUrl: string;
  try {
    accessUrl = await claimAccessUrl(setupToken);
  } catch (err) {
    return reply({ error: err instanceof SimplefinError ? err.message : 'Could not reach SimpleFIN. Try again.' }, 400);
  }

  const { data: connectionId, error } = await admin.rpc('save_simplefin_access_url', {
    p_user_id: user.id,
    p_access_url: accessUrl,
  });
  if (error) return reply({ error: 'Connected, but saving the access failed. Try a new Setup Token.' }, 500);

  const sync = await runSync(admin, { id: connectionId, user_id: user.id, status: 'active' }, 'initial');
  return reply({ connected: true, sync });
});
