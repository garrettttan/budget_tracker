import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../lib/supabase';
import { money, relativeTime } from '../lib/format';
import Button from '../components/Button';
import AddAccount, { CLASSES } from '../components/AddAccount';
import EditAccount, { type EditableAccount } from '../components/EditAccount';
import PencilIcon from '../components/PencilIcon';

type Account = EditableAccount & { balance_date: string | null };

type Connection = { id: string; label: string; status: string; status_message: string | null; last_synced_at: string | null };

// Daily sync + GitHub's schedule jitter; past this, something stopped it
const STALE_HOURS = 36;

function isStale(lastSyncedAt: string | null): boolean {
  return lastSyncedAt !== null && Date.now() - new Date(lastSyncedAt).getTime() > STALE_HOURS * 3_600_000;
}

const total = (accounts: Account[]) => accounts.reduce((sum, a) => sum + Number(a.balance ?? 0), 0);

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Account | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const [a, c] = await Promise.all([
      db()
        .from('accounts')
        .select('id, name, institution, class, balance, balance_date, connection_id')
        .eq('hidden', false)
        .order('sort_order')
        .order('name'),
      // explicit columns: the Vault pointer isn't readable from the browser
      db().from('connections').select('id, label, status, status_message, last_synced_at'),
    ]);
    if (a.error || c.error) setError((a.error ?? c.error)!.message);
    setAccounts((a.data ?? []) as Account[]);
    setConnections((c.data ?? []) as Connection[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section>
      <header className="page-head">
        <h1>Accounts</h1>
        {accounts && accounts.length > 0 && (
          <p className="net-worth">
            <span className="muted">Net worth</span> <strong className="num">{money(total(accounts))}</strong>
          </p>
        )}
      </header>
      {error && <p className="error" role="alert">Couldn't update accounts: {error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

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
        <>
          {CLASSES.map(({ value, label }) => {
            const group = accounts.filter((a) => a.class === value);
            if (group.length === 0) return null;
            return (
              <div key={value}>
                <h2>{label}</h2>
                <table className="register accounts" aria-label={label}>
                  {/* no header row: fixed widths keep the class tables lined up */}
                  <colgroup>
                    <col />
                    <col className="balance-col" />
                    <col className="action-col" />
                  </colgroup>
                  <tbody>
                    {group.map((a) => (
                      <tr key={a.id}>
                        <td>
                          {a.name}
                          <span className="account-sub">{a.institution ?? 'Manual'}</span>
                        </td>
                        <td className="num">{money(a.balance)}</td>
                        <td className="action">
                          <Button
                            variant="icon"
                            aria-label={`Edit ${a.name}`}
                            title="Edit"
                            onClick={() => {
                              setEditing(a);
                              setNotice(null);
                              setError(null);
                            }}
                          >
                            <PencilIcon />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">Total {label.toLowerCase()}</th>
                      <td className="num">{money(total(group))}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            );
          })}
        </>
      )}

      {/* rarely used, so it sits below the accounts */}
      <div className="page-foot">
          <Button
            onClick={() => {
              setAdding(true);
              setNotice(null);
            }}
          >
            Add manual account
          </Button>
      </div>

      {adding && (
        <AddAccount
          onCancel={() => setAdding(false)}
          onAdded={async (name) => {
            setAdding(false);
            setNotice(`Added ${name}. Add its transactions from the Transactions page.`);
            await load();
          }}
        />
      )}
      {editing && (
        <EditAccount
          account={editing}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </section>
  );
}
