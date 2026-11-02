import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../lib/supabase';
import { money, relativeTime } from '../lib/format';

type Account = {
  id: string;
  name: string;
  institution: string | null;
  type: string;
  balance: string | null;
  balance_date: string | null;
};

type Connection = { id: string; label: string; status: string; status_message: string | null; last_synced_at: string | null };

// Daily sync + GitHub's schedule jitter; past this, something stopped it
const STALE_HOURS = 36;

function isStale(lastSyncedAt: string | null): boolean {
  return lastSyncedAt !== null && Date.now() - new Date(lastSyncedAt).getTime() > STALE_HOURS * 3_600_000;
}

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      db()
        .from('accounts')
        .select('id, name, institution, type, balance, balance_date')
        .eq('hidden', false)
        .order('sort_order')
        .order('name'),
      // explicit columns: the Vault pointer isn't readable from the browser
      db().from('connections').select('id, label, status, status_message, last_synced_at'),
    ]).then(([a, c]) => {
      if (a.error || c.error) setError((a.error ?? c.error)!.message);
      setAccounts((a.data ?? []) as Account[]);
      setConnections((c.data ?? []) as Connection[]);
    });
  }, []);

  return (
    <section>
      <header className="page-head">
        <h1>Accounts</h1>
      </header>
      {error && <p className="error" role="alert">Couldn't load accounts: {error}</p>}

      {connections && connections.length === 0 && (
        <p className="empty">
          No banks connected yet. <Link to="/settings">Connect SimpleFIN Bridge in Settings.</Link>
        </p>
      )}
      {connections?.map((c) => {
        const stale = isStale(c.last_synced_at);
        return (
          <div key={c.id}>
            <p className={c.status === 'active' && !stale ? 'muted' : 'error'}>
              {c.label}: last synced {relativeTime(c.last_synced_at)}
              {c.status_message ? `. ${c.status_message}` : ''}
            </p>
            {stale && (
              <p className="error" role="alert">
                The daily sync hasn't run in over a day and a half. Check the "Daily SimpleFIN sync" workflow in
                GitHub Actions (it may have been disabled), or the <Link to="/settings">sync log</Link>.
              </p>
            )}
          </div>
        );
      })}

      {accounts && accounts.length > 0 && (
        <table className="register">
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Institution</th>
              <th scope="col" className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{a.institution ?? <span className="muted">Manual</span>}</td>
                <td className="num">{money(a.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
