// The monthly reports behind Spending's month summary and Trends: the
// database functions `monthly_category_spend` and `monthly_cashflow`. Both
// count approved transactions only, your share of each (net of what people owe
// you), no transfers, and untagged spending plus any tags in `includeTags`.
import { db } from './supabase';
import { round } from './cents';

/** One category's spending in one month. `category_id` null = Uncategorized. */
export type SpendRow = { month: string; category_id: string | null; category_name: string | null; spent: string };

/** One month's income and spending. */
export type FlowRow = { month: string; income: string; spending: string; net: string };

/** A category's key in totals and filters: its id, or this for Uncategorized. */
export const NO_CATEGORY = 'none';

export type CategoryTotal = { key: string; name: string; value: number };

/** Both reports, every month. */
export async function fetchReports(includeTags: string[]) {
  const [s, f] = await Promise.all([
    db().rpc('monthly_category_spend', { include_tags: includeTags }),
    db().rpc('monthly_cashflow', { include_tags: includeTags }),
  ]);
  return {
    spend: (s.data ?? []) as SpendRow[],
    flow: (f.data ?? []) as FlowRow[],
    error: s.error ?? f.error,
  };
}

/** Spending per category over the months `keep` accepts: largest first, positive totals only. */
export function categoryTotals(rows: SpendRow[], keep: (month: string) => boolean): CategoryTotal[] {
  const totals = new Map<string, CategoryTotal>();
  for (const r of rows) {
    if (!keep(r.month)) continue;
    const key = r.category_id ?? NO_CATEGORY;
    const t = totals.get(key) ?? { key, name: r.category_name ?? 'Uncategorized', value: 0 };
    t.value = round(t.value + Number(r.spent));
    totals.set(key, t);
  }
  return [...totals.values()].filter((t) => t.value > 0).sort((a, b) => b.value - a.value);
}
