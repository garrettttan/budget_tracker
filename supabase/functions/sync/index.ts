// Daily SimpleFIN sync, called by .github/workflows/sync.yml.
//
// Auth: `Authorization: Bearer <SYNC_SECRET>`. Deployed with verify_jwt = false,
// since this isn't a Supabase JWT. The secret can only start a sync, and
// runSync caps SimpleFIN requests at 12 per 24 h however often it's called.
//
// The response is minimal because GitHub Actions logs are public; details go
// to sync_runs and show in Settings → Sync log.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { type Connection, runSync } from '../_shared/run-sync.ts';
import { messages } from '../_shared/messages.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async (req) => {
  const secret = Deno.env.get('SYNC_SECRET');
  if (req.method !== 'POST' || !secret || !sameString(req.headers.get('Authorization') ?? '', `Bearer ${secret}`)) {
    return Response.json({ error: messages.unauthorized }, { status: 401 });
  }
  const trigger = new URL(req.url).searchParams.get('trigger') === 'manual' ? 'manual' : 'schedule';

  const { data: connections, error } = await admin.from('connections').select('id, user_id, status').neq('status', 'disabled');
  if (error) return Response.json({ status: 'error' }, { status: 500 });

  const statuses: string[] = [];
  for (const conn of connections as Connection[]) statuses.push((await runSync(admin, conn, trigger)).status);

  const status = ['error', 'warning', 'ok', 'skipped'].find((s) => statuses.includes(s)) ?? 'skipped';
  return Response.json({ status }, { status: status === 'error' ? 502 : 200 });
});

/** Constant-time comparison, so response timing doesn't leak the secret. */
function sameString(a: string, b: string): boolean {
  const [x, y] = [new TextEncoder().encode(a), new TextEncoder().encode(b)];
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
