import { useEffect, useMemo, useState } from 'react';
import { db } from '../lib/supabase';
import { money } from '../lib/format';
import { iso, monthLong, sum } from '../lib/months';
import Button from './Button';
import { CategoryPie } from './charts';

type SpendRow = { month: string; category_id: string | null; category_name: string | null; spent: string };
type FlowRow = { month: string; income: string; spending: string };

/**
 * One month's normal spending (untagged, your share, no transfers): a month
 * dropdown in line with Spent / Income / Saved, and a category donut whose
 * categories filter the list below it. `version` changes after edits so the
 * numbers follow them.
 */
export default function MonthSpending({
  month,
  current,
  selected,
  hidden,
  version,
  onMonth,
  onSelect,
  onError,
}: {
  /** YYYY-MM-01 */
  month: string;
  /** this month, YYYY-MM-01 */
  current: string;
  selected: string | null;
  /** category keys filtered out: faded in the pie (the summary numbers ignore them) */
  hidden: string[];
  version: number;
  onMonth: (key: string) => void;
  onSelect: (key: string, name: string) => void;
  onError: (message: string) => void;
}) {
  const [spend, setSpend] = useState<SpendRow[] | null>(null);
  const [flow, setFlow] = useState<FlowRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true); // the pie keeps its last render, faded, until this returns
    Promise.all([
      db().rpc('monthly_category_spend', { include_tags: [] }),
      db().rpc('monthly_cashflow', { include_tags: [] }),
    ]).then(([s, f]) => {
      const failed = s.error ?? f.error;
      if (failed) onError(failed.message);
      setSpend((s.data ?? []) as SpendRow[]);
      setFlow((f.data ?? []) as FlowRow[]);
      setLoading(false);
    });
  }, [version]);

  // every month back to the earliest with spending, newest first, for the dropdown
  const options = useMemo(() => {
    const earliest = (spend ?? []).reduce((a, r) => (r.month < a ? r.month : a), month < current ? month : current);
    const list: string[] = [];
    for (let d = new Date(current + 'T12:00:00'); iso(d) >= earliest; d = new Date(d.getFullYear(), d.getMonth() - 1, 1, 12)) {
      list.push(iso(d));
    }
    return list;
  }, [spend, month, current]);

  // every category's total for the month, hidden ones included
  const allCategories = useMemo(() => {
    const totals = new Map<string, { key: string; name: string; value: number }>();
    for (const r of spend ?? []) {
      if (r.month !== month) continue;
      const key = r.category_id ?? 'none';
      const t = totals.get(key) ?? { key, name: r.category_name ?? 'Uncategorized', value: 0 };
      t.value = Math.round((t.value + Number(r.spent)) * 100) / 100;
      totals.set(key, t);
    }
    return [...totals.values()];
  }, [spend, month]);
  // the pie keeps every category (hidden ones faded, in place), so filtering doesn't reshape it
  const byCategory = allCategories.filter((t) => t.value > 0).sort((a, b) => b.value - a.value);
  const visibleTotal = sum(byCategory.filter((t) => !hidden.includes(t.key)).map((t) => t.value));

  // options run newest first, so "previous" is the next one down the list
  const at = options.indexOf(month);
  const prev = at >= 0 ? options[at + 1] : undefined;
  const next = at > 0 ? options[at - 1] : undefined;

  const flowRow = flow.find((f) => f.month === month);
  const income = Number(flowRow?.income ?? 0);
  // Spent / Income / Saved are the whole month, whatever the filters hide
  const spending = Number(flowRow?.spending ?? 0);
  const date = new Date(month + 'T12:00:00');
  const shortName = date.toLocaleDateString('en-US', {
    month: 'long',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });

  return (
    <div className={loading && spend ? 'trends refetching' : 'trends'}>
      <dl className="stat-row">
        {/* the month sits in line with its numbers; the page title already says "Spending" */}
        <div className="stat-month">
          <Button
            variant="icon"
            aria-label="Previous month"
            disabled={!prev}
            title={prev ? undefined : 'No earlier spending'}
            onClick={() => prev && onMonth(prev)}
          >
            ‹
          </Button>
          <select className="heading-select" aria-label="Month" value={month} onChange={(e) => onMonth(e.target.value)}>
            {options.map((key) => (
              <option key={key} value={key}>
                {monthLong(key)}
              </option>
            ))}
          </select>
          <Button
            variant="icon"
            aria-label="Next month"
            disabled={!next}
            title={next ? undefined : 'This is the current month'}
            onClick={() => next && onMonth(next)}
          >
            ›
          </Button>
        </div>
        <div>
          <dt>Spent</dt>
          <dd>{money(spending)}</dd>
        </div>
        <div>
          <dt>Income</dt>
          <dd>{money(income)}</dd>
        </div>
        <div>
          <dt>{income - spending >= 0 ? 'Saved' : 'Spent more than earned'}</dt>
          <dd>{money(Math.abs(income - spending))}</dd>
        </div>
      </dl>
      {spend && byCategory.length === 0 && <p className="empty">No spending in {monthLong(month)}.</p>}
      {byCategory.length > 0 && (
        <CategoryPie
          rows={byCategory}
          format={money}
          total={visibleTotal}
          totalLabel={`spent in ${shortName}`}
          label={`Spending by category, ${monthLong(month)}`}
          selected={selected}
          hidden={hidden}
          selectHint="Shows its transactions"
          onSelect={(key) => onSelect(key, byCategory.find((c) => c.key === key)?.name ?? '')}
        />
      )}
    </div>
  );
}
