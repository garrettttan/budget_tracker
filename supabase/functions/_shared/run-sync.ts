// One sync run for one SimpleFIN connection, used by the daily `sync`
// function, `sync-now` (Settings → Sync now) and `simplefin-claim` (the first
// sync after connecting). Read top-down: plan → fetch → accounts → transactions.
//
// Writes with the service role, which bypasses RLS, so every insert sets
// user_id explicitly.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { chunks, must, selectAll } from './db.ts';
import {
  type BankFields,
  type SfAccount,
  type Window,
  SimplefinError,
  bankFieldsChanged,
  fetchAccountSet,
  guessAccountClass,
  isStalePending,
  merchantName,
  normalizeDescription,
  planWindows,
  readIssues,
  skipReason,
  toBankFields,
  toLocalDate,
} from './simplefin.ts';

export type Connection = { id: string; user_id: string; status: string };

export type SyncResult =
  | { status: 'skipped'; reason: string }
  | { status: 'ok' | 'warning' | 'error'; new: number; updated: number; removed: number; messages: string[] };

/** Counts and warnings gathered during a run, saved to `sync_runs`. */
type Log = { requests: number; new: number; updated: number; removed: number; messages: string[] };

/**
 * Syncs one connection: works out which date windows to fetch, skips the run
 * if that would go past the request cap (or a rate-limit cooldown), then
 * fetches, saves accounts and balances, and saves transactions. Every run that
 * isn't skipped is logged in `sync_runs`, and the connection's status updated.
 */
export async function runSync(
  admin: SupabaseClient,
  conn: Connection,
  trigger: 'schedule' | 'manual' | 'initial',
): Promise<SyncResult> {
  const now = new Date();
  const lastPosted = await lastPostedDate(admin, conn.id);
  const windows = planWindows(lastPosted, now);

  const skip = skipReason({ now, plannedRequests: windows.length, ...(await recentActivity(admin, conn, now)) });
  if (skip) return { status: 'skipped', reason: skip };

  const run = await must<{ id: string }>(
    admin.from('sync_runs').insert({ user_id: conn.user_id, connection_id: conn.id, trigger }).select('id').single(),
  );
  const log: Log = { requests: 0, new: 0, updated: 0, removed: 0, messages: [] };
  let status: 'ok' | 'warning' | 'error' = 'ok';
  let connectionStatus = 'active';

  try {
    const accessUrl = await must<string | null>(admin.rpc('get_simplefin_access_url', { p_connection_id: conn.id }));
    if (!accessUrl) throw new SimplefinError('No SimpleFIN access saved. Connect in Settings.');

    const fetched = await fetchWindows(accessUrl, windows, lastPosted === null, log);
    const { ids: accountIds, investments } = await saveAccounts(admin, conn, fetched, now);
    // investments are balance-only: balances above, no transactions
    const tracked = new Map([...fetched.accounts].filter(([id]) => !investments.has(id)));
    await saveTransactions(admin, conn, { ...fetched, accounts: tracked }, accountIds, now, log);

    if (fetched.rateLimited) connectionStatus = 'rate_limited';
    if (log.messages.length) status = 'warning';
  } catch (err) {
    log.messages.push(err instanceof Error ? err.message : String(err));
    status = 'error';
    connectionStatus = 'needs_attention';
  }

  await must(
    admin
      .from('sync_runs')
      .update({
        status,
        finished_at: new Date().toISOString(),
        request_count: log.requests,
        new_count: log.new,
        updated_count: log.updated,
        removed_count: log.removed,
        messages: log.messages,
      })
      .eq('id', run.id),
  );
  await must(
    admin
      .from('connections')
      .update({
        status: connectionStatus,
        status_message: status === 'ok' ? null : log.messages.join(' '),
        ...(status === 'error' ? {} : { last_synced_at: now.toISOString() }),
      })
      .eq('id', conn.id),
  );
  return { status, new: log.new, updated: log.updated, removed: log.removed, messages: log.messages };
}

// ---------------------------------------------------------------------------
// 1. Plan

async function lastPostedDate(admin: SupabaseClient, connectionId: string): Promise<string | null> {
  const rows = await must<{ posted_date: string }[]>(
    admin
      .from('transactions')
      .select('posted_date, accounts!inner(connection_id)')
      .eq('accounts.connection_id', connectionId)
      .eq('source', 'simplefin')
      .eq('pending', false)
      .order('posted_date', { ascending: false })
      .limit(1),
  );
  return rows[0]?.posted_date ?? null;
}

