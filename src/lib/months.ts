import { strings } from './strings';
// Calendar months, keyed by their first day as YYYY-MM-01 (what the reporting
// functions return). Dates are built at noon local time so a time zone shift
// can never push them into the day before.

/** A local date as YYYY-MM-DD. */
export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Today as YYYY-MM-DD in local time (what a date input expects). */
export const today = () => iso(new Date());

/** The first of this month, as YYYY-MM-01. */
export const thisMonth = () => {
  const now = new Date();
  return iso(new Date(now.getFullYear(), now.getMonth(), 1, 12));
};

/** The YYYY-MM-01 key `n` months before (negative) or after `key`. */
export const addMonths = (key: string, n: number) => {
  const d = new Date(key + 'T12:00:00');
  return iso(new Date(d.getFullYear(), d.getMonth() + n, 1, 12));
};

/** The last day of the month that `key` (any date in it) falls in. */
export const monthEnd = (key: string) => {
  const d = new Date(key.slice(0, 10) + 'T12:00:00');
  return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
};

/** "November 2026" for a YYYY-MM-01 key. */
export const monthLong = (key: string) =>
  new Date(key + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

/** Reads `?month=YYYY-MM` as a YYYY-MM-01 key, null if missing or malformed. */
export const parseMonth = (value: string | null) => (value && /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : null);

/** `?month=all` and the month key for every month at once (Spending's "All time"). */
export const ALL_TIME = 'all';

/** "November 2026", or "All time". */
export const monthOrAll = (key: string) => (key === ALL_TIME ? strings.format.allTime : monthLong(key));
