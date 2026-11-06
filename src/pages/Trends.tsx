import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../lib/supabase';
import { money, shortDate, todayIso } from '../lib/format';
import Button from '../components/Button';
import Switch from '../components/Switch';
import { Legend, MonthColumns, PaceLines, TimeLine, type PaceSeries } from '../components/charts';
import { iso, monthEnd, sum, thisMonth } from '../lib/months';

const INCOME = 'var(--viz-income)';
const SPENDING = 'var(--viz-spending)';
const EARLIER = 'var(--viz-cat-other)';

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
type Category = { id: string; name: string };
type MonthKey = { key: string; short: string; long: string };
type Line = { posted_date: string; category_id: string | null; spent: string; tag_ids: string[] };

/** The YYYY-MM-01 key `n` months before (negative) or after `key`. */
const addMonths = (key: string, n: number) => {
  const d = new Date(key + 'T12:00:00');
  return iso(new Date(d.getFullYear(), d.getMonth() + n, 1, 12));
};

/** Every approved spending line from `start` on (paged; the API caps a response at 1,000 rows). */
async function fetchLines(start: string) {
  const lines: Line[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await db()
      .from('spending_lines')
      .select('posted_date, category_id, spent, tag_ids')
      .gte('posted_date', start)
      .order('transaction_id')
      .range(from, from + 999);
    if (error) return { lines, error };
    lines.push(...((data ?? []) as Line[]));
    if ((data ?? []).length < 1000) break;
  }
  return { lines, error: null };
}

/**
 * A month's running total for days 1..`days`: day d is everything spent on or
 * before it. A shorter month carries its total to the end; days after `upTo`
 * (today, for this month) are null.
 */
function runningTotals(lines: Line[], month: string, days: number, upTo = days) {
  const byDay = new Array<number>(days).fill(0);
  for (const l of lines) {
    if (l.posted_date.slice(0, 7) !== month.slice(0, 7)) continue;
    const day = Number(l.posted_date.slice(8, 10));
    if (day <= days) byDay[day - 1] += Number(l.spent);
  }
  let total = 0;
  return byDay.map((v, i) => {
    total += v;
    return i < upTo ? Math.round(total * 100) / 100 : null;
  });
}

