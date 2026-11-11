import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../lib/supabase';
import { byUse } from '../lib/categoryOrder';
import { round, sum } from '../lib/cents';
import { money } from '../lib/format';
import { addMonths, iso, monthEnd, thisMonth, today } from '../lib/months';
import { type FlowRow, NO_CATEGORY, type SpendRow, categoryTotals, fetchReports } from '../lib/reports';
import { TRANSFER_KEY } from '../lib/transactions';
import Button from '../components/Button';
import HeaderFilter from '../components/HeaderFilter';
import Switch from '../components/Switch';
import { Legend, MonthColumns, PaceLines, TimeLine, type PaceSeries } from '../components/charts';
import { strings } from '../lib/strings';

const t = strings.trends;

// series colors (validated for color-blind separation in styles.css)
const INCOME = 'var(--viz-income)';
const SPENDING = 'var(--viz-spending)';
const EARLIER = 'var(--viz-cat-other)';
/** The over-time charts' lines: one is the spending orange; several take the category palette in order. */
const MAX_LINES = 6;
const lineColor = (i: number, count: number) => (count === 1 ? SPENDING : `var(--viz-cat-${i + 1})`);

/** A comma list in the URL; group names are free text, so an item's own commas (and %) are escaped. */
const readList = (value: string | null) =>
  (value ?? '')
    .split(',')
    .filter(Boolean)
    .map((v) => v.replace(/%2C/gi, ',').replace(/%25/g, '%'));
const writeList = (keys: string[]) => keys.map((k) => k.replace(/%/g, '%25').replace(/,/g, '%2C')).join(',') || null;

const RANGES = [
  { key: '12m', label: t.ranges['12m'], months: 12 },
  { key: 'ytd', label: t.ranges.ytd, months: 0 },
  { key: '6m', label: t.ranges['6m'], months: 6 },
  { key: '3m', label: t.ranges['3m'], months: 3 },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];

type TagTotal = { tag_id: string; name: string; transaction_count: number };
type Snapshot = { account_id: string; date: string; balance: string };
type Account = { id: string; connection_id: string | null; balance: string | null; hidden: boolean };
type Category = { id: string; name: string; group_name: string | null; is_income: boolean };
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

/** The spending rows that `keep` accepts, summed for each of `months`. */
function monthValues(spend: SpendRow[], months: MonthKey[], keep: (r: SpendRow) => boolean) {
  return months.map((m) => sum(spend.filter((r) => r.month === m.key && keep(r)).map((r) => Number(r.spent))));
}

/** A category's group, named as Spending's pie names it: Uncategorized, its group, or No group. */
const groupName = (categoryId: string | null, group: string | null | undefined) =>
  categoryId === null ? strings.common.uncategorized : group?.trim() || strings.common.noGroup;

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
 * months, cash flow, one category over time, one category group over time,
 * and net worth.
 *
 * Spending is your share (net of reimbursements), excludes transfers, and
 * and includes tagged spending unless "Include tagged" unticks its tag (`?hidetag=`;
 * every tag is included by default, new ones too).
 * The range buttons (`?range=`) set the months for every chart but the pace.
 */
