// Reimbursements as the browser loads them. The matching logic itself lives in
// reimbursementMatch.ts (re-exported here) so it can be unit-tested without a
// database.
import { db } from './supabase';
import { round } from './cents';
import { money } from './format';
import type { OpenItem } from './reimbursementMatch';
import { strings } from './strings';

const t = strings.reimbursements;

export * from './reimbursementMatch';

/** Someone owes you part of a charge (as embedded in a transaction row). */
export type Reimbursement = { id: string; who: string; amount: string; status: 'owed' | 'received' | 'written_off' };

/** Part of a payment, linked to what it paid back. */
export type PaymentLink = { amount: string; reimbursements: { who: string } | null };

/** One line per person for a charge: "Sam owes $40 · Alex paid back $30". */
export function reimbursementSummary(items: Reimbursement[]): string {
  return items.map((r) => `${r.who} ${t.status[r.status]} ${money(r.amount)}`).join(t.separator);
}

/** Who a linked payment paid back: "Sam", "Sam and Alex", "Sam, Alex and Kim". */
export function payers(links: PaymentLink[]): string {
  const names = [...new Set(links.map((l) => l.reimbursements?.who.trim()).filter(Boolean))] as string[];
  return names.length <= 2 ? names.join(t.and) : `${names.slice(0, -1).join(t.listSeparator)}${t.and}${names.at(-1)}`;
}

/** Your share of a charge (`amount` negative): what's left after everything expected back. */
export function yourShare(amount: number, items: Reimbursement[]): number {
  const back = items.filter((r) => r.status !== 'written_off').reduce((sum, r) => sum + Number(r.amount), 0);
  return round(-amount - back);
}

/**
 * Embed for a reimbursement's charge. `reimbursements` reaches `transactions`
 * two ways (directly, and through `reimbursement_payments`), so PostgREST needs
 * the foreign key named.
 */
export const CHARGE = 'transactions!reimbursements_transaction_id_fkey';

type OpenRow = {
  id: string;
  who: string;
  amount: string;
  transaction_id: string;
  transactions: { posted_date: string; description: string; merchants: { name: string } | null } | null;
  reimbursement_payments: { amount: string }[];
};

/** Everything still owed, oldest charge first. */
export async function fetchOpen(): Promise<{ items: OpenItem[]; error: string | null }> {
  const { data, error } = await db()
    .from('reimbursements')
    .select(`id, who, amount, transaction_id, ${CHARGE}(posted_date, description, merchants(name)), reimbursement_payments(amount)`)
    .eq('status', 'owed');
  const items = ((data ?? []) as unknown as OpenRow[])
    .map((r) => {
      const paid = r.reimbursement_payments.reduce((sum, p) => sum + Number(p.amount), 0);
      return {
        id: r.id,
        who: r.who,
        amount: Number(r.amount),
        paid,
        remaining: round(Number(r.amount) - paid),
        postedDate: r.transactions?.posted_date ?? '',
        label: r.transactions?.merchants?.name ?? r.transactions?.description ?? '',
        transactionId: r.transaction_id,
      };
    })
    .filter((i) => i.remaining > 0)
    .sort((a, b) => a.postedDate.localeCompare(b.postedDate));
  return { items, error: error?.message ?? null };
}