async function recentActivity(admin: SupabaseClient, conn: Connection, now: Date) {
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const runs = await must<{ started_at: string; request_count: number }[]>(
    admin
      .from('sync_runs')
      .select('started_at, request_count')
      .eq('connection_id', conn.id)
      .order('started_at', { ascending: false })
      .limit(20),
  );
  return {
    requestsLast24h: runs.filter((r) => r.started_at >= dayAgo).reduce((n, r) => n + r.request_count, 0),
    rateLimitedAt: conn.status === 'rate_limited' ? (runs[0]?.started_at ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// 2. Fetch, newest window first

type Fetched = {
  accounts: Map<string, SfAccount>; // by SimpleFIN account id, transactions merged across windows
  institutions: Map<string, string>; // conn_id → bank name
  failedAccountIds: Set<string>;
  rateLimited: boolean;
  since: string; // start date of the oldest window fetched
};

async function fetchWindows(accessUrl: string, windows: Window[], firstSync: boolean, log: Log): Promise<Fetched> {
  const fetched: Fetched = { accounts: new Map(), institutions: new Map(), failedAccountIds: new Set(), rateLimited: false, since: '' };

  for (const window of windows) {
    const set = await fetchAccountSet(accessUrl, window);
    log.requests++;
    fetched.since = toLocalDate(window.start);

    const issues = readIssues(set);
    log.messages.push(...issues.messages.filter((m) => !log.messages.includes(m)));
    issues.failedAccountIds.forEach((id) => fetched.failedAccountIds.add(id));
    for (const c of set.connections ?? []) fetched.institutions.set(c.conn_id, c.name);

    let transactionCount = 0;
    for (const account of set.accounts) {
      const seen = fetched.accounts.get(account.id); // the newest window's balance wins
      const transactions = [...(seen?.transactions ?? []), ...(account.transactions ?? [])];
      fetched.accounts.set(account.id, { ...(seen ?? account), transactions });
      transactionCount += account.transactions?.length ?? 0;
    }

    if (issues.rateLimited) {
      fetched.rateLimited = true;
      break;
    }
    if (firstSync && transactionCount === 0) break; // walked back past the bank's history
  }
  return fetched;
}

// ---------------------------------------------------------------------------
// 3. Accounts and today's balances

async function saveAccounts(
  admin: SupabaseClient,
  conn: Connection,
  { accounts, institutions }: Fetched,
  now: Date,
): Promise<{ ids: Map<string, string>; investments: Set<string> }> {
  const existing = await must<{ id: string; external_id: string; class: string }[]>(
    admin.from('accounts').select('id, external_id, class').eq('connection_id', conn.id),
  );
  const ids = new Map(existing.map((a) => [a.external_id, a.id])); // SimpleFIN id → our id
  const investments = new Set(existing.filter((a) => a.class === 'investment').map((a) => a.external_id));

  for (const a of accounts.values()) {
    const bankFields = {
      currency: a.currency,
      balance: a.balance,
      balance_date: new Date(a['balance-date'] * 1000).toISOString(),
    };
    const id = ids.get(a.id);
    if (id) {
      await must(admin.from('accounts').update(bankFields).eq('id', id));
    } else {
      // name, institution and class are set once, so your edits are kept
      const created = await must<{ id: string }>(
        admin
          .from('accounts')
          .insert({
            user_id: conn.user_id,
            connection_id: conn.id,
            external_id: a.id,
            name: a.name,
            institution: institutions.get(a.conn_id) ?? null,
            class: guessAccountClass(a),
            ...bankFields,
          })
          .select('id')
          .single(),
      );
      ids.set(a.id, created.id);
    }
  }

  const today = toLocalDate(now.getTime() / 1000);
  const snapshots = [...accounts.values()].map((a) => ({
    account_id: ids.get(a.id),
    date: today,
    user_id: conn.user_id,
    balance: a.balance,
  }));
  if (snapshots.length) await must(admin.from('balance_snapshots').upsert(snapshots, { onConflict: 'account_id,date' }));
  return { ids, investments };
}

// ---------------------------------------------------------------------------
// 4. Transactions: insert new, update changed, remove stale pending

type Existing = BankFields & { id: string; account_id: string };

async function saveTransactions(
  admin: SupabaseClient,
  conn: Connection,
  fetched: Fetched,
  accountIds: Map<string, string>,
  now: Date,
  log: Log,
) {
  if (fetched.accounts.size === 0) return;

  // What SimpleFIN returned, keyed `${account_id}:${external_id}` (windows overlap; last wins)
  const incoming = new Map<string, BankFields & { account_id: string }>();
  for (const a of fetched.accounts.values()) {
    const account_id = accountIds.get(a.id)!;
    for (const t of a.transactions ?? []) incoming.set(`${account_id}:${t.id}`, { ...toBankFields(t, now), account_id });
  }

  // What we already have in the same date range
  const existing = await selectAll<Existing>((from, to) =>
    admin
      .from('transactions')
      .select('id, account_id, external_id, posted_date, amount, description, pending')
      .in('account_id', [...accountIds.values()])
      .eq('source', 'simplefin')
      .gte('posted_date', fetched.since)
      .order('id')
      .range(from, to),
  );
  const existingByKey = new Map(existing.map((t) => [`${t.account_id}:${t.external_id}`, t]));

  // Changed rows: update bank-side fields only, never your category, approval or notes
  for (const [key, row] of incoming) {
    const found = existingByKey.get(key);
    if (found && bankFieldsChanged(found, row)) {
      const { posted_date, amount, description, pending } = row;
      await must(admin.from('transactions').update({ posted_date, amount, description, pending }).eq('id', found.id));
      log.updated++;
    }
  }

  // New rows: unapproved, with the merchant and its remembered category pre-filled
  const fresh = [...incoming].filter(([key]) => !existingByKey.has(key)).map(([, row]) => row);
  const merchants = await resolveMerchants(admin, conn.user_id, fresh.map((r) => normalizeDescription(r.description)));
  for (const batch of chunks(fresh, 500)) {
    const rows = batch.map((r) => {
      const merchant = merchants.get(normalizeDescription(r.description));
      return { ...r, user_id: conn.user_id, source: 'simplefin', merchant_id: merchant?.id, category_id: merchant?.last_category_id };
    });
    // a row dated before the fetched range can still collide on the key; skip it
    const inserted = await must<{ id: string }[]>(
      admin.from('transactions').upsert(rows, { onConflict: 'account_id,source,external_id', ignoreDuplicates: true }).select('id'),
    );
    log.new += inserted.length;
  }

  // Pending rows SimpleFIN stopped returning
  const complete = new Set(
    [...fetched.accounts.keys()].filter((id) => !fetched.failedAccountIds.has(id)).map((id) => accountIds.get(id)!),
  );
  const stale = existing.filter((t) => isStalePending(t, new Set(incoming.keys()), complete)).map((t) => t.id);
  for (const batch of chunks(stale, 200)) await must(admin.from('transactions').delete().in('id', batch));
  log.removed = stale.length;
}

type Merchant = { id: string; last_category_id: string | null };

/** match_key → merchant; creates a merchant + alias for keys never seen before. */
async function resolveMerchants(admin: SupabaseClient, userId: string, matchKeys: string[]): Promise<Map<string, Merchant>> {
  const keys = [...new Set(matchKeys)];
  const merchants = new Map<string, Merchant>();

  for (const batch of chunks(keys, 100)) {
    const found = await must<{ match_key: string; merchants: Merchant }[]>(
      admin.from('merchant_aliases').select('match_key, merchants!inner(id, last_category_id)').eq('user_id', userId).in('match_key', batch),
    );
    for (const row of found) merchants.set(row.match_key, row.merchants);
  }

  // Keys are lowercase, so each display name maps back to exactly one key
  for (const batch of chunks(keys.filter((k) => !merchants.has(k)), 200)) {
    const created = await must<{ id: string; name: string }[]>(
      admin.from('merchants').insert(batch.map((key) => ({ user_id: userId, name: merchantName(key) }))).select('id, name'),
    );
    const idByName = new Map(created.map((m) => [m.name, m.id]));
    const aliases = batch.map((key) => ({ user_id: userId, match_key: key, merchant_id: idByName.get(merchantName(key))! }));
    await must(admin.from('merchant_aliases').insert(aliases));
    for (const a of aliases) merchants.set(a.match_key, { id: a.merchant_id, last_category_id: null }); // new merchants arrive blank
  }
  return merchants;
}
