// The monthly reports behind Spending's month summary and Trends: the
// database functions `monthly_category_spend` and `monthly_cashflow`. Both
// count approved transactions only, your share of each (net of what people owe
// you), no transfers, and untagged spending plus any tags in `includeTags`.
import { db } from './supabase';
import { round } from './cents';

/** One category's spending in one month. `category_id` null = Uncategorized. */
export type SpendRow = { month: string; category_id: string | null; category_name: string | null; category_group: string | null; spent: string };

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

/** Category totals summed by group (`groupOf` names a category key's group), largest first; keys are `group:<name>`. */
export function groupTotals(totals: CategoryTotal[], groupOf: (key: string) => string): CategoryTotal[] {
  const groups = new Map<string, CategoryTotal>();
  for (const t of totals) {
    const name = groupOf(t.key);
    const g = groups.get(name) ?? { key: `group:${name}`, name, value: 0 };
    g.value = round(g.value + t.value);
    groups.set(name, g);
  }
  return [...groups.values()].sort((a, b) => b.value - a.value);
}

/**
 * One approved transaction for Spending's month summary, so the summary can
 * follow the list's category and tag filters: your share of spending (from
 * `spending_lines`) or income (approved money in an Income category).
 */
export type SummaryLine = {
  key: string;
  name: string;
  tagIds: string[];
  accountId: string;
  /** for the list's typed filters (lib/transactions matchesTyped) */
  posted_date: string;
  amount: string;
  description: string;
  merchant_id: string | null;
  spent: number;
  income: number;
};

/** Every summary line posted between `start` and `end` (null = no limit), a page of 1,000 at a time. */
export async function fetchSummaryLines(start: string | null, end: string | null) {
  const lines: SummaryLine[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    let q = db()
      .from('spending_lines')
      .select('transaction_id, category_id, category_name, spent, tag_ids, account_id, posted_date, amount, description, merchant_id');
    if (start) q = q.gte('posted_date', start);
    if (end) q = q.lte('posted_date', end);
    const { data, error } = await q.order('transaction_id').range(from, from + 999);
    if (error) return { lines, error };
    const page = (data ?? []) as {
      category_id: string | null;
      category_name: string | null;
      spent: string;
      tag_ids: string[];
      account_id: string;
      posted_date: string;
      amount: string;
      description: string;
      merchant_id: string | null;
    }[];
    for (const r of page) {
      lines.push({
        key: r.category_id ?? NO_CATEGORY,
        name: r.category_name ?? 'Uncategorized',
        tagIds: r.tag_ids,
        accountId: r.account_id,
        posted_date: r.posted_date,
        amount: r.amount,
        description: r.description,
        merchant_id: r.merchant_id,
        spent: Number(r.spent),
        income: 0,
      });
    }
    if (page.length < 1000) break;
  }
  for (let from = 0; from < 50_000; from += 1000) {
    let q = db()
      .from('transactions')
      .select('id, category_id, account_id, posted_date, amount, description, merchant_id, categories!inner(name, is_income), transaction_tags(tag_id)')
      .eq('categories.is_income', true)
      .eq('approved', true)
      .eq('is_transfer', false)
      .eq('pending', false);
    if (start) q = q.gte('posted_date', start);
    if (end) q = q.lte('posted_date', end);
    const { data, error } = await q.order('id').range(from, from + 999);
    if (error) return { lines, error };
    const page = (data ?? []) as unknown as {
      category_id: string;
      account_id: string;
      posted_date: string;
      amount: string;
      description: string;
      merchant_id: string | null;
      categories: { name: string };
      transaction_tags: { tag_id: string }[];
    }[];
    for (const r of page) {
      lines.push({
        key: r.category_id,
        name: r.categories.name,
        tagIds: r.transaction_tags.map((t) => t.tag_id),
        accountId: r.account_id,
        posted_date: r.posted_date,
        amount: r.amount,
        description: r.description,
        merchant_id: r.merchant_id,
        spent: 0,
        income: Number(r.amount),
      });
    }
    if (page.length < 1000) break;
  }
  return { lines, error: null };
}

/** The month (YYYY-MM-01) of the earliest posted transaction, or null if there are none. */
export async function fetchEarliestMonth() {
  const { data, error } = await db().from('transactions').select('posted_date').eq('pending', false).order('posted_date').limit(1);
  const first = (data?.[0] as { posted_date: string } | undefined)?.posted_date;
  return { month: first ? `${first.slice(0, 7)}-01` : null, error };
}
