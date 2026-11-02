// SimpleFIN Bridge protocol helpers.
//
// No Deno- or npm-specific imports, so this file runs in the edge functions
// and under Node's test runner (supabase/tests/simplefin.test.ts).
//
// Protocol: https://www.simplefin.org/protocol.html (we always ask for v2)
// Limits:   https://beta-bridge.simplefin.org/info/developers
//   * ~24 requests/day; going past the warning level disables the Access Token
//   * each /accounts request may span at most 90 days

export const MAX_REQUESTS_PER_DAY = 12; // our own cap, well under SimpleFIN's ~24
const TIME_ZONE = 'America/New_York';
const WINDOW_DAYS = 90;
const MAX_WINDOWS = 3; // first sync: up to 270 days back
const OVERLAP_DAYS = 10;
const COOLDOWN_HOURS = 44; // after a rate-limit warning, skip the next daily run
const DAY = 86_400;

// Wire format: amounts and balances are numeric strings; dates are epoch seconds.
export type SfTransaction = {
  id: string;
  posted: number; // 0 while pending, for some banks
  amount: string;
  description: string;
  transacted_at?: number;
  pending?: boolean;
};

export type SfAccount = {
  id: string;
  name: string;
  conn_id: string;
  currency: string;
  balance: string;
  'balance-date': number;
  transactions?: SfTransaction[];
};

export type SfAccountSet = {
  errlist?: { code: string; msg: string; account_id?: string }[];
  errors?: string[]; // deprecated in v2, but rate-limit warnings are documented here
  connections?: { conn_id: string; name: string }[];
  accounts: SfAccount[];
};

export type Window = { start: number; end: number }; // epoch seconds, end exclusive

export class SimplefinError extends Error {}

// ---------------------------------------------------------------------------
// Connecting: Setup Token → claim URL → Access URL
// ---------------------------------------------------------------------------

/** A Setup Token is a base64-encoded https claim URL. */
export function decodeSetupToken(token: string): string {
  let url: URL;
  try {
    url = new URL(atob(token.trim()));
  } catch {
    throw new SimplefinError("That doesn't look like a SimpleFIN Setup Token.");
  }
  if (url.protocol !== 'https:') throw new SimplefinError('The Setup Token must point to an https address.');
  return url.toString();
}

/** Claims a Setup Token (works once) and returns the permanent Access URL. */
export async function claimAccessUrl(setupToken: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(decodeSetupToken(setupToken), { method: 'POST', headers: { 'Content-Length': '0' } });
  if (res.status === 403) {
    throw new SimplefinError(
      'SimpleFIN says this Setup Token was already used or does not exist. If you did not use it ' +
        'yourself, someone else may have: disable it in SimpleFIN Bridge and create a new one.',
    );
  }
  if (!res.ok) throw new SimplefinError(`SimpleFIN could not claim the token (HTTP ${res.status}).`);
  const accessUrl = (await res.text()).trim();
  splitAccessUrl(accessUrl); // validate before we store it
  return accessUrl;
}

