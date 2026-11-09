import { useEffect, useMemo, useRef, useState } from 'react';
import { round, sum } from '../lib/cents';
import { money } from '../lib/format';
import { ALL_TIME, addMonths, monthEnd, monthOrAll as monthLong } from '../lib/months';
import { type CategoryTotal, type SummaryLine, fetchEarliestMonth, fetchSummaryLines, groupTotals } from '../lib/reports';
import { UNTAGGED } from '../lib/transactions';
import Button from './Button';
import Segmented from './Segmented';
import { CategoryPie } from './charts';

/** localStorage key: the pie shows category groups */
const BY_GROUP = 'spending-pie-by-group';

/**
 * One month's approved spending (your share, no transfers): a month dropdown in
 * line with Spent / Income / Saved, and a category donut whose categories filter
 * the list below it. The numbers and the pie follow the list's tag filters; hidden
 * categories fade in the pie (in place, so it never reshapes) and leave the numbers. The dropdown ends with All time (every
 * month added up). A Category | Group control above its
 * ranked list shows it by category group instead (remembered in this browser).
 * `version` changes after edits so the numbers follow them.
 */
export default function MonthSpending({
  month,
  current,
  selected,
  hidden,
  tag,
  hiddenTags,
  version,
  onMonth,
  onSelect,
  groups,
  onError,
}: {
  /** YYYY-MM-01, or ALL_TIME for every month added up */
  month: string;
  /** this month, YYYY-MM-01 */
  current: string;
  /** the category key shown alone (highlighted in the pie), if any */
  selected: string | null;
  /** category keys filtered out: faded in the pie and left out of the numbers */
  hidden: string[];
  /** `?tag=`: only transactions carrying it count */
  tag: string | null;
  /** tag ids (or UNTAGGED) filtered out: transactions carrying any of them don't count */
  hiddenTags: string[];
  version: number;
  onMonth: (key: string) => void;
  /** a slice was tapped */
  onSelect: (key: string) => void;
  /** the pie by group: each category key's group, and the group-level filter state (keys `group:<name>`) */
  groups: { of: (key: string) => string; selected: string | null; hidden: string[]; onSelect: (key: string) => void };
  onError: (message: string) => void;
}) {
  const [lines, setLines] = useState<SummaryLine[] | null>(null);
  const [earliest, setEarliest] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);
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

  const allTime = month === ALL_TIME;

  useEffect(() => {
    fetchEarliestMonth().then(({ month, error }) => {
      if (error) onError(error.message);
      setEarliest(month);
    });
  }, [version]);

  useEffect(() => {
    setLoading(true); // the pie keeps its last render, faded, until this returns
    const call = ++latest.current;
    fetchSummaryLines(allTime ? null : month, allTime ? null : monthEnd(month)).then(({ lines, error }) => {
      if (call !== latest.current) return; // a later month was picked meanwhile
      if (error) onError(error.message);
      setLines(lines);
      setLoading(false);
    });
  }, [month, version]);

  // every month back to the earliest with transactions, newest first, then All time
  const options = useMemo(() => {
    const first = [earliest ?? current, allTime ? current : month].reduce((a, b) => (b < a ? b : a), current);
    const list: string[] = [];
    for (let key = current; key >= first; key = addMonths(key, -1)) list.push(key);
    return [...list, ALL_TIME]; // All time last, past the oldest month
  }, [earliest, month, current, allTime]);

  // the list's tag filters, as in lib/transactions fetchRows
  const hiddenTagKey = hiddenTags.join();
  const tagged = useMemo(
    () =>
      (lines ?? []).filter(
        (l) =>
          (!tag || l.tagIds.includes(tag)) &&
          !(hiddenTags.includes(UNTAGGED) && l.tagIds.length === 0) &&
          !l.tagIds.some((t) => hiddenTags.includes(t)),
      ),
    [lines, tag, hiddenTagKey],
  );

  // the pie keeps every category (hidden ones faded, in place), so filtering doesn't reshape it
  const byCategory = useMemo(() => {
    const totals = new Map<string, CategoryTotal>();
    for (const l of tagged) {
      if (!l.spent) continue;
      const t = totals.get(l.key) ?? { key: l.key, name: l.name, value: 0 };
      t.value = round(t.value + l.spent);
      totals.set(l.key, t);
    }
    return [...totals.values()].filter((t) => t.value > 0).sort((a, b) => b.value - a.value);
  }, [tagged]);
  const visibleTotal = sum(byCategory.filter((t) => !hidden.includes(t.key)).map((t) => t.value));
  const byGroupRows = useMemo(() => groupTotals(byCategory, groups.of), [byCategory, groups.of]);

  // Spent / Income / Saved: what the filters leave showing
  const shown = tagged.filter((l) => !hidden.includes(l.key));
  const spending = sum(shown.map((l) => l.spent));
  const income = sum(shown.map((l) => l.income));

  // options run newest first, so "previous" is the next one down the list; the arrows step
  // through months only, so All time has neither
  const months = options.filter((key) => key !== ALL_TIME);
  const at = months.indexOf(month);
  const prev = at >= 0 ? months[at + 1] : undefined;
  const next = at > 0 ? months[at - 1] : undefined;

  const date = new Date((allTime ? current : month) + 'T12:00:00');
  const shortName = date.toLocaleDateString('en-US', {
    month: 'long',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });

  return (
    <div className={loading && lines ? 'trends refetching' : 'trends'}>
      <dl className="stat-row">
        {/* the month sits in line with its numbers; the page title already says "Spending" */}
        <div className="stat-month">
          <Button
            variant="icon"
            aria-label="Previous month"
            disabled={!prev}
            title={prev ? undefined : allTime ? 'Pick a month to step through months' : 'No earlier spending'}
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
            title={next ? undefined : allTime ? 'Pick a month to step through months' : 'This is the current month'}
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
      {lines && !loading && byCategory.length === 0 && <p className="empty">{allTime ? 'No spending yet.' : `No spending in ${monthLong(month)}.`}</p>}
      {byCategory.length > 0 && (
        <CategoryPie
          rows={byGroup ? byGroupRows : byCategory}
          reserveRows={byGroup ? byCategory : byGroupRows}
          format={money}
          total={visibleTotal}
          totalLabel={allTime ? 'spent, all time' : `spent in ${shortName}`}
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
