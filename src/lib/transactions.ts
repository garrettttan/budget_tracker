// Loading the transaction list on Spending: its row shape, the filters in the
// URL, and the queries behind them.
import { db } from './supabase';
import { NO_CATEGORY } from './reports';
import type { PaymentLink, Reimbursement } from './reimbursements';

/** Rows per page of the list ("Load 100 more"). */
export const PAGE = 100;

/** The Approved column's filter (`?status=`); `all` is the default. */
export type Status = 'review' | 'approved' | 'all';
export const STATUSES: Status[] = ['review', 'approved', 'all'];

// Filter keys beyond ids. Categories (`?hidecat=`) are keyed by id, plus
// NO_CATEGORY (Uncategorized) and TRANSFER_KEY; tags (`?hidetag=`) by id, plus
// UNTAGGED ("No tags"); accounts (`?hideacct=`) by id. Typed filters: Date
// (`?after=`, `?before=`, both inclusive), Merchant (`?merchant=`: text in the
// merchant's name or the bank's) and Amount (`?min=`, `?max=`, in dollars either
// way, so a $60 refund matches like a $60 charge).
export { NO_CATEGORY };
export const TRANSFER_KEY = 'transfer';
export const UNTAGGED = 'untagged';

export type Row = {
  id: string;
  posted_date: string;
  amount: string;
  description: string;
  pending: boolean;
  approved: boolean;
  is_transfer: boolean;
  transfer_pair_id: string | null;
  category_id: string | null;
  account_id: string;
  note: string | null;
  /** 'manual' = entered with Add transaction (only those can be deleted) */
  source: string;
  accounts: { name: string } | null;
  merchant_id: string | null;
  merchants: { name: string } | null;
  transaction_tags: { tag_id: string }[];
  /** what people owe you on this charge */
  reimbursements: Reimbursement[];
  /** what this money in paid back, if it's linked */
  reimbursement_payments: PaymentLink[];
};

const COLUMNS =
  'id, posted_date, amount, description, pending, approved, is_transfer, transfer_pair_id, category_id, account_id, merchant_id, note, source, ' +
  'accounts(name), merchants(name), transaction_tags(tag_id), ' +
  // both tables reach transactions more than one way, so name the foreign key
  'reimbursements!reimbursements_transaction_id_fkey(id, who, amount, status), ' +
  'reimbursement_payments!reimbursement_payments_payment_transaction_id_fkey(amount, reimbursements(who))';

/** What the list shows: a date range (null = open-ended) and the header filters. */
export type Scope = {
  status: Status;
  /** `?tag=`: only rows carrying this tag */
  tag: string | null;
  start: string | null;
  end: string | null;
  hideCategories: string[];
  hideTags: string[];
  /** account ids filtered out */
  hideAccounts: string[];
  /** YYYY-MM-DD, inclusive; within the month, when there is one */
  after: string | null;
  before: string | null;
  merchant: string | null;
  /** dollars, either direction */
  minAmount: number | null;
  maxAmount: number | null;
};

/** The typed filters as the URL holds them, read back into a Scope's fields. */
export function typedFilters(params: URLSearchParams) {
  const date = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(params.get(k) ?? '') ? params.get(k) : null);
  const dollars = (k: string) => {
    const n = Number(params.get(k));
    return params.get(k) && Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    after: date('after'),
    before: date('before'),
    merchant: params.get('merchant')?.trim() || null,
    minAmount: dollars('min'),
    maxAmount: dollars('max'),
  };
}

/** Escapes LIKE's own wildcards, so typed text matches literally. */
const likeText = (text: string) => text.replace(/[\\%_]/g, '\\$&');

/** Merchants whose name contains `text` (any case), for the Merchant filter. */
export async function matchingMerchants(text: string) {
  const { data, error } = await db().from('merchants').select('id').ilike('name', `%${likeText(text)}%`).limit(1000);
  return { ids: ((data ?? []) as { id: string }[]).map((m) => m.id), error };
}

/** What the typed filters need from a row or a totals line. */
type Typed = { posted_date: string; amount: string | number; description: string; merchant_id: string | null };

/**
 * The typed filters, checked here rather than in a query (pending rows, the
 * month's totals). `merchantIds`: matchingMerchants for `scope.merchant`.
 */