/** Access URLs embed Basic auth credentials (https://user:pass@host/simplefin). */
export function splitAccessUrl(accessUrl: string): { baseUrl: string; authorization: string } {
  const url = new URL(accessUrl);
  if (url.protocol !== 'https:' || !url.username || !url.password) {
    throw new SimplefinError('The SimpleFIN Access URL is malformed.');
  }
  const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
  return {
    baseUrl: `${url.origin}${url.pathname}`.replace(/\/+$/, ''),
    authorization: `Basic ${btoa(credentials)}`,
  };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

export async function fetchAccountSet(accessUrl: string, window: Window, fetchImpl: typeof fetch = fetch): Promise<SfAccountSet> {
  const { baseUrl, authorization } = splitAccessUrl(accessUrl);
  const query = new URLSearchParams({
    version: '2',
    pending: '1',
    'start-date': String(window.start),
    'end-date': String(window.end),
  });
  const res = await fetchImpl(`${baseUrl}/accounts?${query}`, { headers: { Authorization: authorization } });
  if (res.status === 403) {
    throw new SimplefinError('SimpleFIN rejected the saved access. Reconnect in Settings with a new Setup Token.');
  }
  if (!res.ok) throw new SimplefinError(`SimpleFIN request failed (HTTP ${res.status}).`);
  return (await res.json()) as SfAccountSet;
}

/**
 * Request windows, newest first, each at most 90 days.
 * Incremental: from the last posted date minus 10 days, through tomorrow.
 * First sync (no posted date yet): 3 windows back; the caller stops at the
 * first empty one.
 */
export function planWindows(lastPostedDate: string | null, now: Date): Window[] {
  const end = Math.floor(now.getTime() / 1000) + DAY;
  const start =
    lastPostedDate === null
      ? end - MAX_WINDOWS * WINDOW_DAYS * DAY
      : Date.parse(`${lastPostedDate}T00:00:00Z`) / 1000 - OVERLAP_DAYS * DAY;

  const windows: Window[] = [];
  for (let to = end; to > start && windows.length < MAX_WINDOWS; to -= WINDOW_DAYS * DAY) {
    windows.push({ start: Math.max(start, to - WINDOW_DAYS * DAY), end: to });
  }
  return windows;
}

// ---------------------------------------------------------------------------
// Should this run happen?
// ---------------------------------------------------------------------------

/**
 * Two rules protect the Access Token:
 * 1. Never more than 12 SimpleFIN requests in 24 h, however often we're called
 *    (so a leaked SYNC_SECRET can't get the token disabled).
 * 2. After a rate-limit warning, skip until a full day has passed.
 */
export function skipReason(opts: {
  now: Date;
  plannedRequests: number;
  requestsLast24h: number;
  rateLimitedAt: string | null; // start of the last run, if it was rate limited
}): string | null {
  if (opts.requestsLast24h + opts.plannedRequests > MAX_REQUESTS_PER_DAY) {
    return `would exceed ${MAX_REQUESTS_PER_DAY} SimpleFIN requests in 24 h`;
  }
  if (opts.rateLimitedAt) {
    const hours = (opts.now.getTime() - Date.parse(opts.rateLimitedAt)) / 3_600_000;
    if (hours < COOLDOWN_HOURS) return 'skipping a day after a SimpleFIN rate-limit warning';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading a response
// ---------------------------------------------------------------------------

export type Issues = {
  messages: string[];
  rateLimited: boolean;
  failedAccountIds: Set<string>; // their data may be incomplete this run
};

export function readIssues(set: SfAccountSet): Issues {
  const messages = new Set([...(set.errlist ?? []).map((e) => e.msg), ...(set.errors ?? [])]);
  const failed = (set.errlist ?? []).filter((e) => e.code.startsWith('act.') && e.account_id);
  return {
    messages: [...messages],
    rateLimited: [...messages].some((m) => /rate.?limit|too many|quota/i.test(m)),
    failedAccountIds: new Set(failed.map((e) => e.account_id!)),
  };
}

/** Calendar date (YYYY-MM-DD) of an epoch-seconds timestamp in New York. */
export function toLocalDate(epochSeconds: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, dateStyle: 'short' }).format(new Date(epochSeconds * 1000));
}

export type BankFields = {
  external_id: string;
  posted_date: string;
  amount: string;
  description: string;
  pending: boolean;
};

export function toBankFields(t: SfTransaction, now: Date): BankFields {
  const when = t.posted || t.transacted_at || now.getTime() / 1000;
  const amount = Number(t.amount);
  if (!Number.isFinite(amount)) throw new SimplefinError(`Transaction ${t.id} has an invalid amount.`);
  return {
    external_id: t.id,
    posted_date: toLocalDate(when),
    amount: amount.toFixed(2),
    description: t.description.trim(),
    pending: Boolean(t.pending) || t.posted === 0,
  };
}

/** True when the bank changed something on a row we already have. */
export function bankFieldsChanged(existing: BankFields, incoming: BankFields): boolean {
  return (
    existing.posted_date !== incoming.posted_date ||
    Number(existing.amount) !== Number(incoming.amount) ||
    existing.description !== incoming.description ||
    existing.pending !== incoming.pending
  );
}

/**
 * Pending rows to delete: SimpleFIN stopped returning them (the charge posted
 * under a new id, or was voided). Only for accounts that came back without
 * errors, so a partial response never deletes anything.
 */
export function isStalePending(
  row: { account_id: string; external_id: string; pending: boolean },
  returnedKeys: Set<string>, // `${account_id}:${external_id}`
  completeAccountIds: Set<string>,
): boolean {
  return row.pending && completeAccountIds.has(row.account_id) && !returnedKeys.has(`${row.account_id}:${row.external_id}`);
}

// ---------------------------------------------------------------------------
// Merchants: raw description → match_key → display name
// ---------------------------------------------------------------------------

/**
 * Normalizes a bank description so variants of one merchant share a key:
 * "SQ *JOES COFFEE 1234" → "joes coffee", "AMAZON.COM*RT4" → "amazon.com".
 */
export function normalizeDescription(description: string): string {
  const key = description
    .toLowerCase()
    .replace(/^(sq|tst|sp|pp|paypal|pos)\s*\*\s*/, '') // card-processor prefixes
    .replace(/\*\w+$/, '') //                            trailing reference codes: "*RT4"
    .replace(/#?\d{3,}|\d+\/\d+(\/\d+)?/g, ' ') //       store numbers, ids, dates
    .replace(/[^a-z0-9&.' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return key || description.toLowerCase().trim();
}

/** "joes coffee" → "Joes Coffee" (not after ' or ., so "Joe's", "Amazon.com"). */
export function merchantName(key: string): string {
  return key.replace(/(^|\s)[a-z]/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Account classes
// ---------------------------------------------------------------------------

export type AccountClass = 'cash' | 'investment' | 'liability';

/**
 * Best guess for a newly seen account; you can change it on the Accounts page.
 * SimpleFIN doesn't say what kind of account it is. Investments can't be told
 * apart by name ("Individual"), so they start as Cash.
 */
export function guessAccountClass(account: Pick<SfAccount, 'name' | 'balance'>): AccountClass {
  return Number(account.balance) < 0 || /credit|card/i.test(account.name) ? 'liability' : 'cash';
}
