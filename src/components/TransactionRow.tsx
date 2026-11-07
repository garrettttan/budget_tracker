// One row of the transaction list on Spending. A posted row is editable
// (select box, category, tags, Approved, and actions in its tap-to-expand
// details); a pending row is read-only (see PendingRow).
import { type ComponentProps, useState } from 'react';
import { money, shortDate } from '../lib/format';
import { type OpenItem, payers, reimbursementSummary, yourShare } from '../lib/reimbursements';
import { type Row, expectedOn, isCharge, isLinked, rowName } from '../lib/transactions';
import Button from './Button';
import CategorySelect, { type Category, TRANSFER } from './CategorySelect';
import MerchantCell from './MerchantCell';
import { ExpectForm, LinkForm } from './ReimbursementForms';
import TagCell, { type Tag } from './TagCell';

/** What a row can ask the page to do. The async ones resolve true once saved. */
export type RowActions = {
  onSelect: () => void;
  /** a category id, UNCATEGORIZED or TRANSFER (CategorySelect's values) */
  onCategory: (value: string) => void;
  onToggleApproved: () => void;
  onAddTag: (tagId: string) => void;
  onCreateTag: (name: string) => void;
  onRemoveTag: (tagId: string) => void;
  onFilterTag: (tagId: string) => void;
  onExpect: (who: string, amount: number, note: string) => Promise<boolean>;
  onLink: (reimbursementIds: string[]) => Promise<boolean>;
  onUnlink: () => void;
  onDelete: () => void;
};

export default function TransactionRow({
  row: r,
  categories,
  tags,
  people,
  open,
  busy,
  selected,
  actions,
}: {
  row: Row;
  categories: Category[];
  /** every tag, for the picker; the row's own are looked up from it */
  tags: Tag[];
  /** everyone you've entered before, for Expect reimbursement's suggestions */
  people: string[];
  /** everything still owed, for Link to what someone owes */
  open: OpenItem[];
  busy: boolean;
  selected: boolean;
  actions: RowActions;
}) {
  const name = rowName(r);
  const rowTags = r.transaction_tags
    .map((x) => tags.find((t) => t.id === x.tag_id))
    .filter((t): t is Tag => Boolean(t))
    .sort((a, b) => a.name.localeCompare(b.name));
  const tagCell = (
    <TagCell
      tags={rowTags}
      allTags={tags}
      rowName={name}
      onAdd={actions.onAddTag}
      onCreate={actions.onCreateTag}
      onRemove={actions.onRemoveTag}
      onFilter={actions.onFilterTag}
    />
  );

  return (
    <tr className={[r.approved ? '' : 'unreviewed', selected ? 'selected' : ''].join(' ').trim() || undefined}>
      <td className="select-col">
        <input type="checkbox" aria-label={`Select ${name}`} checked={selected} disabled={busy} onChange={actions.onSelect} />
      </td>
      <td className="date-col">{shortDate(r.posted_date)}</td>
      <td>
        <MerchantCell
          name={r.merchants?.name}
          description={r.description}
          postedDate={r.posted_date}
          account={r.accounts?.name}
          note={r.note}
          summary={
            r.reimbursements.length > 0 ? (
              <div className="reimb-line">{reimbursementSummary(r.reimbursements)}</div>
            ) : isLinked(r) ? (
              <div className="reimb-line">Paid back by {payers(r.reimbursement_payments)}</div>
            ) : undefined
          }
        >
          {/* phones hide the Tags column, so tags live in the row's details there */}
          <div className="phone-only-block">{tagCell}</div>
          <ReimbursementActions row={r} people={people} open={open} busy={busy} actions={actions} />
          {r.source === 'manual' && (
            <RowAction
              className="danger"
              disabled={busy}
              title="You added this by hand, so you can delete it"
              aria-label={`Delete ${name}`}
              onClick={actions.onDelete}
            >
              Delete transaction
            </RowAction>
          )}
        </MerchantCell>
      </td>
      <td className="account-col">{r.accounts?.name}</td>
      <td>
        {isLinked(r) ? (
          <span className="muted">Payback, not income</span>
        ) : (
          <CategorySelect
            categories={categories}
            value={r.is_transfer ? TRANSFER : r.category_id}
            disabled={busy}
            label={`Category for ${name}`}
            onChange={actions.onCategory}
          />
        )}
      </td>
      <td className="tags-col">
        <div className="tags-full">{tagCell}</div>
        {/* phones: just how many; the tags themselves are in the row's details */}
        <span className="tags-count" aria-label={`${r.transaction_tags.length} tags`}>
          {r.transaction_tags.length || ''}
        </span>
      </td>
      <td className={`num ${Number(r.amount) < 0 ? 'out' : 'in'}`}>
        {money(r.amount)}
        {r.reimbursements.length > 0 && (
          <div className="share">your share {money(-yourShare(Number(r.amount), r.reimbursements))}</div>
        )}
      </td>
      <td className="approved-col">
        <input
          type="checkbox"
          aria-label={`Approved: ${name}`}
          title={
            isLinked(r)
              ? 'Linked as a payback; use Unlink payment in its details to change this'
              : r.approved
                ? 'Untick to move it back to To review'
                : 'Tick to approve'
          }
          checked={r.approved}
          disabled={busy || isLinked(r)}
          onChange={actions.onToggleApproved}
        />
      </td>
    </tr>
  );
}

