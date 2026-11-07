import { useCallback, useEffect, useState } from 'react';
import { CONNECTION_COLUMNS, type Connection, db, functionErrorMessage } from '../lib/supabase';
import { relativeTime } from '../lib/format';
import Button from '../components/Button';
import ConnectSimplefin from '../components/ConnectSimplefin';
import ReconnectSimplefin from '../components/ReconnectSimplefin';
import SyncLog, { type SyncRun } from '../components/SyncLog';
import SettingsModal from '../components/SettingsModal';
import MerchantList from '../components/MerchantList';
import SettingsRow from '../components/SettingsRow';
import TagList from '../components/TagList';
import CategoryList from '../components/CategoryList';

/** What the sync-now edge function returns (SyncResult in supabase/functions/_shared/run-sync.ts). */
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

const SECTIONS = ['Categories', 'Merchants', 'Tags'] as const;
type Section = (typeof SECTIONS)[number];

/**
 * Settings: the bank connection (status, Sync now, Sync log, Reconnect),
 * Categories / Merchants / Tags (one row each, opening a modal), and the
 * signed-in account. `onSynced` refreshes the nav's to-review count.
 */
export default function Settings({ email, onSynced }: { email: string; onSynced: () => void }) {
  const [connection, setConnection] = useState<Connection | null | undefined>(undefined); // undefined = loading
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [showReconnect, setShowReconnect] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<{ text: string; error: boolean } | null>(null);
  // Categories, Merchants and Tags are one row each; their lists open in a modal
  const [counts, setCounts] = useState<Record<Section, number> | null>(null);
  const [showing, setShowing] = useState<Section | null>(null);

  const loadCounts = useCallback(async () => {
    const results = await Promise.all(
      SECTIONS.map((t) => db().from(t.toLowerCase()).select('id', { count: 'exact', head: true })),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) return setError(failed.error.message);
    setCounts(Object.fromEntries(SECTIONS.map((t, i) => [t, results[i].count ?? 0])) as Record<Section, number>);
  }, []);

  const loadSync = useCallback(async () => {
    const [c, r] = await Promise.all([
      db().from('connections').select(CONNECTION_COLUMNS).limit(1),
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
    loadCounts();
  }, [loadSync, loadCounts]);

  async function syncNow() {
    setSyncing(true);
    setSyncNote(null);
    const { data, error } = await db().functions.invoke<SyncNowResponse>('sync-now');
    if (error) {
      setSyncNote({ text: `Couldn't sync: ${await functionErrorMessage(error)}`, error: true });
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
      {connection === null && <ConnectSimplefin onConnected={() => loadSync()} />}
      {connection && (
        <>
          {/* status first (what state it's in, then the latest news), actions under it */}
          <div className="sync-status">
            <p className={!syncing && connection.status !== 'active' ? 'sync-state error' : 'sync-state'}>
              {connection.label} ·{' '}
              {syncing ? 'Syncing…' : connection.status === 'active' ? 'Connected' : (STATUS_LABEL[connection.status] ?? connection.status)}
            </p>
            {syncing ? (
              <p className="muted">Can take up to a minute</p>
            ) : syncNote ? (
              <p className={syncNote.error ? 'error' : 'muted'} role={syncNote.error ? 'alert' : 'status'}>
                {syncNote.text}
              </p>
            ) : (
              <p className="muted">Last synced {relativeTime(connection.last_synced_at)}</p>
            )}
            {connection.status_message && <p className="muted">{connection.status_message}</p>}
          </div>
          <div className="sync-actions">
            <Button size="small" disabled={syncing} title={syncing ? 'Already syncing' : undefined} onClick={syncNow}>
              Sync now
            </Button>
            {runs.length > 0 && (
              <Button variant="link" onClick={() => setShowLog(true)}>
                Sync log
              </Button>
            )}
            <Button variant="link" onClick={() => setShowReconnect(true)}>
              Reconnect
            </Button>
          </div>
        </>
      )}

      {showLog && <SyncLog runs={runs} onClose={() => setShowLog(false)} />}
      {showReconnect && (
        <ReconnectSimplefin
          onClose={() => setShowReconnect(false)}
          onConnected={(message) => {
            setSyncNote({ text: message, error: false });
            loadSync();
            onSynced();
          }}
        />
      )}

      {SECTIONS.map((section) => (
        <SettingsRow
          key={section}
          label={section}
          detail={counts ? (counts[section] ? String(counts[section]) : 'None yet') : undefined}
          onOpen={() => setShowing(section)}
        />
      ))}
      {showing && (
        <SettingsModal
          title={showing}
          onClose={() => {
            setShowing(null);
            loadCounts(); // adds, deletes and merges change them
          }}
        >
          {showing === 'Categories' && <CategoryList />}
          {showing === 'Merchants' && <MerchantList />}
          {showing === 'Tags' && <TagList />}
        </SettingsModal>
      )}

      {/* laid out like Bank connection: a status line, then a compact action */}
      <h2>Account</h2>
      <div className="sync-status">
        <p>Signed in as {email}</p>
      </div>
      <div className="sync-actions">
        <Button size="small" onClick={() => db().auth.signOut()}>
          Sign out
        </Button>
      </div>
    </section>
  );
}
