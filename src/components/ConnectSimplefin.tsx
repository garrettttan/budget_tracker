import { useState, type FormEvent } from 'react';
import { db, functionErrorMessage } from '../lib/supabase';
import Button from './Button';
import { strings } from '../lib/strings';

const t = strings.settings;

/** What the simplefin-claim edge function returns. */
type ClaimResponse = {
  sync: { status: 'skipped'; reason: string } | { status: 'ok' | 'warning' | 'error'; new: number };
};

/**
 * Paste a one-time SimpleFIN Setup Token; the server claims it and runs the first sync.
 * onConnected gets the result message (the Reconnect modal shows it on the page after closing);
 * onBusyChange lets a modal refuse to close mid-connect.
 */
export default function ConnectSimplefin({
  onConnected,
  onBusyChange,
}: {
  onConnected: (message: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    setNotice(null);
    const { data, error } = await db().functions.invoke<ClaimResponse>('simplefin-claim', { body: { setupToken: token } });
    if (error) {
      setError(await functionErrorMessage(error));
    } else if (data) {
      setToken('');
      const s = data.sync;
      const message =
        s.status === 'skipped' ? t.connectedSkipped(s.reason) : t.connectedSynced(s.new);
      setNotice(message);
      onConnected(message);
    }
    setBusy(false);
    onBusyChange?.(false);
  }

  return (
    <form className="auth narrow" onSubmit={submit}>
      <p className="muted">{t.connectIntro}</p>
      <label>
        {t.setupToken}
        <input type="text" autoComplete="off" spellCheck={false} required data-autofocus value={token} onChange={(e) => setToken(e.target.value)} />
      </label>
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? t.connecting : t.connect}
      </Button>
      {busy && <p className="muted">{t.firstSyncWait}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
    </form>
  );
}
