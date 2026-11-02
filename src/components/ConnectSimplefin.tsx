import { useState, type FormEvent } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { db } from '../lib/supabase';
import Button from './Button';

type ClaimResponse = {
  sync: { status: 'skipped'; reason: string } | { status: 'ok' | 'warning' | 'error'; new: number };
};

/** Paste a one-time SimpleFIN Setup Token; the server claims it and runs the first sync. */
export default function ConnectSimplefin({ onConnected }: { onConnected: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error } = await db().functions.invoke<ClaimResponse>('simplefin-claim', { body: { setupToken: token } });
    if (error) {
      // the function's own message is in the response body
      const body = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
      setError(body?.error ?? error.message);
    } else if (data) {
      setToken('');
      const s = data.sync;
      setNotice(s.status === 'skipped' ? `Connected. The first sync was skipped: ${s.reason}.` : `Connected. First sync: ${s.new} new transactions.`);
      onConnected();
    }
    setBusy(false);
  }

  return (
    <form className="auth narrow" onSubmit={submit}>
      <p className="muted">
        In SimpleFIN Bridge, create a Setup Token and paste it here. It works only once; the app trades it for access that
        stays encrypted on the server.
      </p>
      <label>
        Setup Token
        <input type="text" autoComplete="off" spellCheck={false} required value={token} onChange={(e) => setToken(e.target.value)} />
      </label>
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? 'Connecting and syncing…' : 'Connect SimpleFIN'}
      </Button>
      {busy && <p className="muted">The first sync can take up to a minute.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
    </form>
  );
}
