import { useCallback, useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { db } from '../lib/supabase';
import { relativeTime } from '../lib/format';
import Button from '../components/Button';
import ConnectSimplefin from '../components/ConnectSimplefin';
import SyncLog, { type SyncRun } from '../components/SyncLog';
import MerchantList from '../components/MerchantList';
import TagList from '../components/TagList';
import CategoryList from '../components/CategoryList';

type Connection = { id: string; label: string; status: string; status_message: string | null; last_synced_at: string | null };

type SyncNowResponse = {
  sync:
    | { status: 'skipped'; reason: string }
    | { status: 'ok' | 'warning' | 'error'; new: number; updated: number; removed: number; messages: string[] };
};

// shown only when the connection isn't active
const STATUS_LABEL: Record<string, string> = {
  needs_attention: 'Needs attention',
  rate_limited: 'Paused for a day after a rate-limit warning',
  disabled: 'Disabled',
};

/** onSynced refreshes the nav's to-review count after Sync now. */
export default function Settings({ email, onSynced }: { email: string; onSynced: () => void }) {
  const [connection, setConnection] = useState<Connection | null | undefined>(undefined); // undefined = loading
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<{ text: string; error: boolean } | null>(null);

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

  async function syncNow() {
    setSyncing(true);
    setSyncNote(null);
    const { data, error } = await db().functions.invoke<SyncNowResponse>('sync-now');
    if (error) {
      // the function's own message is in the response body
      const body = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
      setSyncNote({ text: `Couldn't sync: ${body?.error ?? error.message}`, error: true });
    } else if (data) {
      const s = data.sync;
      if (s.status === 'skipped') setSyncNote({ text: `Sync skipped: ${s.reason}.`, error: false });
      else if (s.status === 'error') setSyncNote({ text: `Sync failed: ${s.messages.join(' ')}`, error: true });
      else
        setSyncNote({
          text: `Synced: ${s.new} new, ${s.updated} updated, ${s.removed} removed.${s.messages.length ? ` ${s.messages.join(' ')}` : ''}`,
          error: false,
        });
    }
    await loadSync();
    onSynced();
    setSyncing(false);
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
          {connection.status !== 'active' && (
            <p className="error">{STATUS_LABEL[connection.status] ?? connection.status}.</p>
          )}
          <div className="sync-line">
            <p>Last synced {relativeTime(connection.last_synced_at)}.</p>
            <Button size="small" disabled={syncing} onClick={syncNow}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </Button>
            {runs.length > 0 && (
              <Button variant="link" onClick={() => setShowLog(true)}>
                Sync log
              </Button>
            )}
          </div>
          {syncing && <p className="muted small">A sync can take up to a minute.</p>}
          {syncNote && (
            <p className={syncNote.error ? 'error' : 'notice'} role={syncNote.error ? 'alert' : 'status'}>
              {syncNote.text}
            </p>
          )}
          {connection.status_message && <p className="muted">{connection.status_message}</p>}
          <details className="reconnect">
            <summary>Reconnect with a new Setup Token</summary>
            <ConnectSimplefin onConnected={loadSync} />
          </details>
        </>
      )}

      {showLog && <SyncLog runs={runs} onClose={() => setShowLog(false)} />}

      <h2>Categories</h2>
      <CategoryList />

      <h2>Merchants</h2>
      <MerchantList />

      <h2>Tags</h2>
      <TagList />

      <h2>Account</h2>
      <p className="muted">Signed in as {email}</p>
      <Button onClick={() => db().auth.signOut()}>Sign out</Button>
    </section>
  );
}
