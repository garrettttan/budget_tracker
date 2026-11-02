// Usage: npm run test:sync
// Unit tests for the SimpleFIN helpers shared by the edge functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_REQUESTS_PER_DAY,
  bankFieldsChanged,
  claimAccessUrl,
  decodeSetupToken,
  fetchAccountSet,
  isStalePending,
  merchantName,
  normalizeDescription,
  planWindows,
  readIssues,
  skipReason,
  splitAccessUrl,
  toBankFields,
  toLocalDate,
} from '../functions/_shared/simplefin.ts';

const DAY = 86_400;
const now = new Date('2026-11-02T11:17:00Z'); // 6:17 a.m. in New York
const epoch = (iso: string) => Date.parse(iso) / 1000;

test('connecting: Setup Token → claim URL → Access URL', async () => {
  const claimUrl = 'https://beta-bridge.simplefin.org/simplefin/claim/abc123';
  assert.equal(decodeSetupToken(` ${btoa(claimUrl)}\n`), claimUrl);
  assert.throws(() => decodeSetupToken('not a token'), /Setup Token/);
  assert.throws(() => decodeSetupToken(btoa('http://insecure.example/claim')), /https/);

  const used = (async () => new Response('', { status: 403 })) as typeof fetch;
  await assert.rejects(claimAccessUrl(btoa(claimUrl), used), /already used.*someone else/s);

  const ok = (async (_url: string, init?: RequestInit) => {
    assert.equal(init?.method, 'POST');
    return new Response('https://u:p@bridge.example/simplefin\n');
  }) as typeof fetch;
  assert.equal(await claimAccessUrl(btoa(claimUrl), ok), 'https://u:p@bridge.example/simplefin');
});

test('the Access URL credentials become a Basic auth header', async () => {
  const { baseUrl, authorization } = splitAccessUrl('https://user%40x:p%3Ass@bridge.example/simplefin/');
  assert.equal(baseUrl, 'https://bridge.example/simplefin');
  assert.equal(authorization, `Basic ${btoa('user@x:p:ss')}`);
  assert.throws(() => splitAccessUrl('https://bridge.example/simplefin'), /malformed/);

  let requested = '';
  let auth: string | null = null;
  const fake = (async (url: string, init?: RequestInit) => {
    requested = url;
    auth = new Headers(init?.headers).get('Authorization');
    return Response.json({ accounts: [] });
  }) as typeof fetch;
  await fetchAccountSet('https://u:p@bridge.example/simplefin', { start: 100, end: 200 }, fake);
  const q = new URL(requested).searchParams;
  assert.deepEqual([q.get('version'), q.get('pending'), q.get('start-date'), q.get('end-date')], ['2', '1', '100', '200']);
  assert.equal(auth, `Basic ${btoa('u:p')}`);
});

test('windows: incremental overlaps 10 days; long gaps split into ≤ 45-day pieces, at most 3', () => {
  const [daily] = planWindows('2026-11-01', now);
  assert.equal(daily.start, epoch('2026-10-22T00:00:00Z'));
  assert.equal(daily.end, epoch(now.toISOString()) + DAY);

  const gap = planWindows('2026-09-01', now);
  assert.equal(gap.length, 2);
  assert.equal(gap[0].start, gap[1].end, 'contiguous, newest first');
  for (const w of gap) assert.ok(w.end - w.start <= 45 * DAY);

  assert.equal(planWindows(null, now).length, 3, 'first sync: up to 135 days back');
  assert.equal(planWindows('2025-01-01', now).length, 3);
});

test('skip rules: 12 requests per 24 h, and one day off after a rate-limit warning', () => {
  const base = { now, plannedRequests: 1, requestsLast24h: 0, rateLimitedAt: null };
  assert.equal(skipReason(base), null);
  assert.equal(skipReason({ ...base, requestsLast24h: MAX_REQUESTS_PER_DAY - 1 }), null);
  assert.match(skipReason({ ...base, requestsLast24h: MAX_REQUESTS_PER_DAY })!, /exceed/, 'a leaked secret is capped too');

  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  assert.match(skipReason({ ...base, rateLimitedAt: hoursAgo(24) })!, /rate-limit/);
  assert.equal(skipReason({ ...base, rateLimitedAt: hoursAgo(48) }), null);
});

test('issues: errlist and the deprecated errors list are both read', () => {
  const issues = readIssues({
    errlist: [{ code: 'act.missingdata', msg: 'Incomplete transaction listing.', account_id: 'A2' }],
    errors: ['You are approaching the rate limit for this token.'],
    accounts: [],
  });
  assert.equal(issues.messages.length, 2);
  assert.equal(issues.rateLimited, true);
  assert.deepEqual([...issues.failedAccountIds], ['A2']);
  assert.equal(readIssues({ accounts: [] }).rateLimited, false);
});

test('transactions: New York dates, cents, and pending with posted = 0', () => {
  assert.equal(toLocalDate(epoch('2026-11-02T03:30:00Z')), '2026-11-01', 'still Nov 1 in New York');

  const posted = toBankFields({ id: 'T1', posted: epoch('2026-10-10T16:00:00Z'), amount: '-120.004', description: ' CARBONE NYC ' }, now);
  assert.deepEqual(posted, { external_id: 'T1', posted_date: '2026-10-10', amount: '-120.00', description: 'CARBONE NYC', pending: false });

  const pending = toBankFields({ id: 'T2', posted: 0, amount: '-4.5', description: 'JOES', transacted_at: epoch('2026-11-01T14:00:00Z') }, now);
  assert.equal(pending.pending, true);
  assert.equal(pending.posted_date, '2026-11-01');
  assert.throws(() => toBankFields({ id: 'T3', posted: 1, amount: 'abc', description: '' }, now), /invalid amount/);
});

test('existing rows: only bank-side changes count', () => {
  const row = { external_id: 'T1', posted_date: '2026-10-10', amount: '-24.50', description: 'BAR', pending: false };
  assert.equal(bankFieldsChanged(row, { ...row, amount: '-24.5' }), false);
  assert.equal(bankFieldsChanged({ ...row, pending: true }, row), true);
});

test('stale pending: removed only when its account came back complete', () => {
  const returned = new Set(['a1:P2']);
  const complete = new Set(['a1']);
  assert.equal(isStalePending({ account_id: 'a1', external_id: 'P1', pending: true }, returned, complete), true);
  assert.equal(isStalePending({ account_id: 'a1', external_id: 'P2', pending: true }, returned, complete), false, 'still returned');
  assert.equal(isStalePending({ account_id: 'a2', external_id: 'P3', pending: true }, returned, complete), false, 'account errored');
  assert.equal(isStalePending({ account_id: 'a1', external_id: 'X', pending: false }, returned, complete), false, 'posted rows stay');
});

test('merchant keys group variants of one merchant', () => {
  assert.equal(normalizeDescription('SQ *JOES COFFEE 1234'), 'joes coffee');
  assert.equal(normalizeDescription('SQ *JOES COFFEE 5678'), 'joes coffee');
  assert.equal(normalizeDescription('AMAZON.COM*RT4'), 'amazon.com');
  assert.equal(normalizeDescription('AMZN MKTP US*2K3'), 'amzn mktp us');
  assert.equal(normalizeDescription('TST* CARBONE NYC #0042 10/12'), 'carbone nyc');
  assert.equal(normalizeDescription('12345'), '12345', 'falls back to the raw text when nothing is left');
  assert.equal(merchantName('joes coffee'), 'Joes Coffee');
  assert.equal(merchantName("trader joe's"), "Trader Joe's");
  assert.equal(merchantName('amazon.com'), 'Amazon.com');
});