export function matchesTyped(r: Typed, scope: Pick<Scope, 'after' | 'before' | 'merchant' | 'minAmount' | 'maxAmount'>, merchantIds: string[]) {
  const size = Math.abs(Number(r.amount));
  return (
    (!scope.after || r.posted_date >= scope.after) &&
    (!scope.before || r.posted_date <= scope.before) &&
    (scope.minAmount === null || size >= scope.minAmount) &&
    (scope.maxAmount === null || size <= scope.maxAmount) &&
    (!scope.merchant ||
      r.description.toLowerCase().includes(scope.merchant.toLowerCase()) ||
      (r.merchant_id !== null && merchantIds.includes(r.merchant_id)))
  );
}

// ---- row helpers -------------------------------------------------------------

/** The merchant's name, else the bank's text. */
export const rowName = (r: Pick<Row, 'merchants' | 'description'>) => r.merchants?.name ?? r.description;

/** The row's key in the Category filter. */
export const categoryKey = (r: Pick<Row, 'category_id' | 'is_transfer'>) =>
  r.is_transfer ? TRANSFER_KEY : (r.category_id ?? NO_CATEGORY);

/** Money out that isn't a transfer: someone can owe you part of it. */
export const isCharge = (r: Row) => Number(r.amount) < 0 && !r.is_transfer;

/** Money in that's linked as someone paying you back. */
export const isLinked = (r: Row) => r.reimbursement_payments.length > 0;

/** How much of a charge is expected back (owed or received; written-off items are yours again). */
export const expectedOn = (r: Row) =>
  r.reimbursements.filter((x) => x.status !== 'written_off').reduce((sum, x) => sum + Number(x.amount), 0);

// ---- queries -----------------------------------------------------------------

/** PostgREST `or` filter keeping rows outside the hidden category keys; null if none are hidden. */
function keepCategories(hidden: string[]): string | null {
  if (hidden.length === 0) return null;
  const ids = hidden.filter((h) => h !== NO_CATEGORY && h !== TRANSFER_KEY);
  // transfers have no category, so each kind of row gets its own branch
  return [
    hidden.includes(TRANSFER_KEY) ? null : 'is_transfer.eq.true',
    hidden.includes(NO_CATEGORY) ? null : 'and(category_id.is.null,is_transfer.eq.false)',
    ids.length ? `category_id.not.in.(${ids.join(',')})` : 'category_id.not.is.null',
  ]
    .filter(Boolean)
    .join(',');
}

/**
 * Rows `from`..`to` (inclusive) of the posted transactions in scope, newest
 * first. Pending rows are fetched separately (fetchPending).
 *
 * Tags need joins: `?tag=` adds an inner join on that tag (while
 * `transaction_tags` still lists all of each row's tags); hidden tags are an
 * anti-join (rows whose `hidden_tags` embed comes back empty carry none of
 * them); hiding "No tags" adds an inner join on any tag.
 */
export async function fetchRows(scope: Scope, from: number, to: number) {
  const merchants = scope.merchant ? await matchingMerchants(scope.merchant) : null;
  if (merchants?.error) return { data: null, error: merchants.error };
  const hiddenTagIds = scope.hideTags.filter((t) => t !== UNTAGGED);
  const hideUntagged = scope.hideTags.includes(UNTAGGED);
  const embeds = [
    COLUMNS,
    scope.tag ? 'tag_filter:transaction_tags!inner(tag_id)' : null,
    hiddenTagIds.length ? 'hidden_tags:transaction_tags!left(tag_id)' : null,
    hideUntagged ? 'has_tag:transaction_tags!inner(tag_id)' : null,
  ];
  let q = db()
    .from('transactions')
    .select(embeds.filter(Boolean).join(', '))
    .eq('pending', false);
  if (scope.tag) q = q.eq('tag_filter.tag_id', scope.tag);
  if (hiddenTagIds.length) q = q.in('hidden_tags.tag_id', hiddenTagIds).is('hidden_tags', null);
  const keep = keepCategories(scope.hideCategories);
  if (keep) q = q.or(keep);
  if (scope.hideAccounts.length) q = q.not('account_id', 'in', `(${scope.hideAccounts.join(',')})`);
  if (scope.after) q = q.gte('posted_date', scope.after);
  if (scope.before) q = q.lte('posted_date', scope.before);
  if (scope.maxAmount !== null) q = q.gte('amount', -scope.maxAmount).lte('amount', scope.maxAmount);
  if (scope.minAmount !== null) q = q.or(`amount.gte.${scope.minAmount},amount.lte.${-scope.minAmount}`);
  if (scope.merchant && merchants) {
    // quoted, since the text can hold commas or parentheses; * is the wildcard here
    const text = `"*${likeText(scope.merchant).replace(/["\\]/g, '\\$&')}*"`;
    q = q.or([`description.ilike.${text}`, merchants.ids.length ? `merchant_id.in.(${merchants.ids.join(',')})` : null].filter(Boolean).join(','));
  }
  if (scope.start) q = q.gte('posted_date', scope.start);
  if (scope.end) q = q.lte('posted_date', scope.end);
  if (scope.status !== 'all') q = q.eq('approved', scope.status === 'approved');
  return q.order('posted_date', { ascending: false }).order('id', { ascending: false }).range(from, to);
}

