import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../lib/supabase';
import { money, shortDate, todayIso } from '../lib/format';
import Button from '../components/Button';
import { Legend, MonthColumns, RankedBars, TableView, TimeLine } from '../components/charts';

const INCOME = 'var(--viz-income)';
const SPENDING = 'var(--viz-spending)';

const RANGES = [
  { key: '12m', label: 'Last 12 months', months: 12 },
  { key: 'ytd', label: 'This year', months: 0 },
  { key: '6m', label: 'Last 6 months', months: 6 },
  { key: '3m', label: 'Last 3 months', months: 3 },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];

type SpendRow = { month: string; category_id: string | null; category_name: string | null; spent: string };
type FlowRow = { month: string; income: string; spending: string; net: string };
type TagTotal = { tag_id: string; name: string; spent: string; transaction_count: number; first_date: string | null; last_date: string | null };
type Snapshot = { account_id: string; date: string; balance: string };
type Account = { id: string; connection_id: string | null; balance: string | null; hidden: boolean };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthEnd = (key: string) => {
  const d = new Date(key + 'T12:00:00');
  return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
};

/** The months a range covers, oldest first, as YYYY-MM-01 keys (the current month included). */
function monthsFor(range: RangeKey) {
  const now = new Date();
  const count = range === 'ytd' ? now.getMonth() + 1 : RANGES.find((r) => r.key === range)!.months;
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1, 12);
    const newYear = i === 0 || d.getMonth() === 0;
    return {
      key: iso(d),
      short: d.toLocaleDateString('en-US', { month: 'short', ...(newYear ? { year: '2-digit' } : {}) }).replace(' ', " '"),
      long: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    };
  });
}

const sum = (ns: number[]) => Math.round(ns.reduce((a, b) => a + b, 0) * 100) / 100;

/**
 * Trends: where the money went over a range of months. Everything below the
 * filter row uses the same months and tag toggles. Spending is your share
 * (net of reimbursements), excludes transfers, and leaves out tagged spending
 * unless its tag is toggled on.
 */