/**
 * A pending row: read-only, since the bank usually sends the posted version
 * under a new id and the sync deletes this one, taking anything set on it
 * along. The category the sync pre-filled shows as text.
 */
export function PendingRow({ row: r, categories }: { row: Row; categories: Category[] }) {
  return (
    <tr className="pending">
      <td className="select-col" />
      <td className="date-col">{shortDate(r.posted_date)}</td>
      <td>
        <MerchantCell
          name={r.merchants?.name}
          description={r.description}
          postedDate={r.posted_date}
          account={r.accounts?.name}
          summary={<div className="pending-line">Pending</div>}
        />
      </td>
      <td className="account-col">{r.accounts?.name}</td>
      <td className="pending-category">
        {r.is_transfer ? 'Transfer' : (categories.find((c) => c.id === r.category_id)?.name ?? 'Uncategorized')}
      </td>
      <td className="tags-col" />
      <td className={`num ${Number(r.amount) < 0 ? 'out' : 'in'}`}>{money(r.amount)}</td>
      <td className="approved-col" />
    </tr>
  );
}

/**
 * The reimbursement action in a row's details: Expect reimbursement on a
 * charge; on money in, Link to what someone owes, or Unlink payment once
 * linked. Each opens its form in place.
 */
function ReimbursementActions({
  row: r,
  people,
  open,
  busy,
  actions,
}: {
  row: Row;
  people: string[];
  open: OpenItem[];
  busy: boolean;
  actions: RowActions;
}) {
  const [form, setForm] = useState(false);
  const name = rowName(r);

  if (isCharge(r)) {
    const charge = -Number(r.amount);
    if (form) {
      return (
        <ExpectForm
          charge={charge}
          expected={expectedOn(r)}
          people={people}
          busy={busy}
          onCancel={() => setForm(false)}
          onSave={async (who, amount, note) => (await actions.onExpect(who, amount, note)) && setForm(false)}
        />
      );
    }
    const full = expectedOn(r) >= charge;
    return (
      <RowAction
        disabled={busy || full}
        title={full ? 'The whole charge is already expected back' : 'Someone owes you part of this'}
        aria-label={`Expect reimbursement on ${name}`}
        onClick={() => setForm(true)}
      >
        Expect reimbursement
      </RowAction>
    );
  }

  if (Number(r.amount) > 0 && !r.is_transfer) {
    if (isLinked(r)) {
      return (
        <RowAction disabled={busy} aria-label={`Unlink payment ${name}`} onClick={actions.onUnlink}>
          Unlink payment
        </RowAction>
      );
    }
    if (form) {
      return (
        <LinkForm
          payment={Number(r.amount)}
          open={open}
          busy={busy}
          onCancel={() => setForm(false)}
          onLink={async (ids) => (await actions.onLink(ids)) && setForm(false)}
        />
      );
    }
    return (
      <RowAction disabled={busy} aria-label={`Link ${name} to what someone owes`} onClick={() => setForm(true)}>
        Link to what someone owes
      </RowAction>
    );
  }

  return null;
}

/** A small link button on its own line in a row's details. */
function RowAction(props: ComponentProps<typeof Button>) {
  return (
    <div className="row-actions">
      <Button variant="link" size="small" {...props} />
    </div>
  );
}
