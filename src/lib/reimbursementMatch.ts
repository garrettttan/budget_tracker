// Pure helpers for matching payments to what people owe. No database access,
// so Node can unit-test them (supabase/tests/reimbursements.test.ts); that's
// also why the import below spells out `.ts`, which Node needs and Vite allows.
import { round } from './cents.ts';

/** Something someone still owes you (status owed), with what's been paid so far. */
export type OpenItem = {
  id: string;
  who: string;
  amount: number;
  paid: number;
  remaining: number;
  postedDate: string;
  /** the charge it's part of: merchant name, else the bank's text */
  label: string;
  transactionId: string;
};

/** People are matched by name ignoring case and spaces: "sam " and "Sam" are one person. */
export const personKey = (who: string) => who.trim().toLowerCase();

/** Open items grouped by person, in order of their oldest charge. */
export function byPerson(items: OpenItem[]): { who: string; items: OpenItem[]; remaining: number }[] {
  const groups = new Map<string, { who: string; items: OpenItem[]; remaining: number }>();
  for (const i of items) {
    const g = groups.get(personKey(i.who)) ?? { who: i.who.trim(), items: [], remaining: 0 };
    g.items.push(i);
    g.remaining = round(g.remaining + i.remaining);
    groups.set(personKey(i.who), g);
  }
  return [...groups.values()];
}

/** Which of `items` a payment of `amount` covers, oldest first (what the database will do). */
export function allocate(amount: number, items: OpenItem[]): { item: OpenItem; part: number }[] {
  let left = amount;
  const out: { item: OpenItem; part: number }[] = [];
  for (const item of items) {
    if (left <= 0) break;
    const part = round(Math.min(left, item.remaining));
    out.push({ item, part });
    left = round(left - part);
  }
  return out;
}

/** A person's name appears in the payment's text ("VENMO FROM SAM LEE", or "Sam" typed by hand). */
function namedIn(text: string, who: string): boolean {
  const words = personKey(who)
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  const hay = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  return words.length > 0 && words.some((w) => hay.includes(` ${w} `));
}

export type PaymentSuggestion = { items: OpenItem[]; reason: 'name' | 'amount' };

/**
 * What a payment probably pays back:
 *   1. someone named in its text: their items, oldest first (all of them, or
 *      just the one whose remaining amount matches exactly)
 *   2. else a single item anyone owes whose remaining amount matches exactly,
 *      if only one does
 */
export function suggestFor(payment: { amount: number; text: string }, open: OpenItem[]): PaymentSuggestion | null {
  const named = byPerson(open).filter((g) => namedIn(payment.text, g.who));
  if (named.length === 1) {
    const g = named[0];
    const exact = g.items.filter((i) => i.remaining === payment.amount);
    return { items: g.remaining !== payment.amount && exact.length === 1 ? exact : g.items, reason: 'name' };
  }
  const exact = open.filter((i) => i.remaining === payment.amount);
  return exact.length === 1 ? { items: exact, reason: 'amount' } : null;
}
