import { useEffect, useMemo, useState } from 'react';
import { sum } from '../lib/cents';
import { money } from '../lib/format';
import { addMonths, monthLong } from '../lib/months';
import { type FlowRow, type SpendRow, categoryTotals, fetchReports, groupTotals } from '../lib/reports';
import Button from './Button';
import Segmented from './Segmented';
import { CategoryPie } from './charts';

/** localStorage key: the pie shows category groups */
const BY_GROUP = 'spending-pie-by-group';

/**
 * One month's normal spending (untagged, your share, no transfers): a month
 * dropdown in line with Spent / Income / Saved, and a category donut whose
 * categories filter the list below it. A Category | Group control above its
 * ranked list shows it by category group instead (remembered in this browser).
 * `version` changes after edits so the numbers follow them.
 */
export default function MonthSpending({
  month,
  current,
  selected,
  hidden,
  version,
  onMonth,
  onSelect,
  groups,
  onError,
}: {
  /** YYYY-MM-01 */
  month: string;
  /** this month, YYYY-MM-01 */
  current: string;
  /** the category key shown alone (highlighted in the pie), if any */
  selected: string | null;
  /** category keys filtered out: faded in the pie (the summary numbers ignore them) */
  hidden: string[];
  version: number;
  onMonth: (key: string) => void;
  /** a slice was tapped */
  onSelect: (key: string) => void;
  /** the pie by group: each category key's group, and the group-level filter state (keys `group:<name>`) */
  groups: { of: (key: string) => string; selected: string | null; hidden: string[]; onSelect: (key: string) => void };
  onError: (message: string) => void;
}) {
  const [spend, setSpend] = useState<SpendRow[] | null>(null);
  const [flow, setFlow] = useState<FlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [byGroup, setByGroup] = useState(() => {
    try {
      return localStorage.getItem(BY_GROUP) === '1';
    } catch {
      return false;
    }
  });
  function showByGroup(on: boolean) {
    setByGroup(on);
    try {
      if (on) localStorage.setItem(BY_GROUP, '1');
      else localStorage.removeItem(BY_GROUP);
    } catch {
      // storage blocked: the switch still works for this visit
    }
  }

  useEffect(() => {
    setLoading(true); // the pie keeps its last render, faded, until this returns
    fetchReports([]).then(({ spend, flow, error }) => {
      if (error) onError(error.message);
      setSpend(spend);
      setFlow(flow);
      setLoading(false);
    });
  }, [version]);

  // every month back to the earliest with spending, newest first, for the dropdown
  const options = useMemo(() => {
    const earliest = (spend ?? []).reduce((a, r) => (r.month < a ? r.month : a), month < current ? month : current);
    const list: string[] = [];
    for (let key = current; key >= earliest; key = addMonths(key, -1)) list.push(key);
    return list;
  }, [spend, month, current]);

  // the pie keeps every category (hidden ones faded, in place), so filtering doesn't reshape it
  const byCategory = useMemo(() => categoryTotals(spend ?? [], (m) => m === month), [spend, month]);
  const visibleTotal = sum(byCategory.filter((t) => !hidden.includes(t.key)).map((t) => t.value));
  const byGroupRows = useMemo(() => groupTotals(byCategory, groups.of), [byCategory, groups.of]);

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
          rows={byGroup ? byGroupRows : byCategory}
          reserveRows={byGroup ? byCategory : byGroupRows}
          format={money}
          total={visibleTotal}
          totalLabel={`spent in ${shortName}`}
          label={`Spending by ${byGroup ? 'category group' : 'category'}, ${monthLong(month)}`}
          selected={byGroup ? groups.selected : selected}
          hidden={byGroup ? groups.hidden : hidden}
          selectHint="Shows its transactions"
          onSelect={byGroup ? groups.onSelect : onSelect}
          listHeader={
            <Segmented
              label="Show the pie by"
              options={[
                { value: 'category', label: 'Category' },
                { value: 'group', label: 'Group' },
              ]}
              value={byGroup ? 'group' : 'category'}
              onChange={(v) => showByGroup(v === 'group')}
            />
          }
        />
      )}
    </div>
  );
}
