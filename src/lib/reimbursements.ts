import { db } from './supabase';
import { type OpenItem, round } from './reimbursementMatch';

export * from './reimbursementMatch';

type OpenRow = {
  id: string;
  who: string;
  amount: string;
  transaction_id: string;
  transactions: { posted_date: string; description: string; merchants: { name: string } | null } | null;
  reimbursement_payments: { amount: string }[];
};

// reimbursements reach transactions two ways (directly, and through
// reimbursement_payments), so embeds name the foreign key
export const CHARGE = 'transactions!reimbursements_transaction_id_fkey';

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
