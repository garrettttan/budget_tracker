import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../lib/supabase';
import { byUse } from '../lib/categoryOrder';
import { round, sum } from '../lib/cents';
import { money } from '../lib/format';
import { addMonths, iso, monthEnd, thisMonth, today } from '../lib/months';
import { type FlowRow, NO_CATEGORY, type SpendRow, categoryTotals, fetchReports } from '../lib/reports';
import Button from '../components/Button';
import Combobox from '../components/Combobox';
import HeaderFilter from '../components/HeaderFilter';
import Switch from '../components/Switch';
import { Legend, MonthColumns, PaceLines, TimeLine, type PaceSeries } from '../components/charts';

// series colors (validated for color-blind separation in styles.css)
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

type TagTotal = { tag_id: string; name: string; transaction_count: number };
type Snapshot = { account_id: string; date: string; balance: string };
type Account = { id: string; connection_id: string | null; balance: string | null; hidden: boolean };
type Category = { id: string; name: string };
/** A month on a chart's axis: its YYYY-MM-01 key, "Mar" (or "Jan '26"), and "March 2026". */
type MonthKey = { key: string; short: string; long: string };
/** A row of the `spending_lines` view: one approved transaction's share of spending. */
type Line = { posted_date: string; category_id: string | null; spent: string; tag_ids: string[] };

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
    return i < upTo ? round(total) : null;
  });
}

/** A category's spending (NO_CATEGORY = Uncategorized) for each of `months`. */
function monthValues(spend: SpendRow[], months: MonthKey[], category: string) {
  return months.map((m) =>
    sum(spend.filter((r) => r.month === m.key && (r.category_id ?? NO_CATEGORY) === category).map((r) => Number(r.spent))),
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
 * Trends: where the money went over a range of months (one month's category
 * split is on Spending). From the top: this month's pace against earlier
 * months, cash flow, one category over time, and net worth.
 *
 * Spending is your share (net of reimbursements), excludes transfers, and
 * leaves out tagged spending unless "Include tagged" picks its tag (`?tags=`).
 * The range buttons (`?range=`) set the months for every chart but the pace.
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

  // the tag list (for Include tagged) and balances don't depend on the toggles
  useEffect(() => {
    Promise.all([
      db().from('tag_spend').select('tag_id, name, transaction_count').order('name'),
      db().from('balance_snapshots').select('account_id, date, balance').order('date'),
      db().from('accounts').select('id, connection_id, balance, hidden'),
      // most-used first, like every category picker (lib/categoryOrder)
      db().from('categories').select('id, name, transactions(count)').eq('archived', false).eq('is_income', false),
    ]).then(([t, b, a, c]) => {
      const failed = t.error ?? b.error ?? a.error ?? c.error;
      if (failed) setError(failed.message);
      setTags((t.data ?? []) as TagTotal[]);
      setSnapshots((b.data ?? []) as Snapshot[]);
      setAccounts((a.data ?? []) as Account[]);
      const counted = (c.data ?? []) as unknown as (Category & { transactions: { count: number }[] })[];
      setCategories(byUse(counted).map(({ id, name }) => ({ id, name })));
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
    fetchReports(included).then(({ spend, flow, error }) => {
      if (error) setError(error.message);
      setSpend(spend);
      setFlow(flow);
      setLoading(false);
    });
  }, [included]);

  const months = useMemo(() => monthsFor(range), [range]);
  const start = months[0].key;
  const end = today();

  const byCategory = useMemo(() => categoryTotals(spend ?? [], (m) => m >= start), [spend, start]);
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
    // no snapshots yet (only manual accounts, or before the first sync): just today's balances
    if (points.length === 0 && accounts.length) {
      const now = months[months.length - 1];
      points.push({ date: now.key, long: now.long, value: sum(accounts.filter((a) => !a.hidden).map((a) => Number(a.balance ?? 0))) });
    }
    return points;
  }, [snapshots, accounts, months, end]);

  /** Changes the URL's settings; one left out keeps its value, null clears it. */
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

  // the included tags that still exist, in the list's order, for the dropdown's label
  const includedNames = tags.filter((t) => included.includes(t.tag_id)).map((t) => t.name);

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
        values: curves[0].map((_, i) => round(sum(curves.map((c) => c[i])) / curves.length)),
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
          <div className="tag-include">
            <HeaderFilter
              label="Tags"
              items={tags.map((t) => ({ id: t.tag_id, name: t.name, count: t.transaction_count }))}
              hidden={tags.map((t) => t.tag_id).filter((id) => !included.includes(id))}
              onChange={(hidden) => set({ tags: tags.map((t) => t.tag_id).filter((id) => !hidden.includes(id)).join(',') || null })}
              onOnly={(id) => set({ tags: id })}
              active={includedNames.length > 0}
              reset={{
                label: 'Clear',
                onClick: () => set({ tags: null }),
                disabled: includedNames.length === 0,
                title: includedNames.length ? undefined : 'No tags are included',
              }}
            >
              Include tagged:{' '}
              {includedNames.length === 0 ? 'None' : includedNames[0] + (includedNames.length > 1 ? ` +${includedNames.length - 1}` : '')}
            </HeaderFilter>
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
        {netWorth.length > 0 ? (
          <TimeLine points={netWorth} color={INCOME} format={money} label="Net worth by month" />
        ) : (
          <p className="empty">No balances yet. They appear after the first sync.</p>
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
      <h2>Categories over time</h2>
      <div className="category-picker">
        <Combobox
          label="Category"
          options={options.map((o) => ({ value: o.key, text: o.name }))}
          value={category.key}
          onChange={onPick}
        />
        <span className="muted small">
          {money(total)} total · {money(total / activeMonths)} avg / month
        </span>
      </div>
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
