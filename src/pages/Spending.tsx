import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { db } from '../lib/supabase';
import { byUse } from '../lib/categoryOrder';
import { money, plural, shortDate } from '../lib/format';
import { ALL_TIME, monthEnd, monthLong, parseMonth, thisMonth } from '../lib/months';
import { type OpenItem, fetchOpen, payers, personKey, suggestFor } from '../lib/reimbursements';
import {
  NO_CATEGORY,
  PAGE,
  type Present,
  type Row,
  type Scope,
  STATUSES,
  type Status,
  TRANSFER_KEY,
  UNTAGGED,
  fetchPending,
  fetchPresent,
  typedFilters,
  fetchRows,
  fetchUnreviewedIncome,
  isLinked,
  rowName,
} from '../lib/transactions';
import AddTransaction, { type AccountOption } from '../components/AddTransaction';
import BulkBar from '../components/BulkBar';
import Button from '../components/Button';
import { type Category, TRANSFER, UNCATEGORIZED } from '../components/CategorySelect';
import HeaderFields from '../components/HeaderFields';
import HeaderFilter from '../components/HeaderFilter';
import MonthSpending from '../components/MonthSpending';
import ReimbursementSuggestions, { type PaymentRow, type ReimbursementMatch } from '../components/ReimbursementSuggestions';
import type { Tag } from '../components/TagCell';
import TransactionRow, { PendingRow } from '../components/TransactionRow';
import TransferSuggestions, { type Suggestion } from '../components/TransferSuggestions';

/** The URL's filters (see Scope); `setFilters` changes any of them. */
type Filters = Partial<
  Record<'status' | 'tag' | 'month' | 'hidecat' | 'hidetag' | 'hideacct' | 'after' | 'before' | 'merchant' | 'min' | 'max', string | null>
>;
const TYPED = ['after', 'before', 'merchant', 'min', 'max'] as const;

/** A database call as `act` runs it. */
type Action = () => PromiseLike<{ data?: unknown; error: { message: string } | null }>;

/**
 * Spending: a month's totals and category donut on top, then every
 * transaction, which is also the review inbox.
 *
 * The list's column headers filter it (Approved → `?status=`, Category →
 * `?hidecat=`, Tags → `?hidetag=` or `?tag=`, Account → `?hideacct=`, and typed:
 * Date → `?after=&before=`, Merchant → `?merchant=`, Amount → `?min=&max=`). All and
 * Approved show the month picked above (`?month=`, or `all` for All time), and so
 * do the totals and pie, which follow the other filters too; To review isn't limited to it.
 * A link's `?category=` (Settings, Trends) becomes Only that category.
 *
 * Each posted row can be categorized, tagged, approved or unapproved, and
 * has a ⋯ menu of reimbursement actions; selected rows get bulk actions.
 */
