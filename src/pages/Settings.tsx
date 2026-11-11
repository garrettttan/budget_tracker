import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CONNECTION_COLUMNS, type Connection, db, functionErrorMessage } from '../lib/supabase';
import { relativeTime } from '../lib/format';
import Button from '../components/Button';
import ConnectSimplefin from '../components/ConnectSimplefin';
import ReconnectSimplefin from '../components/ReconnectSimplefin';
import SyncLog, { type SyncRun } from '../components/SyncLog';
import SettingsRow from '../components/SettingsRow';
import { strings } from '../lib/strings';

const t = strings.settings;

/** What the sync-now edge function returns (SyncResult in supabase/functions/_shared/run-sync.ts). */
type SyncNowResponse = {
  sync:
    | { status: 'skipped'; reason: string }
    | { status: 'ok' | 'warning' | 'error'; new: number; updated: number; removed: number; messages: string[] };
};

const SECTIONS = ['Categories', 'Merchants', 'Tags'] as const;
type Section = (typeof SECTIONS)[number];

/**
 * Settings: the bank connection (status, Sync now, Sync log, Reconnect),
 * Categories / Merchants / Tags (one row each, opening its own page), and the
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
  // Categories, Merchants and Tags are one row each
  const [counts, setCounts] = useState<Record<Section, number> | null>(null);
  const navigate = useNavigate();

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
      setSyncNote({ text: t.syncError(await functionErrorMessage(error)), error: true });
    } else if (data) {
      const s = data.sync;
      if (s.status === 'skipped') setSyncNote({ text: t.syncSkipped(s.reason), error: false });
      else if (s.status === 'error') setSyncNote({ text: t.syncFailed(s.messages), error: true });
      else
        setSyncNote({
          text: t.synced(s.new, s.updated, s.removed, s.messages),
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
        <h1>{t.title}</h1>
      </header>
      {error && <p className="error" role="alert">{t.loadFailed(error)}</p>}

      <h2>{t.bankConnection}</h2>
      {connection === null && <ConnectSimplefin onConnected={() => loadSync()} />}
      {connection && (
        <>
          {/* status first (what state it's in, then the latest news), actions under it */}
          <div className="sync-status">
            <p className={!syncing && connection.status !== 'active' ? 'sync-state error' : 'sync-state'}>
              {connection.label} ·{' '}
              {syncing ? t.syncing : connection.status === 'active' ? t.connected : (t.status[connection.status] ?? connection.status)}
            </p>
            {syncing ? (
              <p className="muted">{t.upToAMinute}</p>
            ) : syncNote ? (
              <p className={syncNote.error ? 'error' : 'muted'} role={syncNote.error ? 'alert' : 'status'}>
                {syncNote.text}
              </p>
            ) : (
              <p className="muted">{t.lastSynced(relativeTime(connection.last_synced_at))}</p>
            )}
            {connection.status_message && <p className="muted">{connection.status_message}</p>}
          </div>
          <div className="sync-actions">
            <Button size="small" disabled={syncing} title={syncing ? t.alreadySyncing : undefined} onClick={syncNow}>
              {t.syncNow}
            </Button>
            {runs.length > 0 && (
              <Button variant="link" onClick={() => setShowLog(true)}>
                {t.syncLog}
              </Button>
            )}
            <Button variant="link" onClick={() => setShowReconnect(true)}>
              {t.reconnect}
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
          label={t.sections[section]}
          detail={counts ? (counts[section] ? String(counts[section]) : strings.common.noneYet) : undefined}
          onOpen={() => navigate(`/settings/${section.toLowerCase()}`)}
        />
      ))}

      {/* laid out like Bank connection: a status line, then a compact action */}
      <h2>{t.account}</h2>
      <div className="sync-status">
        <p>{t.signedInAs(email)}</p>
      </div>
      <div className="sync-actions">
        <Button size="small" onClick={() => db().auth.signOut()}>
          {t.signOut}
        </Button>
      </div>
    </section>
  );
}