/**
 * Every pending row (there are only ever a few), filtered here rather than in
 * the query. They carry no tags, so only hidden categories and accounts, the
 * date range and the typed filters apply, and hiding "No tags" hides them all.
 */
export async function fetchPending(scope: Scope) {
  const merchants = scope.merchant ? await matchingMerchants(scope.merchant) : null;
  if (merchants?.error) return { rows: [], error: merchants.error };
  const { data, error } = await db()
    .from('transactions')
    .select(COLUMNS)
    .eq('pending', true)
    .order('posted_date', { ascending: false })
    .order('id', { ascending: false });
  const shown = (r: Row) =>
    !scope.hideCategories.includes(categoryKey(r)) &&
    !scope.hideAccounts.includes(r.account_id) &&
    matchesTyped(r, scope, merchants?.ids ?? []) &&
    (!scope.start || r.posted_date >= scope.start) &&
    (!scope.end || r.posted_date <= scope.end);
  const rows = scope.hideTags.includes(UNTAGGED) ? [] : ((data ?? []) as unknown as Row[]).filter(shown);
  return { rows, error };
}

/** How many transactions in range have each category key, each tag (`UNTAGGED` = none) and each account. */
export type Present = { categories: Map<string, number>; tags: Map<string, number>; accounts: Map<string, number> };

/**
 * What the header filters list: what the list's range, approval filter and
 * `?tag=` hold, ignoring the header filters themselves (so an unticked item
 * stays listed and can be ticked again). Only four small columns, a page of
 * 1,000 at a time.
 */
export async function fetchPresent({ status, tag, start, end }: Scope) {
  const present: Present = { categories: new Map(), tags: new Map(), accounts: new Map() };
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const columns = 'category_id, is_transfer, account_id, transaction_tags(tag_id)';
  for (let from = 0; from < 50_000; from += 1000) {
    let q = db()
      .from('transactions')
      .select(tag ? `${columns}, tag_filter:transaction_tags!inner(tag_id)` : columns)
      .eq('pending', false);
    if (tag) q = q.eq('tag_filter.tag_id', tag);
    if (start) q = q.gte('posted_date', start);
    if (end) q = q.lte('posted_date', end);
    if (status !== 'all') q = q.eq('approved', status === 'approved');
    const { data, error } = await q.order('id').range(from, from + 999);
    if (error) return { present, error };
    const page = (data ?? []) as unknown as Pick<Row, 'category_id' | 'is_transfer' | 'account_id' | 'transaction_tags'>[];
    for (const r of page) {
      bump(present.categories, categoryKey(r));
      bump(present.accounts, r.account_id);
      if (r.transaction_tags.length === 0) bump(present.tags, UNTAGGED);
      for (const t of r.transaction_tags) bump(present.tags, t.tag_id);
    }
    if (page.length < 1000) break;
  }
  return { present, error: null };
}

/** Money in waiting for review: candidates for "Paid back?" (a linked payment is already approved). */
export function fetchUnreviewedIncome() {
  return db()
    .from('transactions')
    .select('id, posted_date, amount, description, accounts(name), merchants(name)')
    .eq('approved', false)
    .eq('pending', false)
    .eq('is_transfer', false)
    .gt('amount', 0)
    .order('posted_date')
    .limit(200);
}
