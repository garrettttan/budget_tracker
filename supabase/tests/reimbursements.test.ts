// Usage: npm run test:sync (runs with the SimpleFIN tests)
// Unit tests for matching incoming payments to what people owe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type OpenItem, allocate, byPerson, suggestFor } from '../../src/lib/reimbursementMatch.ts';

const item = (id: string, who: string, remaining: number, postedDate: string): OpenItem => ({
  id, who, amount: remaining, paid: 0, remaining, postedDate, label: id, transactionId: `t-${id}`,
});
const open = [
  item('dinner', 'Sam', 40, '2026-10-01'),
  item('movie', 'sam ', 15, '2026-10-05'),
  item('cab', 'Alex Kim', 22.5, '2026-10-03'),
];
const ids = (s: ReturnType<typeof suggestFor>) => s?.items.map((i) => i.id);

test('byPerson groups names ignoring case and spaces', () => {
  const groups = byPerson(open);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].items.map((i) => i.id), ['dinner', 'movie']);
  assert.equal(groups[0].remaining, 55);
});

test('allocate covers items oldest first, the last one in part', () => {
  const sam = byPerson(open)[0].items;
  assert.deepEqual(allocate(50, sam).map((a) => [a.item.id, a.part]), [['dinner', 40], ['movie', 10]]);
  assert.deepEqual(allocate(30, sam).map((a) => [a.item.id, a.part]), [['dinner', 30]]);
});

test('a payment naming someone suggests their items', () => {
  assert.deepEqual(ids(suggestFor({ amount: 55, text: 'VENMO PAYMENT FROM SAM' }, open)), ['dinner', 'movie']);
  assert.equal(suggestFor({ amount: 55, text: 'VENMO PAYMENT FROM SAM' }, open)?.reason, 'name');
  // partial payment: still their items, oldest first
  assert.deepEqual(ids(suggestFor({ amount: 20, text: 'Sam' }, open)), ['dinner', 'movie']);
  // exactly one of theirs matches the amount: just that one
  assert.deepEqual(ids(suggestFor({ amount: 15, text: 'Zelle from Sam' }, open)), ['movie']);
  // any word of a full name counts, but not inside another word
  assert.deepEqual(ids(suggestFor({ amount: 22.5, text: 'ZELLE KIM A' }, open)), ['cab']);
  assert.equal(suggestFor({ amount: 99, text: 'SAMSUNG REFUND' }, open), null);
});

test('without a name, only a unique exact amount is suggested', () => {
  assert.deepEqual(ids(suggestFor({ amount: 22.5, text: 'MOBILE DEPOSIT' }, open)), ['cab']);
  assert.equal(suggestFor({ amount: 22.5, text: 'DEPOSIT' }, [...open, item('lunch', 'Jo', 22.5, '2026-10-09')]), null);
  assert.equal(suggestFor({ amount: 10, text: 'DEPOSIT' }, open), null);
});