export default function Trends() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const range: RangeKey = RANGES.find((r) => r.key === params.get('range'))?.key ?? '12m';
  const included = useMemo(() => (params.get('tags') ?? '').split(',').filter(Boolean), [params]);
  const picked = params.get('category');

  const [spend, setSpend] = useState<SpendRow[] | null>(null);
  const [flow, setFlow] = useState<FlowRow[]>([]);
  const [tags, setTags] = useState<TagTotal[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // tag totals and balances don't depend on the toggles
  useEffect(() => {
    Promise.all([
      db().from('tag_spend').select('tag_id, name, spent, transaction_count, first_date, last_date').order('name'),
      db().from('balance_snapshots').select('account_id, date, balance').order('date'),
      db().from('accounts').select('id, connection_id, balance, hidden'),
    ]).then(([t, b, a]) => {
      const failed = t.error ?? b.error ?? a.error;
      if (failed) setError(failed.message);
      setTags((t.data ?? []) as TagTotal[]);
      setSnapshots((b.data ?? []) as Snapshot[]);
      setAccounts((a.data ?? []) as Account[]);
    });
  }, []);

  useEffect(() => {
    setLoading(true); // the charts keep their last render, faded, until this returns
    Promise.all([
      db().rpc('monthly_category_spend', { include_tags: included }),
      db().rpc('monthly_cashflow', { include_tags: included }),
    ]).then(([s, f]) => {
      const failed = s.error ?? f.error;
      if (failed) setError(failed.message);
      setSpend((s.data ?? []) as SpendRow[]);
      setFlow((f.data ?? []) as FlowRow[]);
      setLoading(false);
    });
  }, [included]);

  const months = useMemo(() => monthsFor(range), [range]);
  const start = months[0].key;
  const end = todayIso();
  const inRange = (month: string) => month >= start && month <= end;

  // spending by category over the range, largest first
  const byCategory = useMemo(() => {
    const totals = new Map<string, { key: string; name: string; value: number }>();
    for (const r of spend ?? []) {
      if (!inRange(r.month)) continue;
      const key = r.category_id ?? 'none';
      const t = totals.get(key) ?? { key, name: r.category_name ?? 'No category yet', value: 0 };
      t.value = Math.round((t.value + Number(r.spent)) * 100) / 100;
      totals.set(key, t);
    }
    return [...totals.values()].filter((t) => t.value !== 0).sort((a, b) => b.value - a.value);
  }, [spend, start, end]);

  const category = byCategory.find((c) => c.key === picked) ?? byCategory[0];
  const categoryMonths = months.map(
    (m) => sum((spend ?? []).filter((r) => r.month === m.key && (r.category_id ?? 'none') === category?.key).map((r) => Number(r.spent))),
  );

  const flowFor = (key: string) => flow.find((f) => f.month === key);
  const income = months.map((m) => Number(flowFor(m.key)?.income ?? 0));
  const spending = months.map((m) => Number(flowFor(m.key)?.spending ?? 0));
  const totalIncome = sum(income);
  const totalSpending = sum(spending);

  // net worth: each synced account's latest snapshot on or before each day,
  // plus manual accounts at their current balance (they keep no history)
  const netWorth = useMemo(() => {
    const visible = new Set(accounts.filter((a) => !a.hidden).map((a) => a.id));
    const manual = sum(accounts.filter((a) => !a.hidden && a.connection_id === null).map((a) => Number(a.balance ?? 0)));
    const latest = new Map<string, number>();
    const byDay = new Map<string, number>();
    for (const s of snapshots) {
      if (!visible.has(s.account_id)) continue;
      latest.set(s.account_id, Number(s.balance));
      if (s.date >= start) byDay.set(s.date, sum([...latest.values()]) + manual);
    }
    const points = [...byDay.entries()].map(([date, value]) => ({ date, long: shortDate(date), value: Math.round(value * 100) / 100 }));
    if (points.length === 0 && accounts.length) {
      points.push({ date: end, long: shortDate(end), value: sum(accounts.filter((a) => !a.hidden).map((a) => Number(a.balance ?? 0))) });
    }
    return { points, hasManual: accounts.some((a) => !a.hidden && a.connection_id === null) };
  }, [snapshots, accounts, start, end]);
  const nwFirst = netWorth.points[0];
  const nwLast = netWorth.points[netWorth.points.length - 1];

  function set(next: Record<string, string | null>) {
    const merged = { range: range === '12m' ? null : range, tags: included.join(',') || null, category: picked, ...next };
    setParams(Object.fromEntries(Object.entries(merged).filter(([, v]) => v)) as Record<string, string>);
  }

  const toggleTag = (id: string) =>
    set({ tags: (included.includes(id) ? included.filter((t) => t !== id) : [...included, id]).join(',') || null });

  /** Opens Transactions on the matching rows. */
  const openTransactions = (extra: Record<string, string>) =>
    navigate(`/transactions?${new URLSearchParams({ status: 'all', ...extra }).toString()}`);

  const rangeLabel = RANGES.find((r) => r.key === range)!.label.toLowerCase();

  return (
    <section>
      <header className="page-head">
        <h1>Trends</h1>
      </header>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="trend-filters">
        <div className="filter" role="group" aria-label="Months">
          {RANGES.map((r) => (
            <Button key={r.key} size="small" aria-pressed={range === r.key} onClick={() => set({ range: r.key === '12m' ? null : r.key })}>
              {r.label}
            </Button>
          ))}
        </div>
        {tags.length > 0 && (
          <div className="filter tag-toggles" role="group" aria-label="Include tagged spending">
            <span className="muted small">Include tagged:</span>
            {tags.map((t) => (
              <Button key={t.tag_id} size="small" aria-pressed={included.includes(t.tag_id)} onClick={() => toggleTag(t.tag_id)}>
                {t.name}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className={loading && spend ? 'trends refetching' : 'trends'}>
        <dl className="stat-row">
          <div>
            <dt>Spent</dt>
            <dd>{money(totalSpending)}</dd>
          </div>
          <div>
            <dt>Income</dt>
            <dd>{money(totalIncome)}</dd>
          </div>
          <div>
            <dt>{totalIncome - totalSpending >= 0 ? 'Saved' : 'Spent more than earned'}</dt>
            <dd>{money(Math.abs(totalIncome - totalSpending))}</dd>
          </div>
        </dl>
        <p className="muted small">
          Your share of spending ({rangeLabel}), after what people owe you back. Transfers are left out
          {tags.length ? ', and so is tagged spending unless you include its tag above' : ''}. Unreviewed transactions with a
          category count too.
        </p>

        <h2>Spending by category</h2>
        {spend && byCategory.length === 0 && <p className="empty">No spending in these months yet.</p>}
        {byCategory.length > 0 && (
          <>
            <p className="muted small">Pick a category to see it month by month below.</p>
            <RankedBars
              rows={byCategory}
              color={SPENDING}
              format={money}
              selected={category?.key}
              selectHint="Shows it month by month"
              onSelect={(key) => {
                set({ category: key });
                document.getElementById('category-by-month')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            />
          </>
        )}

        {category && (
          <>
            <h2 id="category-by-month">
              {category.name} by month
            </h2>
            <p className="muted small">
              {money(sum(categoryMonths))} {rangeLabel}, {money(sum(categoryMonths) / months.length)} a month on average. Pick a
              month to see its transactions, or{' '}
              <Link
                to={`/transactions?${new URLSearchParams({ status: 'all', category: category.key, from: start, to: end })}`}
              >
                see all of them
              </Link>
              .
            </p>
            <MonthColumns
              months={months}
              series={[{ name: category.name, color: SPENDING, values: categoryMonths }]}
              format={money}
              label={`${category.name} spending by month`}
              selectHint="Opens its transactions"
              onSelect={(key) => openTransactions({ category: category.key, from: key, to: monthEnd(key) })}
            />
            <TableView>
              <table className="register">
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col" className="num">{category.name}</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m, i) => (
                    <tr key={m.key}>
                      <td>{m.long}</td>
                      <td className="num">{money(categoryMonths[i])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableView>
          </>
        )}

        <h2>Cash flow</h2>
        <p className="muted small">Income and spending each month. Pick a month to see its transactions.</p>
        <Legend shape="rect" items={[{ name: 'Income', color: INCOME }, { name: 'Spending', color: SPENDING }]} />
        <MonthColumns
          months={months}
          series={[
            { name: 'Income', color: INCOME, values: income },
            { name: 'Spending', color: SPENDING, values: spending },
          ]}
          format={money}
          label="Income and spending by month"
          selectHint="Opens its transactions"
          onSelect={(key) => openTransactions({ from: key, to: monthEnd(key) })}
        />
        <TableView>
          <table className="register">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className="num">Income</th>
                <th scope="col" className="num">Spending</th>
                <th scope="col" className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => (
                <tr key={m.key}>
                  <td>{m.long}</td>
                  <td className="num">{money(income[i])}</td>
                  <td className="num">{money(spending[i])}</td>
                  <td className="num">{money(income[i] - spending[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableView>

        <h2>Net worth</h2>
        {nwLast ? (
          <>
            <p className="muted small">
              {money(nwLast.value)} now
              {nwFirst && nwFirst !== nwLast
                ? `, ${nwLast.value >= nwFirst.value ? 'up' : 'down'} ${money(Math.abs(nwLast.value - nwFirst.value))} since ${nwFirst.long}`
                : ''}
              . Cash and investments minus card balances, from the daily sync’s balance history
              {netWorth.hasManual ? '; manual accounts count at their current balance throughout' : ''}.
            </p>
            <TimeLine points={netWorth.points} color={INCOME} format={money} label="Net worth over time" />
            {netWorth.points.length < 2 && (
              <p className="muted small">The line grows one point a day as the daily sync records balances.</p>
            )}
            <TableView>
              <table className="register">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col" className="num">Net worth</th>
                  </tr>
                </thead>
                <tbody>
                  {[...netWorth.points].reverse().map((p) => (
                    <tr key={p.date}>
                      <td>{p.long}</td>
                      <td className="num">{money(p.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableView>
          </>
        ) : (
          <p className="empty">No balances yet. They appear after the first sync.</p>
        )}

        {tags.length > 0 && (
          <>
            <h2>Tags</h2>
            <p className="muted small">Total cost of each tag, all time (your share, after reimbursements).</p>
            <table className="register tag-totals">
              <thead>
                <tr>
                  <th scope="col">Tag</th>
                  <th scope="col">Dates</th>
                  <th scope="col" className="num">Transactions</th>
                  <th scope="col" className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {tags.map((t) => (
                  <tr key={t.tag_id}>
                    <td>
                      <Link to={`/transactions?status=all&tag=${t.tag_id}`}>{t.name}</Link>
                    </td>
                    <td>{t.first_date ? `${shortDate(t.first_date)} – ${shortDate(t.last_date)}` : '—'}</td>
                    <td className="num">{t.transaction_count}</td>
                    <td className="num">{money(t.spent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </section>
  );
}