export default function Spending({
  unreviewed,
  onApprovalsChanged,
}: {
  /** the to-review count, for the Approved filter's label */
  unreviewed: number | null;
  /** refreshes that count (and the nav badge) after a change */
  onApprovalsChanged: () => Promise<void>;
}) {
  // ---- filters, from the URL ---------------------------------------------------

  const [params, setParams] = useSearchParams();
  const status: Status = STATUSES.find((s) => s === params.get('status')) ?? 'all';
  const tagFilter = params.get('tag');
  const categoryLink = params.get('category');
  const current = thisMonth();
  const asked = parseMonth(params.get('month'));
  const month = params.get('month') === ALL_TIME ? ALL_TIME : asked && asked <= current ? asked : current;
  const monthScoped = status !== 'review' && month !== ALL_TIME;
  const hidecat = params.get('hidecat') ?? '';
  const hidetag = params.get('hidetag') ?? '';
  const hideacct = params.get('hideacct') ?? '';
  const typedKey = TYPED.map((k) => params.get(k) ?? '').join('|');
  const typed = useMemo(() => typedFilters(params), [typedKey]);
  const scope: Scope = useMemo(
    () => ({
      status,
      tag: tagFilter,
      start: monthScoped ? month : null,
      end: monthScoped ? monthEnd(month) : null,
      hideCategories: hidecat.split(',').filter(Boolean),
      hideTags: hidetag.split(',').filter(Boolean),
      hideAccounts: hideacct.split(',').filter(Boolean),
      ...typed,
    }),
    [status, tagFilter, monthScoped, month, hidecat, hidetag, hideacct, typed],
  );
  const { hideCategories, hideTags, hideAccounts } = scope;

  /** Changes filters in the URL; one left out keeps its value, null clears it. */
  function setFilters(next: Filters) {
    setNotice(null);
    setError(null);
    const merged = {
      status: status === 'all' ? null : status,
      tag: tagFilter,
      month: params.get('month'),
      hidecat: hidecat || null,
      hidetag: hidetag || null,
      hideacct: hideacct || null,
      ...Object.fromEntries(TYPED.map((k) => [k, params.get(k)])),
      ...next,
    };
    if (merged.status === 'all') merged.status = null; // the default
    setParams(Object.fromEntries(Object.entries(merged).filter(([, v]) => v)) as Record<string, string>);
  }

  // ---- state ---------------------------------------------------------------------

  const [rows, setRows] = useState<Row[] | null>(null);
  const [pending, setPending] = useState<Row[]>([]);
  const [hasMore, setHasMore] = useState(false);
  // what the range holds, for the header filters (null until loaded: everything is listed)
  const [present, setPresent] = useState<Present | null>(null);
  // the list fades while new rows load (only if it takes a moment: see .refetching)
  const [reloading, setReloading] = useState(false);
  const latestReload = useRef(0);

  const [categories, setCategories] = useState<Category[] | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [accountNames, setAccountNames] = useState<Map<string, string>>(new Map());
  const [entryAccounts, setEntryAccounts] = useState<AccountOption[]>([]);

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState<OpenItem[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [paybacks, setPaybacks] = useState<ReimbursementMatch[]>([]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // bumped after edits so the month's totals (MonthSpending) follow them
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  // ---- loading -------------------------------------------------------------------

  // categories, tags and accounts: loaded once
  useEffect(() => {
    Promise.all([
      // most-used first in every picker (lib/categoryOrder)
      db().from('categories').select('id, name, is_income, group_name, transactions(count)').eq('archived', false),
      db().from('accounts').select('id, name, class, connection_id, hidden').order('sort_order').order('name'),
      db().from('tags').select('id, name').order('name'),
    ]).then(([c, a, t]) => {
      const failed = c.error ?? a.error ?? t.error;
      if (failed) setError(failed.message);
      const counted = (c.data ?? []) as unknown as (Category & { transactions: { count: number }[] })[];
      setCategories(byUse(counted).map(({ id, name, is_income, group_name }) => ({ id, name, is_income, group_name })));
      const all = (a.data ?? []) as { id: string; name: string; class: string; connection_id: string | null; hidden: boolean }[];
      setAccountNames(new Map(all.map((x) => [x.id, x.name])));
      // Add transaction's accounts: no investments (balance-only) or hidden ones; manual accounts first
      setEntryAccounts(
        all
          .filter((x) => x.class !== 'investment' && !x.hidden)
          .map((x) => ({ id: x.id, name: x.name, manual: x.connection_id === null }))
          .sort((x, y) => Number(y.manual) - Number(x.manual)),
      );
      setTags((t.data ?? []) as Tag[]);
    });
  }, []);

  /** Loads the first `size` rows in scope, plus everything shown around them. */
  const reload = useCallback(
    async (size: number) => {
      // a later reload (e.g. the next filter tap) wins, even if this one answers last
      const mine = ++latestReload.current;
      setReloading(true);
      const none = Promise.resolve({ data: [], error: null });
      // pending rows are never approved and carry no tags, so Approved and a tag filter leave them out
      const withPending = status !== 'approved' && !tagFilter;
      const [t, p, s, o, w, m, h] = await Promise.all([
        fetchRows(scope, 0, size - 1),
        withPending ? fetchPending(scope) : Promise.resolve({ rows: [], error: null }),
        withPending
          ? db()
              .from('transfer_suggestions')
              .select('out_id, in_id, out_account_id, in_account_id, amount, out_date, in_date')
              .order('out_date')
          : none,
        fetchOpen(),
        db().from('reimbursements').select('who'),
        withPending ? fetchUnreviewedIncome() : none,
        fetchPresent(scope),
      ]);
      if (h.error) setError(h.error.message);
      setPresent(h.present);
      if (mine !== latestReload.current) return;
      setReloading(false);
      const failed = t.error ?? p.error ?? s.error ?? w.error ?? m.error;
      if (failed) setError(failed.message);
      if (o.error) setError(o.error);

      const loaded = (t.data ?? []) as unknown as Row[];
      setRows(loaded);
      setHasMore(loaded.length === size);
      setPending(p.rows);
      setSuggestions((s.data ?? []) as Suggestion[]);
      // drop selected rows that left the list (approved out of To review, untagged out of a tag filter)
      const visible = new Set(loaded.map((r) => r.id));
      setSelected((sel) => ([...sel].some((id) => !visible.has(id)) ? new Set([...sel].filter((id) => visible.has(id))) : sel));

      setOpen(o.items);
      // everyone you've entered before, for Expect reimbursement's suggestions
      const names = new Map<string, string>();
      for (const r of (w.data ?? []) as { who: string }[]) names.set(personKey(r.who), r.who.trim());
      setPeople([...names.values()].sort((x, y) => x.localeCompare(y)));
      setPaybacks(
        ((m.data ?? []) as unknown as PaymentRow[]).flatMap((payment) => {
          const text = `${payment.description} ${payment.merchants?.name ?? ''}`;
          const match = suggestFor({ amount: Number(payment.amount), text }, o.items);
          return match ? [{ payment, items: match.items }] : [];
        }),
      );
    },
    [scope, status, tagFilter],
  );

  // a link's ?category= (Settings → Categories, Trends) means Only that category, like a pie tap
  useEffect(() => {
    if (!categoryLink || !categories) return;
    const others = [...categories.map((c) => c.id), NO_CATEGORY, TRANSFER_KEY].filter((k) => k !== categoryLink);
    const next = new URLSearchParams(params);
    next.delete('category');
    if (next.get('status') === 'all') next.delete('status'); // the default
    next.set('hidecat', others.join(','));
    setParams(next, { replace: true });
  }, [categoryLink, categories]);

  // categories first, so rows never flash an empty picker (and a ?category= link is converted first)
  useEffect(() => {
    if (!categories || categoryLink) return;
    // the rows on screen stay until the new ones arrive: no blink, and an open header filter stays open
    setSelected(new Set());
    reload(PAGE);
  }, [categories, categoryLink, reload]);

  const reloadShown = () => reload(Math.max(rows?.length ?? 0, PAGE));

  async function loadMore() {
    const from = rows?.length ?? 0;
    setBusy(true);
    const { data, error } = await fetchRows(scope, from, from + PAGE - 1);
    if (error) setError(error.message);
    else {
      setRows((rs) => [...(rs ?? []), ...((data ?? []) as unknown as Row[])]);
      setHasMore((data ?? []).length === PAGE);
    }
    setBusy(false);
  }

  /**
   * Runs one change, then reloads the rows on screen, the to-review count and
   * the month's totals. Says `success(data)` if it worked; returns whether it did.
   */
  async function act(action: Action, success: (data: unknown) => string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error } = await action();
    if (error) setError(error.message);
    await reloadShown();
    await onApprovalsChanged();
    bump();
    if (!error) setNotice(success(data)); // after the reload, so the list already shows it
    setBusy(false);
    return !error;
  }

  // ---- category and approval ---------------------------------------------------

  const pairNote = (r: Row) => (r.transfer_pair_id ? ' The other side of the transfer is back in To review.' : '');

  async function setCategory(r: Row, value: string) {
    if (value === TRANSFER) {
      return act(() => db().rpc('mark_transfer', { p_id: r.id }), () => `${rowName(r)} is now a transfer and approved.`);
    }
    const id = value === UNCATEGORIZED ? null : value; // Uncategorized = no category
    if (r.approved) {
      const category = id ? categories?.find((c) => c.id === id)?.name : 'Uncategorized';
      return act(
        () => db().rpc('recategorize_transactions', { p_ids: [r.id], p_category: id }),
        () => `${rowName(r)} is now ${category}.${pairNote(r)}`,
      );
    }
    // just a pre-fill: the row stays unapproved until you approve it
    setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, category_id: id } : x)) ?? null);
    const { error } = await db().from('transactions').update({ category_id: id }).eq('id', r.id);
    if (error) setError(error.message);
    bump();
  }

  const approve = (ids: string[]) =>
    act(
      () => db().rpc('approve_transactions', { p_ids: ids }),
      (n) => `Approved ${plural(Number(n), 'transaction')}.`,
    );

  function toggleApproved(r: Row) {
    // flip the box right away; the reload that follows confirms it
    setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, approved: !x.approved } : x)) ?? null);
    if (!r.approved) return approve([r.id]);
    return act(
      () => db().rpc('send_to_review', { p_ids: [r.id] }),
      () => `${rowName(r)} is back in To review.${pairNote(r)}`,
    );
  }

  // ---- tags ----------------------------------------------------------------------

  const tagName = (id: string) => tags.find((t) => t.id === id)?.name ?? 'a deleted tag';
  const tagIds = (r: Row) => r.transaction_tags.map((x) => x.tag_id);

  /** The tag called `typed` (ignoring case), created if there's none yet; null if that failed. */
  async function findOrCreateTag(typed: string): Promise<Tag | null> {
    const existing = tags.find((t) => t.name.toLowerCase() === typed.toLowerCase());
    if (existing) return existing;
    const { data, error } = await db().from('tags').insert({ name: typed }).select('id, name').single();
    if (error) {
      setError(error.message);
      return null;
    }
    const tag = data as Tag;
    setTags((ts) => [...ts, tag].sort((a, b) => a.name.localeCompare(b.name)));
    return tag;
  }

  /** Shows a row's tag change right away, then saves it; reloads the rows if saving failed. */
  async function saveTags(r: Row, next: string[], save: Action) {
    setError(null);
    setNotice(null);
    setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, transaction_tags: next.map((tag_id) => ({ tag_id })) } : x)) ?? null);
    const { error } = await save();
    if (error) {
      setError(error.message);
      await reloadShown();
    }
    bump(); // tagged spending leaves the month's totals
  }

  function addTag(r: Row, tagId: string) {
    if (tagIds(r).includes(tagId)) return;
    return saveTags(r, [...tagIds(r), tagId], () => db().from('transaction_tags').insert({ transaction_id: r.id, tag_id: tagId }));
  }

  function removeTag(r: Row, tagId: string) {
    return saveTags(
      r,
      tagIds(r).filter((x) => x !== tagId),
      () => db().from('transaction_tags').delete().eq('transaction_id', r.id).eq('tag_id', tagId),
    );
  }

  async function createTag(r: Row, typed: string) {
    const tag = await findOrCreateTag(typed);
    if (tag) return addTag(r, tag.id);
  }

  // ---- reimbursements and deleting -----------------------------------------------

  const expect = (r: Row, who: string, amount: number, note: string) =>
    act(
      () => db().rpc('expect_reimbursement', { p_transaction: r.id, p_who: who, p_amount: amount, p_note: note || null }),
      () => `${who} owes you ${money(amount)} for ${rowName(r)}. It's on Owed to me, and only your share counts as spending.`,
    );

  const link = (paymentId: string, ids: string[]) =>
    act(
      () => db().rpc('link_reimbursement_payment', { p_payment: paymentId, p_reimbursements: ids }),
      (n) => `Linked ${money(Number(n))} as paid back. It's approved and doesn't count as income.`,
    );

  const unlink = (r: Row) =>
    act(
      () => db().rpc('unlink_reimbursement_payment', { p_payment: r.id }),
      () => `Unlinked ${rowName(r)}. It's back in To review, and what it paid back is owed again.`,
    );

  /** Rows you entered by hand can be deleted; the database tidies what hangs off them. */
  function remove(r: Row) {
    const also = [
      r.reimbursements.length ? 'what people owe you on it is removed too' : '',
      isLinked(r) ? `what it paid back is owed again by ${payers(r.reimbursement_payments)}` : '',
      r.transfer_pair_id ? 'the other side of the transfer goes back to To review' : '',
    ].filter(Boolean);
    const summary = `${rowName(r)} (${money(r.amount)}, ${shortDate(r.posted_date)})`;
    if (!window.confirm(`Delete ${summary}? This can’t be undone${also.length ? `; ${also.join(', and ')}` : ''}.`)) return;
    return act(
      () => db().rpc('delete_manual_transaction', { p_id: r.id }),
      () => `Deleted ${summary}.`,
    );
  }

  // ---- selected rows -------------------------------------------------------------

  const selectedRows = (rows ?? []).filter((r) => selected.has(r.id));
  // no category is fine: it's approved as Uncategorized
  const approvable = selectedRows.filter((r) => !r.approved);
  const allSelected = Boolean(rows?.length) && rows!.every((r) => selected.has(r.id));
  // a linked payback has no category ("Payback, not income")
  const categorizable = selectedRows.filter((r) => !isLinked(r));
  const tagsOnSelected = tags.filter((t) => selectedRows.some((r) => tagIds(r).includes(t.id)));

  function toggleSelected(id: string) {
    setSelected((sel) => {
      const next = new Set(sel);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set((rows ?? []).map((r) => r.id)));

  /**
   * Gives every selected row one category. Approved rows are recategorized
   * (which teaches merchant memory and un-pairs transfers); rows in To review
   * just get it as a pre-fill and stay unapproved, as with a single row.
   */
  function categorizeSelected(value: string) {
    const id = value === UNCATEGORIZED ? null : value; // Uncategorized = no category
    const name = id ? categories?.find((c) => c.id === id)?.name : 'Uncategorized';
    const approvedIds = categorizable.filter((r) => r.approved).map((r) => r.id);
    const reviewIds = categorizable.filter((r) => !r.approved).map((r) => r.id);
    const pairs = categorizable.some((r) => r.approved && r.transfer_pair_id);
    return act(
      async () => {
        if (approvedIds.length) {
          const res = await db().rpc('recategorize_transactions', { p_ids: approvedIds, p_category: id });
          if (res.error) return res;
        }
        if (reviewIds.length) return db().from('transactions').update({ category_id: id }).in('id', reviewIds);
        return { error: null };
      },
      () =>
        `${plural(categorizable.length, 'transaction')} ${categorizable.length === 1 ? 'is' : 'are'} now ${name}.` +
        (pairs ? ' The other sides of their transfers are back in To review.' : ''),
    );
  }

  /** Adds the tag to every selected row that doesn't have it yet. */
  function tagSelected(tagId: string, name = tagName(tagId)) {
    const missing = selectedRows.filter((r) => !tagIds(r).includes(tagId));
    if (missing.length === 0) return setNotice(`All selected transactions already carry ${name}.`);
    return act(
      () =>
        db()
          .from('transaction_tags')
          .upsert(
            missing.map((r) => ({ transaction_id: r.id, tag_id: tagId })),
            { onConflict: 'transaction_id,tag_id', ignoreDuplicates: true },
          ),
      () => `Tagged ${plural(missing.length, 'transaction')} ${name}.`,
    );
  }

  async function createTagForSelected(typed: string) {
    const tag = await findOrCreateTag(typed);
    if (tag) return tagSelected(tag.id, tag.name);
  }

  function untagSelected(tagId: string) {
    const carrying = selectedRows.filter((r) => tagIds(r).includes(tagId)).map((r) => r.id);
    return act(
      () => db().from('transaction_tags').delete().eq('tag_id', tagId).in('transaction_id', carrying),
      () => `Removed ${tagName(tagId)} from ${plural(carrying.length, 'transaction')}.`,
    );
  }

  // ---- header filters ------------------------------------------------------------

  // anything filtered: shows "Filters are on · Show all"
  const filtering =
    hideCategories.length > 0 ||
    hideTags.length > 0 ||
    hideAccounts.length > 0 ||
    TYPED.some((k) => params.get(k)) ||
    Boolean(tagFilter) ||
    status !== 'all';

  // Approved: both ticked = All (no `?status=`); one unticked = To review or Approved only
  const approvalItems = [
    { id: 'review', name: `To review${unreviewed ? ` (${unreviewed})` : ''}` },
    { id: 'approved', name: 'Approved' },
  ];
  const approvalHidden = status === 'review' ? ['approved'] : status === 'approved' ? ['review'] : [];
  function setApprovalHidden(next: string[]) {
    if (next.length > 1) return; // hiding both would show nothing
    setFilters({ status: next.includes('approved') ? 'review' : next.includes('review') ? 'approved' : 'all' });
  }

  const allCategoryItems = [
    ...(categories ?? []).map((c) => ({ id: c.id, name: c.name })),
    { id: NO_CATEGORY, name: 'Uncategorized' },
    { id: TRANSFER_KEY, name: 'Transfer' },
  ];
  const allTagItems = [{ id: UNTAGGED, name: 'No tags' }, ...tags.map((t) => ({ id: t.id, name: t.name }))];
  // the headers list only what this range holds, with counts; unticked items stay so they can come back
  const listed = (items: { id: string; name: string }[], counts: Map<string, number> | undefined, hidden: string[]) =>
    counts ? items.filter((i) => counts.has(i.id) || hidden.includes(i.id)).map((i) => ({ ...i, count: counts.get(i.id) ?? 0 })) : items;
  const categoryItems = listed(allCategoryItems, present?.categories, hideCategories);
  // showing one tag (?tag=) reads as every other one unticked, so the header turns teal
  const tagHidden = tagFilter ? allTagItems.map((i) => i.id).filter((k) => k !== tagFilter) : hideTags;
  const tagItems = listed(allTagItems, present?.tags, tagHidden);
  // every account, hidden ones too (their transactions still show)
  const accountItems = listed(
    [...accountNames].map(([id, name]) => ({ id, name })),
    present?.accounts,
    hideAccounts,
  );

  /** Only one category: hide every other key (every key, so switching months keeps showing just this one). */
  const onlyCategory = (key: string) => setFilters({ hidecat: allCategoryItems.map((i) => i.id).filter((k) => k !== key).join(',') || null });
  // the one category left showing, if just one is (the pie highlights it)
  const visibleCategories = allCategoryItems.filter((i) => !hideCategories.includes(i.id));
  const onlyKey = hideCategories.length > 0 && visibleCategories.length === 1 ? visibleCategories[0].id : null;
  /** A pie slice: the same as Only in the Category header; tapping it again shows every category. */
  const pickCategory = (key: string) => (onlyKey === key ? setFilters({ hidecat: null }) : onlyCategory(key));

  // the pie by group: a group is a set of category keys, so its filters are hidecat too
  const groupOf = (key: string) =>
    key === NO_CATEGORY
      ? 'Uncategorized'
      : key === TRANSFER_KEY
        ? 'Transfer'
        : categories?.find((c) => c.id === key)?.group_name?.trim() || 'No group';
  const groupKeys = (name: string) => allCategoryItems.map((i) => i.id).filter((k) => groupOf(k) === name);
  const groupNames = [...new Set(allCategoryItems.map((i) => groupOf(i.id)))];
  // faded when every category in it is hidden
  const hiddenGroups = groupNames.filter((g) => groupKeys(g).every((k) => hideCategories.includes(k))).map((g) => `group:${g}`);
  // highlighted when exactly its categories are showing
  const visibleGroups = [...new Set(visibleCategories.map((i) => groupOf(i.id)))];
  const onlyGroup =
    hideCategories.length > 0 && visibleGroups.length === 1 && groupKeys(visibleGroups[0]).every((k) => !hideCategories.includes(k))
      ? `group:${visibleGroups[0]}`
      : null;
  /** A group slice: only that group's categories; tapping it again shows every category. */
  const pickGroup = (key: string) => {
    if (onlyGroup === key) return setFilters({ hidecat: null });
    const name = key.slice('group:'.length);
    setFilters({ hidecat: allCategoryItems.map((i) => i.id).filter((k) => groupOf(k) !== name).join(',') || null });
  };
  /** Only one tag: the `?tag=` filter, so rows with that tag and others still show. */
  const onlyTag = (id: string) =>
    id === UNTAGGED ? setFilters({ tag: null, hidetag: tags.map((t) => t.id).join(',') || null }) : setFilters({ tag: id, hidetag: null });

  // ---- render --------------------------------------------------------------------

  // pending rows join the list by date (newest first; pending first on the same day)
  const shownRows = [...pending, ...(rows ?? [])].sort(
    (a, b) => b.posted_date.localeCompare(a.posted_date) || Number(b.pending) - Number(a.pending),
  );

  const emptyMessage =
    hideCategories.length > 0 || hideTags.length > 0 || hideAccounts.length > 0 || TYPED.some((k) => params.get(k))
      ? 'No transactions match.'
      : tagFilter
        ? `No ${status === 'review' ? 'transactions to review' : status === 'approved' ? 'approved transactions' : 'transactions'}${monthScoped ? ` in ${monthLong(month)}` : ''} carry this tag.`
        : status === 'review'
          ? 'Nothing waiting. New transactions from the daily sync land here until you approve them.'
          : monthScoped
            ? `No ${status === 'approved' ? 'approved transactions' : 'transactions'} in ${monthLong(month)}.`
            : "No transactions yet. They'll appear here after your first sync or import.";

  return (
    <section>
      <header className="page-head">
        <h1>Spending</h1>
        <Button
          variant="link"
          onClick={() => {
            setAdding(true);
            setNotice(null);
            setError(null);
          }}
        >
          Add transaction
        </Button>
      </header>

      <MonthSpending
        month={month}
        current={current}
        selected={onlyKey}
        hidden={hideCategories}
        tag={tagFilter}
        hiddenTags={hideTags}
        hiddenAccounts={hideAccounts}
        typed={typed}
        version={version}
        onMonth={(key) => setFilters({ month: key === current ? null : key === ALL_TIME ? ALL_TIME : key.slice(0, 7) })}
        onSelect={pickCategory}
        groups={{ of: groupOf, selected: onlyGroup, hidden: hiddenGroups, onSelect: pickGroup }}
        onError={setError}
      />

      {adding && (
        <AddTransaction
          accounts={entryAccounts}
          categories={categories ?? []}
          open={open}
          onClose={() => setAdding(false)}
          onAdded={async () => {
            // the modal says what was added; the list and totals behind it catch up
            setError(null);
            await reloadShown();
            bump();
          }}
        />
      )}

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      {suggestions.length > 0 && (
        <TransferSuggestions
          suggestions={suggestions}
          accountName={(id) => accountNames.get(id) ?? ''}
          busy={busy}
          onConfirm={(s) => act(() => db().rpc('confirm_transfer', { p_out: s.out_id, p_in: s.in_id }), () => 'Transfer confirmed and approved.')}
          onDismiss={(s) =>
            act(
              () => db().from('dismissed_transfer_pairs').insert({ out_id: s.out_id, in_id: s.in_id }),
              () => 'Dismissed. Both transactions are still in To review.',
            )
          }
        />
      )}

      {paybacks.length > 0 && <ReimbursementSuggestions matches={paybacks} open={open} busy={busy} onLink={link} />}

      {/* always the table, even when empty, so its header filters stay reachable */}
      {rows && (
        <>
          {/* the filter note sits beside the heading, so turning a filter on doesn't push the list down */}
          <div className="list-head">
            <h2>Transactions</h2>
            {filtering && (
              <p className="filters-on">
                Filters are on.
                <Button variant="link" onClick={() => setFilters({
                      status: 'all',
                      hidecat: null,
                      hidetag: null,
                      hideacct: null,
                      tag: null,
                      ...Object.fromEntries(TYPED.map((k) => [k, null])),
                    })}>
                  Show all
                </Button>
              </p>
            )}
          </div>
          {selected.size > 0 && (
            <BulkBar
              count={selected.size}
              approvable={approvable.length}
              categories={categories ?? []}
              categorizable={categorizable.length}
              allTags={tags}
              tagsOnSelected={tagsOnSelected}
              busy={busy}
              onApprove={() => approve(approvable.map((r) => r.id))}
              onSetCategory={categorizeSelected}
              onAddTag={(id) => tagSelected(id)}
              onCreateTag={createTagForSelected}
              onRemoveTag={untagSelected}
              onClear={() => setSelected(new Set())}
            />
          )}
          <table className={`register txns${reloading ? ' refetching' : ''}`}>
            <thead>
              <tr>
                <th scope="col" className="select-col">
                  <input
                    type="checkbox"
                    aria-label={allSelected ? 'Clear selection' : `Select all ${rows.length} shown`}
                    title={allSelected ? 'Clear selection' : 'Select all shown'}
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selected.size > 0 && !allSelected;
                    }}
                    disabled={busy}
                    onChange={toggleAll}
                  />
                </th>
                <th scope="col" className="date-col">
                  <HeaderFields
                    label="Date"
                    fields={[
                      { key: 'after', label: 'After', type: 'date', value: params.get('after') ?? '' },
                      { key: 'before', label: 'Before', type: 'date', value: params.get('before') ?? '' },
                    ]}
                    onApply={(v) => setFilters({ after: v.after || null, before: v.before || null })}
                  />
                </th>
                <th scope="col">
                  <HeaderFields
                    label="Merchant"
                    fields={[{ key: 'merchant', label: 'Name contains', type: 'text', value: params.get('merchant') ?? '' }]}
                    onApply={(v) => setFilters({ merchant: v.merchant || null })}
                  />
                </th>
                <th scope="col" className="account-col">
                  <HeaderFilter
                    label="Account"
                    items={accountItems}
                    hidden={hideAccounts}
                    onChange={(next) => setFilters({ hideacct: next.join(',') || null })}
                    onOnly={(id) => setFilters({ hideacct: [...accountNames.keys()].filter((k) => k !== id).join(',') || null })}
                  />
                </th>
                <th scope="col">
                  <HeaderFilter
                    label="Category"
                    items={categoryItems}
                    hidden={hideCategories}
                    onChange={(next) => setFilters({ hidecat: next.join(',') || null })}
                    onOnly={onlyCategory}
                  />
                </th>
                <th scope="col" className="tags-col">
                  <HeaderFilter
                    label="Tags"
                    align="end"
                    items={tagItems}
                    hidden={tagHidden}
                    onChange={(next) => setFilters({ tag: null, hidetag: next.join(',') || null })}
                    onOnly={onlyTag}
                  />
                </th>
                <th scope="col" className="num">
                  <HeaderFields
                    label="Amount"
                    align="end"
                    fields={[
                      { key: 'min', label: 'Min', type: 'number', prefix: '$', value: params.get('min') ?? '', placeholder: '0' },
                      { key: 'max', label: 'Max', type: 'number', prefix: '$', value: params.get('max') ?? '', placeholder: 'Any' },
                    ]}
                    onApply={(v) => setFilters({ min: v.min || null, max: v.max || null })}
                  />
                </th>
                <th scope="col" className="approved-col">
                  <HeaderFilter
                    label="Approved"
                    align="end"
                    searchable={false}
                    keepOne
                    items={approvalItems}
                    hidden={approvalHidden}
                    onChange={setApprovalHidden}
                    onOnly={(id) => setFilters({ status: id === 'review' ? 'review' : 'approved' })}
                  >
                    {/* phones: just a check mark, to leave room for the other columns */}
                    <span className="label-long">Approved</span>
                    <span className="label-short" aria-hidden="true">
                      ✓
                    </span>
                  </HeaderFilter>
                </th>
                <th scope="col" className="menu-col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shownRows.map((r) =>
                r.pending ? (
                  <PendingRow key={r.id} row={r} categories={categories ?? []} />
                ) : (
                  <TransactionRow
                    key={r.id}
                    row={r}
                    categories={categories ?? []}
                    tags={tags}
                    people={people}
                    open={open}
                    busy={busy}
                    selected={selected.has(r.id)}
                    actions={{
                      onSelect: () => toggleSelected(r.id),
                      onCategory: (value) => setCategory(r, value),
                      onToggleApproved: () => toggleApproved(r),
                      onAddTag: (id) => addTag(r, id),
                      onCreateTag: (typed) => createTag(r, typed),
                      onRemoveTag: (id) => removeTag(r, id),
                      onFilterTag: (id) => setFilters({ tag: id }),
                      onExpect: (who, amount, note) => expect(r, who, amount, note),
                      onLink: (ids) => link(r.id, ids),
                      onUnlink: () => unlink(r),
                      onDelete: () => remove(r),
                    }}
                  />
                ),
              )}
            </tbody>
          </table>
          {shownRows.length === 0 && <p className="empty">{emptyMessage}</p>}
          {hasMore && (
            <div className="load-more">
              <Button disabled={busy} onClick={loadMore}>
                Load {PAGE} more
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