/** A category's spending (`none` = Uncategorized) for each of `months`. */
function monthValues(spend: SpendRow[], months: MonthKey[], category: string) {
  return months.map((m) =>
    sum(spend.filter((r) => r.month === m.key && (r.category_id ?? 'none') === category).map((r) => Number(r.spent))),
  );
}

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
  const [categories, setCategories] = useState<Category[]>([]);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // tag totals and balances don't depend on the toggles
  useEffect(() => {
    Promise.all([
      db().from('tag_spend').select('tag_id, name, spent, transaction_count, first_date, last_date').order('name'),
      db().from('balance_snapshots').select('account_id, date, balance').order('date'),
      db().from('accounts').select('id, connection_id, balance, hidden'),
      db().from('categories').select('id, name').eq('archived', false).eq('is_income', false).order('sort_order'),
    ]).then(([t, b, a, c]) => {
      const failed = t.error ?? b.error ?? a.error ?? c.error;
      if (failed) setError(failed.message);
      setTags((t.data ?? []) as TagTotal[]);
      setSnapshots((b.data ?? []) as Snapshot[]);
      setAccounts((a.data ?? []) as Account[]);
      setCategories((c.data ?? []) as Category[]);
    });
  }, []);

  // this month and the three before it, for the pace chart; the tag toggles filter it below
  const current = thisMonth();
  useEffect(() => {
    fetchLines(addMonths(current, -3)).then(({ lines, error }) => {
      if (error) setError(error.message);
      setLines(lines);
    });
  }, [current]);

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
  // the category-over-time chart's picker: every spending category in picker
  // order, then any others with spending in the range (archived, Uncategorized)
  const categoryOptions = useMemo(() => {
    const options = categories.map((c) => ({ key: c.id, name: c.name }));
    const listed = new Set(options.map((o) => o.key));
    return [...options, ...byCategory.filter((c) => !listed.has(c.key)).map(({ key, name }) => ({ key, name }))];
  }, [categories, byCategory]);
  // ?cat= picks it; otherwise the range's biggest category
  const chartCategory =
    categoryOptions.find((o) => o.key === params.get('cat')) ??
    categoryOptions.find((o) => o.key === byCategory[0]?.key) ??
    categoryOptions[0];

  // averages divide by months that have any data, not every month in the range: before tracking
  // started (or a month with nothing yet), there's nothing to average over
  const activeMonths = useMemo(() => {
    const has = new Set([
      ...(spend ?? []).filter((r) => Number(r.spent) !== 0).map((r) => r.month),
      ...flow.filter((f) => Number(f.income) !== 0 || Number(f.spending) !== 0).map((f) => f.month),
    ]);
    return Math.max(1, months.filter((m) => has.has(m.key)).length);
  }, [spend, flow, months]);

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
      cat: params.get('cat'),
      housing: params.get('housing'),
      ...next,
    };
    setParams(Object.fromEntries(Object.entries(merged).filter(([, v]) => v)) as Record<string, string>);
  }

  const toggleTag = (id: string) =>
    set({ tags: (included.includes(id) ? included.filter((t) => t !== id) : [...included, id]).join(',') || null });

  // this month's spending so far, day by day, against last month and an average month (the
  // earlier three that have any spending; shown when two or more do, else it's just last month)
  // rent is the biggest bill and lands on a different day each month, so it swamps the pace
  // lines; Housing is left out unless its toggle (?housing=1) is on
  const housing = categories.find((c) => c.name === 'Housing')?.id ?? null;
  const withHousing = params.get('housing') === '1';
  const pace = useMemo(() => {
    if (!lines) return null;
    const days = Number(monthEnd(current).slice(8, 10));
    const today = Number(end.slice(8, 10));
    const shown = lines.filter(
      (l) => (withHousing || l.category_id !== housing) && (l.tag_ids.length === 0 || l.tag_ids.some((t) => included.includes(t))),
    );
    const has = new Set(lines.map((l) => l.posted_date.slice(0, 7)));
    const earlier = [1, 2, 3].map((n) => addMonths(current, -n)).filter((m) => has.has(m.slice(0, 7)));
    const series: PaceSeries[] = [{ name: 'This month', color: SPENDING, values: runningTotals(shown, current, days, today) }];
    const last = addMonths(current, -1);
    if (earlier.includes(last)) series.push({ name: 'Last month', color: EARLIER, values: runningTotals(shown, last, days) });
    if (earlier.length >= 2) {
      const curves = earlier.map((m) => runningTotals(shown, m, days) as number[]);
      series.push({
        name: 'Average month',
        color: EARLIER,
        dashed: true,
        values: curves[0].map((_, i) => Math.round((sum(curves.map((c) => c[i])) / curves.length) * 100) / 100),
      });
    }
    return { days, series };
  }, [lines, included, current, end, housing, withHousing]);
  const dayLabel = (day: number) =>
    new Date(`${current.slice(0, 8)}${String(day).padStart(2, '0')}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  /** Opens Spending on a month's rows (`YYYY-MM-01`), optionally one category. */
  const openMonth = (key: string, category?: string) =>
    navigate(`/spending?${new URLSearchParams({ status: 'all', month: key.slice(0, 7), ...(category ? { category } : {}) })}`);

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
        {pace && (
          <>
            <h2>This month</h2>
            <div className="pace-controls">
              {pace.series.length > 1 && <Legend shape="line" items={pace.series} />}
              {housing && (
                <Switch checked={withHousing} onChange={(on) => set({ housing: on ? '1' : null })}>
                  Include Housing
                </Switch>
              )}
            </div>
            <PaceLines days={pace.days} series={pace.series} format={money} label="Spending so far this month, day by day" dayLabel={dayLabel} />
          </>
        )}

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

        {chartCategory && (
          <CategoryOverTime
            category={chartCategory}
            options={categoryOptions}
            months={months}
            activeMonths={activeMonths}
            spend={spend ?? []}
            onPick={(key) => set({ cat: key })}
            onOpenMonth={(key) => openMonth(key, chartCategory.key)}
          />
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

    </section>
  );
}

/** One category's spending month by month, with a dropdown that picks the category. */
function CategoryOverTime({
  category,
  options,
  months,
  activeMonths,
  spend,
  onPick,
  onOpenMonth,
}: {
  category: { key: string; name: string };
  options: { key: string; name: string }[];
  months: MonthKey[];
  /** months in the range with any data: the divisor for averages */
  activeMonths: number;
  spend: SpendRow[];
  onPick: (key: string) => void;
  onOpenMonth: (monthKey: string) => void;
}) {
  const values = monthValues(spend, months, category.key);
  const total = sum(values);
  return (
    <>
      <h2 className="category-over-time">
        <select className="heading-select" aria-label="Category" value={category.key} onChange={(e) => onPick(e.target.value)}>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.name}
            </option>
          ))}
        </select>{' '}
        by month
      </h2>
      <p className="muted small">
        {money(total)} total · {money(total / activeMonths)} avg / month
      </p>
      <TimeLine
        points={months.map((m, i) => ({ date: m.key, long: m.long, value: values[i] }))}
        color={SPENDING}
        name={category.name}
        format={money}
        label={`${category.name} spending by month`}
        selectHint="Enter opens that month's transactions"
        onSelect={onOpenMonth}
      />
    </>
  );
}
