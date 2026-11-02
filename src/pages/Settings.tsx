import { useCallback, useEffect, useState } from 'react';
import { db } from '../lib/supabase';
import { relativeTime } from '../lib/format';
import ConnectSimplefin from '../components/ConnectSimplefin';
import SyncLog, { type SyncRun } from '../components/SyncLog';

type Category = { id: string; name: string; group_name: string | null; is_income: boolean; archived: boolean };

type Connection = { id: string; label: string; status: string; status_message: string | null; last_synced_at: string | null };

const STATUS_LABEL: Record<string, string> = {
  active: 'Connected',
  needs_attention: 'Needs attention',
  rate_limited: 'Paused for a day after a rate-limit warning',
  disabled: 'Disabled',
};

export default function Settings({ email }: { email: string }) {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [connection, setConnection] = useState<Connection | null | undefined>(undefined); // undefined = loading
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    db()
      .from('categories')
      .select('id, name, group_name, is_income, archived')
      .eq('archived', false)
      .order('sort_order')
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setCategories((data ?? []) as Category[]);
      });
  }, []);

  const loadSync = useCallback(async () => {
    const [c, r] = await Promise.all([
      // explicit columns: the Vault pointer isn't readable from the browser
      db().from('connections').select('id, label, status, status_message, last_synced_at').limit(1),
      db()
        .from('sync_runs')
        .select('id, trigger, started_at, status, new_count, updated_count, removed_count, messages')
        .order('started_at', { ascending: false })
        .limit(10),
    ]);
    if (c.error || r.error) setError((c.error ?? r.error)!.message);
    setConnection((c.data?.[0] as Connection | undefined) ?? null);
    setRuns((r.data ?? []) as SyncRun[]);
  }, []);

  useEffect(() => {
    loadSync();
  }, [loadSync]);

  const groups = new Map<string, Category[]>();
  for (const c of categories ?? []) {
    const g = c.group_name ?? 'Other';
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }

  return (
    <section>
      <header className="page-head">
        <h1>Settings</h1>
      </header>
      {error && <p className="error" role="alert">Couldn't load settings: {error}</p>}

      <h2>Bank connection</h2>
      {connection === null && <ConnectSimplefin onConnected={loadSync} />}
      {connection && (
        <>
          <p className={connection.status === 'active' ? undefined : 'error'}>
            {connection.label}: {STATUS_LABEL[connection.status] ?? connection.status}. Last synced{' '}
            {relativeTime(connection.last_synced_at)}.
          </p>
          {connection.status_message && <p className="muted">{connection.status_message}</p>}
          <p className="muted">
            Syncs daily around 6 a.m. For an extra sync, run "Daily SimpleFIN sync" in the repo's GitHub Actions.
          </p>
          <details className="reconnect">
            <summary>Reconnect with a new Setup Token</summary>
            <ConnectSimplefin onConnected={loadSync} />
          </details>
        </>
      )}

      {runs.length > 0 && (
        <>
          <h2>Sync log</h2>
          <SyncLog runs={runs} />
        </>
      )}

      <h2>Categories</h2>
      <dl className="category-groups">
        {[...groups.entries()].map(([group, cats]) => (
          <div key={group} className="category-group">
            <dt>{group}</dt>
            {cats.map((c) => (
              <dd key={c.id}>{c.name}</dd>
            ))}
          </div>
        ))}
      </dl>

      <h2>Account</h2>
      <p className="muted">Signed in as {email}</p>
      <button type="button" onClick={() => db().auth.signOut()}>
        Sign out
      </button>
    </section>
  );
}