export default function Trends() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const range: RangeKey = RANGES.find((r) => r.key === params.get('range'))?.key ?? '12m';
  const hiddenTags = useMemo(() => (params.get('hidetag') ?? '').split(',').filter(Boolean), [params]);

  const [spend, setSpend] = useState<SpendRow[] | null>(null);
  const [flow, setFlow] = useState<FlowRow[]>([]);
  // null until loaded: the reports wait for it, since "every tag" needs the list
  const [tags, setTags] = useState<TagTotal[] | null>(null);
  const tagList = tags ?? [];
  const included = useMemo(
    () => (tags ?? []).map((t) => t.tag_id).filter((id) => !hiddenTags.includes(id)),
    [tags, hiddenTags],
  );
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
      db().from('categories').select('id, name, group_name, is_income, transactions(count)').eq('archived', false),
    ]).then(([t, b, a, c]) => {
      const failed = t.error ?? b.error ?? a.error ?? c.error;
      if (failed) setError(failed.message);
      setTags((t.data ?? []) as TagTotal[]);
      setSnapshots((b.data ?? []) as Snapshot[]);
      setAccounts((a.data ?? []) as Account[]);
      const counted = (c.data ?? []) as unknown as (Category & { transactions: { count: number }[] })[];
      setCategories(byUse(counted).map(({ id, name, group_name, is_income }) => ({ id, name, group_name, is_income })));
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
    if (!tags) return;
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
    const options = categories.filter((c) => !c.is_income).map((c) => ({ key: c.id, name: c.name }));
    const listed = new Set(options.map((o) => o.key));
    return [...options, ...byCategory.filter((c) => !listed.has(c.key)).map(({ key, name }) => ({ key, name }))];
  }, [categories, byCategory]);
  // ?cat= picks them, in the order ticked (so a line keeps its color); otherwise the range's biggest category
  const defaultCategory = (categoryOptions.find((o) => o.key === byCategory[0]?.key) ?? categoryOptions[0])?.key;
  const pickedCategories = pickFrom(categoryOptions, readList(params.get('cat')), defaultCategory);

  // the group chart's picker: groups by spending in the range, biggest first, then the
  // spending categories' other groups A–Z; ?group= picks it, else the biggest
  const groupOptions = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of spend ?? []) {
      if (r.month < start) continue;
      const g = groupName(r.category_id, r.category_group);
      totals.set(g, (totals.get(g) ?? 0) + Number(r.spent));
    }
    const ranked = [...totals].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([g]) => g);
    const rest = categories
      .filter((c) => !c.is_income)
      .map((c) => groupName(c.id, c.group_name))
      .filter((g) => !ranked.includes(g))
      .sort((a, b) => a.localeCompare(b));
    return [...new Set([...ranked, ...rest])].map((g) => ({ key: g, name: g }));
  }, [spend, start, categories]);
  const pickedGroups = pickFrom(groupOptions, readList(params.get('group')), groupOptions[0]?.key);

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
      hidetag: hiddenTags.join(',') || null,
      cat: params.get('cat'),
      group: params.get('group'),
      housing: params.get('housing'),
      grouphousing: params.get('grouphousing'),
      ...next,
    };
    setParams(Object.fromEntries(Object.entries(merged).filter(([, v]) => v)) as Record<string, string>);
  }

  // the included tags, in the list's order, for the dropdown's label
  const includedNames = tagList.filter((t) => included.includes(t.tag_id)).map((t) => t.name);
  const allTags = includedNames.length === tagList.length;

  // this month's spending so far, day by day, against last month and an average month (the
  // earlier three that have any spending; shown when two or more do, else it's just last month)
  // rent is the biggest bill and lands on a different day each month, so it swamps the pace
  // lines; Housing is left out unless its toggle (?housing=1) is on
  const housing = categories.find((c) => c.name === t.housing)?.id ?? null;
  const withHousing = params.get('housing') === '1';
  // the group chart has its own Housing switch (?grouphousing=1), off by default like the pace's
  const groupHousing = params.get('grouphousing') === '1';
  const groupHasHousing = categories.some((c) => c.id === housing && pickedGroups.some((g) => g.key === groupName(c.id, c.group_name)));
  const groupLeavesOutHousing = groupHasHousing && !groupHousing;
  const pace = useMemo(() => {
    if (!lines) return null;
    const days = Number(monthEnd(current).slice(8, 10));
    const today = Number(end.slice(8, 10));
    const shown = lines.filter(
      (l) => (withHousing || l.category_id !== housing) && (l.tag_ids.length === 0 || l.tag_ids.some((t) => included.includes(t))),
    );
    const has = new Set(lines.map((l) => l.posted_date.slice(0, 7)));
    const earlier = [1, 2, 3].map((n) => addMonths(current, -n)).filter((m) => has.has(m.slice(0, 7)));
    const series: PaceSeries[] = [{ name: t.thisMonth, color: SPENDING, values: runningTotals(shown, current, days, today) }];
    const last = addMonths(current, -1);
    if (earlier.includes(last)) series.push({ name: t.lastMonth, color: EARLIER, values: runningTotals(shown, last, days) });
    if (earlier.length >= 2) {
      const curves = earlier.map((m) => runningTotals(shown, m, days) as number[]);
      series.push({
        name: t.averageMonth,
        color: EARLIER,
        dashed: true,
        values: curves[0].map((_, i) => round(sum(curves.map((c) => c[i])) / curves.length)),
      });
    }
    return { days, series };
  }, [lines, included, current, end, housing, withHousing]);
  const dayLabel = (day: number) =>
    new Date(`${current.slice(0, 8)}${String(day).padStart(2, '0')}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  /** Opens Spending on a month's rows (`YYYY-MM-01`). */
  const openMonth = (key: string) => navigate(`/spending?${new URLSearchParams({ status: 'all', month: key.slice(0, 7) })}`);
  /** Opens Spending on a month's rows (`YYYY-MM-01`) in just these category keys: every other key hidden. */
  const openShowing = (key: string, shown: string[]) => {
    const hidecat = [...categories.map((c) => c.id), NO_CATEGORY, TRANSFER_KEY].filter((k) => !shown.includes(k));
    navigate(`/spending?${new URLSearchParams({ status: 'all', month: key.slice(0, 7), hidecat: hidecat.join(',') })}`);
  };
  const groupNames = pickedGroups.map((g) => g.key);
  const inPickedGroup = (categoryId: string | null, group: string | null | undefined) =>
    groupNames.includes(groupName(categoryId, group)) && !(groupLeavesOutHousing && categoryId === housing);
  const groupCategoryKeys = [
    ...categories.filter((c) => inPickedGroup(c.id, c.group_name)).map((c) => c.id),
    ...(groupNames.includes(strings.common.uncategorized) ? [NO_CATEGORY] : []),
  ];

  return (
    <section>
      <header className="page-head">
        <h1>{t.title}</h1>
      </header>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="trend-filters">
        <div className="filter range-filter" role="group" aria-label={t.months}>
          {RANGES.map((r) => (
            <Button key={r.key} size="small" aria-pressed={range === r.key} onClick={() => set({ range: r.key === '12m' ? null : r.key })}>
              {r.label}
            </Button>
          ))}
        </div>
        {tagList.length > 0 && (
          <div className="tag-include">
            <HeaderFilter
              label={t.tags}
              items={tagList.map((t) => ({ id: t.tag_id, name: t.name, count: t.transaction_count }))}
              hidden={tagList.map((t) => t.tag_id).filter((id) => !included.includes(id))}
              onChange={(hidden) => set({ hidetag: hidden.join(',') || null })}
              onOnly={(id) => set({ hidetag: tagList.map((t) => t.tag_id).filter((t) => t !== id).join(',') || null })}
              active={!allTags}
              reset={{
                label: strings.common.reset,
                onClick: () => set({ hidetag: null }),
                disabled: allTags,
                title: allTags ? t.everyTag : undefined,
              }}
            >
              {t.includeTagged}{' '}
              {allTags
                ? t.all
                : includedNames.length === 0
                  ? t.none
                  : includedNames[0] + (includedNames.length > 1 ? t.more(includedNames.length - 1) : '')}
            </HeaderFilter>
          </div>
        )}
      </div>

      <div className={loading && spend ? 'trends refetching' : 'trends'}>
        {pace && (
          <>
            <h2>{t.thisMonth}</h2>
            <div className="pace-controls">
              {pace.series.length > 1 && <Legend shape="line" items={pace.series} />}
              {housing && (
                <Switch checked={withHousing} onChange={(on) => set({ housing: on ? '1' : null })}>
                  {t.includeHousing}
                </Switch>
              )}
            </div>
            <PaceLines days={pace.days} series={pace.series} format={money} label={t.paceLabel} dayLabel={dayLabel} />
          </>
        )}

        <h2>{t.cashFlow}</h2>
        <Legend shape="rect" items={[{ name: t.income, color: INCOME }, { name: t.spending, color: SPENDING }]} />
        <MonthColumns
          months={months}
          series={[
            { name: t.income, color: INCOME, values: income },
            { name: t.spending, color: SPENDING, values: spending },
          ]}
          format={money}
          label={t.cashFlowLabel}
          selectHint={t.opensTransactions}
          onSelect={(key) => openMonth(key)}
        />

        {pickedCategories.length > 0 && (
          <PickedOverTime
            title={t.categoriesOverTime}
            pickLabel={t.categories}
            options={categoryOptions}
            picked={pickedCategories}
            isDefault={!params.get('cat')}
            onPick={(keys) => set({ cat: writeList(keys) })}
            months={months}
            series={pickedCategories.map((c, i) => ({
              name: c.name,
              color: lineColor(i, pickedCategories.length),
              values: monthValues(spend ?? [], months, (r) => (r.category_id ?? NO_CATEGORY) === c.key),
            }))}
            onOpenMonth={(key) => openShowing(key, pickedCategories.map((c) => c.key))}
          />
        )}

        {pickedGroups.length > 0 && (
          <PickedOverTime
            title={t.groupsOverTime}
            pickLabel={t.groups}
            options={groupOptions}
            picked={pickedGroups}
            isDefault={!params.get('group')}
            onPick={(keys) => set({ group: writeList(keys) })}
            months={months}
            series={pickedGroups.map((g, i) => ({
              name: g.name,
              color: lineColor(i, pickedGroups.length),
              values: monthValues(
                spend ?? [],
                months,
                (r) => groupName(r.category_id, r.category_group) === g.key && !(groupLeavesOutHousing && r.category_id === housing),
              ),
            }))}
            onOpenMonth={(key) => openShowing(key, groupCategoryKeys)}
            extra={
              groupHasHousing && (
                <Switch checked={groupHousing} onChange={(on) => set({ grouphousing: on ? '1' : null })}>
                  {t.includeHousing}
                </Switch>
              )
            }
          />
        )}

        <h2>{t.netWorth}</h2>
        {netWorth.length > 0 ? (
          <TimeLine
            dates={netWorth}
            series={[{ name: t.netWorth, color: INCOME, values: netWorth.map((p) => p.value) }]}
            format={money}
            label={t.netWorthLabel}
          />
        ) : (
          <p className="empty">{t.noBalances}</p>
        )}
      </div>
    </section>
  );
}

/** The picked options, in `keys` order (unknown keys dropped, at most MAX_LINES); else just `fallback`. */
function pickFrom<T extends { key: string }>(options: T[], keys: string[], fallback: string | undefined): T[] {
  const picked = keys.map((k) => options.find((o) => o.key === k)).filter((o): o is T => !!o);
  const unique = [...new Map(picked.map((o) => [o.key, o])).values()].slice(0, MAX_LINES);
  if (unique.length) return unique;
  const first = options.find((o) => o.key === fallback);
  return first ? [first] : [];
}

/**
 * Categories (or groups) month by month, one line each, with a checklist that
 * picks up to MAX_LINES of them. Reset goes back to the default (the biggest).
 */
function PickedOverTime({
  title,
  pickLabel,
  options,
  picked,
  isDefault,
  onPick,
  months,
  series,
  onOpenMonth,
  extra,
}: {
  title: string;
  /** the checklist's name: Categories or Groups */
  pickLabel: string;
  options: { key: string; name: string }[];
  /** what's showing, in the order ticked (their lines' colors follow it) */
  picked: { key: string; name: string }[];
  /** nothing picked in the URL: Reset has nothing to do */
  isDefault: boolean;
  /** the new picks, in order; [] goes back to the default */
  onPick: (keys: string[]) => void;
  months: MonthKey[];
  /** one line per pick, values per month */
  series: { name: string; color: string; values: number[] }[];
  onOpenMonth: (monthKey: string) => void;
  /** a control at the end of the picker's row (the group chart's Include Housing) */
  extra?: ReactNode;
}) {
  const keys = picked.map((p) => p.key);
  const names = picked.map((p) => p.name);
  return (
    <>
      <h2>{title}</h2>
      <div className="category-picker">
        <span className="series-pick">
          <HeaderFilter
            label={pickLabel}
            items={options.map((o) => ({ id: o.key, name: o.name }))}
            hidden={options.map((o) => o.key).filter((k) => !keys.includes(k))}
            // keep the ticked order, newly ticked ones at the end
            onChange={(hidden) => {
              const ticked = options.map((o) => o.key).filter((k) => !hidden.includes(k));
              onPick([...keys.filter((k) => ticked.includes(k)), ...ticked.filter((k) => !keys.includes(k))]);
            }}
            onOnly={(id) => onPick([id])}
            keepOne
            max={MAX_LINES}
            active={false}
            reset={{ label: strings.common.reset, onClick: () => onPick([]), disabled: isDefault, title: isDefault ? t.biggestAlready : undefined }}
          >
            {names[0] + (names.length > 1 ? t.more(names.length - 1) : '')}
          </HeaderFilter>
        </span>
        {extra && <span className="picker-extra">{extra}</span>}
      </div>
      {series.length > 1 && (
        <div className="series-legend">
          <Legend shape="line" items={series} />
        </div>
      )}
      <TimeLine
        dates={months.map((m) => ({ date: m.key, long: m.long }))}
        series={series}
        format={money}
        label={t.overTimeLabel(names)}
        selectHint={t.opensMonth}
        onSelect={onOpenMonth}
      />
    </>
  );
}
