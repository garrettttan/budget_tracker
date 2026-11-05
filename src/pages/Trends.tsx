import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../lib/supabase';
import { money, shortDate, todayIso } from '../lib/format';
import Button from '../components/Button';
import Modal from '../components/Modal';
import { Legend, MonthColumns, TimeLine } from '../components/charts';
import { iso, monthEnd, sum } from '../lib/months';

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

/**
 * Trends: where the money went over a range of months (a single month's
 * category split is on Spending). Everything uses the same months and tag
 * toggles. Spending is your share
 * (net of reimbursements), excludes transfers, and leaves out tagged spending
 * unless its tag is toggled on.
 */
export default function Trends() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const range: RangeKey = RANGES.find((r) => r.key === params.get('range'))?.key ?? '12m';
  const included = useMemo(() => (params.get('tags') ?? '').split(',').filter(Boolean), [params]);

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

  /** Category totals for the months matching `keep`, largest first (positive only). */
  const totalsBy = (keep: (month: string) => boolean) => {
    const totals = new Map<string, { key: string; name: string; value: number }>();
    for (const r of spend ?? []) {
      if (!keep(r.month)) continue;
      const key = r.category_id ?? 'none';
      const t = totals.get(key) ?? { key, name: r.category_name ?? 'Uncategorized', value: 0 };
      t.value = Math.round((t.value + Number(r.spent)) * 100) / 100;
      totals.set(key, t);
    }
    return [...totals.values()].filter((t) => t.value > 0).sort((a, b) => b.value - a.value);
  };

  const byCategory = useMemo(() => totalsBy((m) => m >= start), [spend, start]);
  // tapping a category opens its months (over the page's range) in a modal
  const [opened, setOpened] = useState<{ key: string; name: string } | null>(null);

  const flowFor = (key: string) => flow.find((f) => f.month === key);
  const income = months.map((m) => Number(flowFor(m.key)?.income ?? 0));
  const spending = months.map((m) => Number(flowFor(m.key)?.spending ?? 0));

  // net worth, one point per month: each synced account's latest snapshot on or
  // before the month's last day (today, for this month), plus manual accounts at
  // their current balance (they keep no history). Months before the first
  // snapshot are left out.
  const netWorth = useMemo(() => {
    const visible = new Set(accounts.filter((a) => !a.hidden).map((a) => a.id));
    const manual = sum(accounts.filter((a) => !a.hidden && a.connection_id === null).map((a) => Number(a.balance ?? 0)));
    const latest = new Map<string, number>();
    const synced = snapshots.filter((s) => visible.has(s.account_id)); // ordered by date
    let i = 0;
    const points: { date: string; long: string; value: number }[] = [];
    for (const m of months) {
      const asOf = monthEnd(m.key) < end ? monthEnd(m.key) : end;
      for (; i < synced.length && synced[i].date <= asOf; i++) latest.set(synced[i].account_id, Number(synced[i].balance));
      if (latest.size) points.push({ date: m.key, long: m.long, value: sum([...latest.values()]) + manual });
    }
    if (points.length === 0 && accounts.length) {
      const now = months[months.length - 1];
      points.push({ date: now.key, long: now.long, value: sum(accounts.filter((a) => !a.hidden).map((a) => Number(a.balance ?? 0))) });
    }
    return { points };
  }, [snapshots, accounts, months, end]);
  const nwLast = netWorth.points[netWorth.points.length - 1];

  function set(next: Record<string, string | null>) {
    const merged = {
      range: range === '12m' ? null : range,
      tags: included.join(',') || null,
      ...next,
    };
    setParams(Object.fromEntries(Object.entries(merged).filter(([, v]) => v)) as Record<string, string>);
  }

  const toggleTag = (id: string) =>
    set({ tags: (included.includes(id) ? included.filter((t) => t !== id) : [...included, id]).join(',') || null });

  /** Opens Spending on a month's rows (`YYYY-MM-01`), optionally one category. */
  const openMonth = (key: string, category?: string) =>
    navigate(`/spending?${new URLSearchParams({ status: 'all', month: key.slice(0, 7), ...(category ? { category } : {}) })}`);

  const rangeLabel = RANGES.find((r) => r.key === range)!.label.toLowerCase();

  return (
    <section>
      <header className="page-head">
        <h1>Trends</h1>
      </header>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="trend-filters">
        <div className="filter range-filter" role="group" aria-label="Months">
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
        <h2>Cash flow</h2>
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
          onSelect={(key) => openMonth(key)}
        />

        {byCategory.length > 0 && (
          <>
            <h2>Categories</h2>
            <table className="register category-totals">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col" className="num">Avg / month</th>
                  <th scope="col" className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {byCategory.map((c) => (
                  <tr key={c.key}>
                    <td>
                      <Button variant="link" onClick={() => setOpened(c)}>
                        {c.name}
                      </Button>
                    </td>
                    <td className="num">{money(c.value / months.length)}</td>
                    <td className="num">{money(c.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <h2>Net worth</h2>
        {nwLast ? (
          <>
            <TimeLine points={netWorth.points} color={INCOME} format={money} label="Net worth by month" />
          </>
        ) : (
          <p className="empty">No balances yet. They appear after the first sync.</p>
        )}

        {tags.length > 0 && (
          <>
            <h2>Tags</h2>
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
                      <Link to={`/spending?status=all&tag=${t.tag_id}`}>{t.name}</Link>
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

      {opened && (
        <CategoryMonths
          category={opened}
          months={months}
          spend={spend ?? []}
          rangeLabel={rangeLabel}
          start={start}
          end={end}
          onClose={() => setOpened(null)}
          onOpenMonth={(key) => openMonth(key, opened.key)}
        />
      )}
    </section>
  );
}

/** A category's spending month by month over the page's range, in a modal. */
function CategoryMonths({
  category,
  months,
  spend,
  rangeLabel,
  start,
  end,
  onClose,
  onOpenMonth,
}: {
  category: { key: string; name: string };
  months: { key: string; short: string; long: string }[];
  spend: SpendRow[];
  rangeLabel: string;
  start: string;
  end: string;
  onClose: () => void;
  onOpenMonth: (monthKey: string) => void;
}) {
  const values = months.map((m) =>
    sum(spend.filter((r) => r.month === m.key && (r.category_id ?? 'none') === category.key).map((r) => Number(r.spent))),
  );
  const total = sum(values);
  return (
    <Modal labelledBy="category-months-title" onClose={onClose} className="modal-wide">
      {(close) => (
        <>
          <div className="modal-head">
            <h2 id="category-months-title">{category.name} by month</h2>
            <Button variant="icon" aria-label="Close" onClick={close}>
              ×
            </Button>
          </div>
          <p className="muted small">
            {money(total)} {rangeLabel}, {money(total / months.length)} a month on average. Pick a month to see its
            transactions, or{' '}
            <Link to={`/spending?${new URLSearchParams({ status: 'all', category: category.key, from: start, to: end })}`}>
              see all of them
            </Link>
            .
          </p>
          <MonthColumns
            months={months}
            series={[{ name: category.name, color: SPENDING, values }]}
            format={money}
            label={`${category.name} spending by month`}
            selectHint="Opens its transactions"
            onSelect={onOpenMonth}
          />
        </>
      )}
    </Modal>
  );
}
