import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../lib/supabase';
import { money, relativeTime } from '../lib/format';
import Button from '../components/Button';

type AccountClass = 'cash' | 'investment' | 'liability';

type Account = {
  id: string;
  name: string;
  institution: string | null;
  class: AccountClass;
  balance: string | null;
  balance_date: string | null;
};

type Connection = { id: string; label: string; status: string; status_message: string | null; last_synced_at: string | null };

const CLASSES: { value: AccountClass; label: string; note?: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'investment', label: 'Investments', note: 'Balance only; transactions aren’t imported.' },
  { value: 'liability', label: 'Liabilities' },
];

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
  const [renaming, setRenaming] = useState<string | null>(null); // account id
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [a, c] = await Promise.all([
      db()
        .from('accounts')
        .select('id, name, institution, class, balance, balance_date')
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

  function startRename(account: Account) {
    setRenaming(account.id);
    setDraft(account.name);
    setError(null);
    setNotice(null);
  }

  /** Your name for the account. The sync sets the bank's name only once, so it sticks. */
  async function rename(account: Account) {
    const name = draft.trim();
    if (!name) return;
    if (name === account.name) return setRenaming(null);
    setBusy(true);
    setError(null);
    const { error } = await db().from('accounts').update({ name }).eq('id', account.id);
    if (error) setError(error.message);
    else {
      setNotice(`Renamed to ${name}.`);
      setRenaming(null);
    }
    await load();
    setBusy(false);
  }

  async function changeClass(account: Account, next: AccountClass) {
    setError(null);
    if (next === 'investment') {
      // investments are balance-only, so their imported transactions go
      const { count } = await db()
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', account.id);
      if (
        count &&
        !window.confirm(
          `Move ${account.name} to Investments? Only its balance is kept: its ${count} imported ` +
            `transactions (and any notes, reimbursements or tags on them) will be deleted.`,
        )
      ) {
        return load(); // resets the menu
      }
      const del = await db().from('transactions').delete().eq('account_id', account.id);
      if (del.error) return setError(del.error.message);
    }
    const { error } = await db().from('accounts').update({ class: next }).eq('id', account.id);
    if (error) setError(error.message);
    load();
  }

  return (
    <section>
      <header className="page-head">
        <h1>Accounts</h1>
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
          <p className="net-worth">
            <span className="muted">Net worth</span> <strong className="num">{money(total(accounts))}</strong>
          </p>
          {CLASSES.map(({ value, label, note }) => {
            const group = accounts.filter((a) => a.class === value);
            if (group.length === 0) return null;
            return (
              <div key={value}>
                <h2>{label}</h2>
                {note && <p className="muted small">{note}</p>}
                <table className="register accounts">
                  <thead>
                    <tr>
                      <th scope="col">Account</th>
                      <th scope="col">Institution</th>
                      <th scope="col">Class</th>
                      <th scope="col" className="num">Balance</th>
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map((a) => (
                      <tr key={a.id}>
                        <td>
                          {renaming === a.id ? (
                            <input
                              type="text"
                              className="merchant-name-input"
                              aria-label={`New name for ${a.name}`}
                              value={draft}
                              autoFocus
                              disabled={busy}
                              onChange={(e) => setDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') rename(a);
                                if (e.key === 'Escape') setRenaming(null);
                              }}
                            />
                          ) : (
                            a.name
                          )}
                        </td>
                        <td>{a.institution ?? <span className="muted">Manual</span>}</td>
                        <td>
                          <select
                            aria-label={`Class for ${a.name}`}
                            value={a.class}
                            onChange={(e) => changeClass(a, e.target.value as AccountClass)}
                          >
                            {CLASSES.map((c) => (
                              <option key={c.value} value={c.value}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="num">{money(a.balance)}</td>
                        <td className="action">
                          {renaming === a.id ? (
                            <>
                              <Button
                                size="small"
                                disabled={busy || !draft.trim()}
                                title={draft.trim() ? undefined : 'Type a name first'}
                                onClick={() => rename(a)}
                              >
                                Save
                              </Button>
                              <Button size="small" variant="link" disabled={busy} onClick={() => setRenaming(null)}>
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <Button size="small" disabled={busy} aria-label={`Rename ${a.name}`} onClick={() => startRename(a)}>
                              Rename
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      {/* one cell per column, so phones can hide Institution here too */}
                      <th scope="row">Total {label.toLowerCase()}</th>
                      <td />
                      <td />
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
    </section>
  );
}
