// One row of the transaction list on Spending. A posted row is editable
// (select box, category, tags, Approved, and a ⋯ menu of actions); a pending
// row is read-only (see PendingRow).
import { useId, useState } from 'react';
import { money, shortDate } from '../lib/format';
import { type OpenItem, payers, reimbursementSummary, yourShare } from '../lib/reimbursements';
import { type Row, expectedOn, isCharge, isLinked, rowName } from '../lib/transactions';
import Combobox from './Combobox';
import CategorySelect, { type Category, TRANSFER } from './CategorySelect';
import MerchantCell, { rowToggle } from './MerchantCell';
import Modal from './Modal';
import { ExpectForm, LinkForm } from './ReimbursementForms';
import RowMenu, { type MenuItem } from './RowMenu';
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
  const [details, setDetails] = useState(false);
  const toggleDetails = () => setDetails((d) => !d);
  const rowTags = r.transaction_tags
    .map((x) => tags.find((t) => t.id === x.tag_id))
    .filter((t): t is Tag => Boolean(t))
    .sort((a, b) => a.name.localeCompare(b.name));
  const tagCell = (phone: boolean) => (
    <TagCell
      tags={rowTags}
      allTags={tags}
      rowName={name}
      onAdd={actions.onAddTag}
      onCreate={actions.onCreateTag}
      onRemove={actions.onRemoveTag}
      onFilter={actions.onFilterTag}
      noAddButton={phone}
    />
  );

  return (
    <tr
      className={[r.approved ? '' : 'unreviewed', selected ? 'selected' : '', details ? 'open' : ''].join(' ').trim() || undefined}
      onClick={rowToggle(toggleDetails)}
    >
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
          open={details}
          onToggle={toggleDetails}
          summary={
            r.reimbursements.length > 0 ? (
              <div className="reimb-line">{reimbursementSummary(r.reimbursements)}</div>
            ) : isLinked(r) ? (
              <div className="reimb-line">Paid back by {payers(r.reimbursement_payments)}</div>
            ) : undefined
          }
        >
          {/* phones hide the Tags column, so tags live in the row's details there */}
          <div className="phone-only-block">{tagCell(true)}</div>
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
      {/* hidden on phones, where tags live in the row's details (and the Filters sheet filters them) */}
      <td className="tags-col">{tagCell(false)}</td>
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
              ? 'Linked as a payback; use Unlink payment in its ⋯ menu to change this'
              : r.approved
                ? 'Untick to move it back to To review'
                : 'Tick to approve'
          }
          checked={r.approved}
          disabled={busy || isLinked(r)}
          onChange={actions.onToggleApproved}
        />
      </td>
      <td className="menu-col">
        <ActionsMenu row={r} people={people} open={open} busy={busy} actions={actions} tags={tags} rowTags={rowTags} />
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
  const [details, setDetails] = useState(false);
  const toggleDetails = () => setDetails((d) => !d);
  return (
    <tr className={details ? 'pending open' : 'pending'} onClick={rowToggle(toggleDetails)}>
      <td className="select-col" />
      <td className="date-col">{shortDate(r.posted_date)}</td>
      <td>
        <MerchantCell
          name={r.merchants?.name}
          description={r.description}
          postedDate={r.posted_date}
          account={r.accounts?.name}
          summary={<div className="pending-line">Pending</div>}
          open={details}
          onToggle={toggleDetails}
        />
      </td>
      <td className="account-col">{r.accounts?.name}</td>
      <td className="pending-category">
        {r.is_transfer ? 'Transfer' : (categories.find((c) => c.id === r.category_id)?.name ?? 'Uncategorized')}
      </td>
      <td className="tags-col" />
      <td className={`num ${Number(r.amount) < 0 ? 'out' : 'in'}`}>{money(r.amount)}</td>
      <td className="approved-col" />
      <td className="menu-col" />
    </tr>
  );
}

type Form = 'expect' | 'link' | 'tag';

/**
 * A row's ⋯ menu: Add tag (phones only: wider screens have the Tags column);
 * Expect reimbursement on a charge; on money in, Link to what someone owes, or
 * Unlink payment once linked; Delete transaction on one you added by hand.
 * Expect and Link open their form in a modal. No menu if none apply (on wider
 * screens, none but Add tag). Add tag opens a modal pinned to the top of the
 * screen, so the phone keyboard can't cover its box.
 */
function ActionsMenu({
  row: r,
  people,
  open,
  busy,
  actions,
  tags,
  rowTags,
}: {
  row: Row;
  people: string[];
  open: OpenItem[];
  busy: boolean;
  actions: RowActions;
  /** every tag, for Add tag's picker */
  tags: Tag[];
  /** the row's own, left out of it */
  rowTags: Tag[];
}) {
  const [form, setForm] = useState<Form | null>(null);
  const [failed, setFailed] = useState(false);
  const titleId = useId();
  const name = rowName(r);
  const show = (f: Form) => {
    setFailed(false);
    setForm(f);
  };

  // Add tag (phones): a picker in a modal pinned to the top, so the keyboard never covers its box
  const items: MenuItem[] = [{ label: 'Add tag', phoneOnly: true, onSelect: () => show('tag') }];
  if (isCharge(r)) {
    const full = expectedOn(r) >= -Number(r.amount);
    items.push({
      label: 'Expect reimbursement',
      disabled: full,
      title: full ? 'The whole charge is already expected back' : 'Someone owes you part of this',
      onSelect: () => show('expect'),
    });
  } else if (Number(r.amount) > 0 && !r.is_transfer) {
    items.push(
      isLinked(r)
        ? { label: 'Unlink payment', onSelect: actions.onUnlink }
        : { label: 'Link to what someone owes', onSelect: () => show('link') },
    );
  }
  if (r.source === 'manual') {
    items.push({
      label: 'Delete transaction',
      danger: true,
      title: 'You added this by hand, so you can delete it',
      onSelect: actions.onDelete,
    });
  }

  // the modal stays open if saving failed, so nothing typed is lost
  const saved = (ok: boolean, close: () => void) => (ok ? close() : setFailed(true));

  return (
    <>
      <RowMenu label={`More for ${name}`} items={items} disabled={busy} />
      {form && (
        <Modal
          labelledBy={titleId}
          busy={busy}
          onClose={() => setForm(null)}
          className={form === 'tag' ? 'tag-sheet' : undefined}
        >
          {(close) => (
            <>
              <h2 id={titleId}>
                {form === 'tag' ? 'Add tag' : form === 'expect' ? 'Expect reimbursement' : 'Link to what someone owes'}
              </h2>
              <p className="muted small">
                {name} · {shortDate(r.posted_date)} · {money(r.amount)}
              </p>
              {failed && (
                <p className="error" role="alert">
                  Couldn’t save. Try again.
                </p>
              )}
              {form === 'tag' ? (
                <Combobox
                  options={tags.filter((t) => !rowTags.some((x) => x.id === t.id)).map((t) => ({ value: t.id, text: t.name }))}
                  value={null}
                  label={`Add a tag to ${name}`}
                  placeholder="Tag name"
                  autoFocus
                  onChange={(id) => {
                    actions.onAddTag(id);
                    close();
                  }}
                  onCreate={(text) => {
                    actions.onCreateTag(text);
                    close();
                  }}
                  createLabel={(text) => `New tag “${text}”`}
                />
              ) : form === 'expect' ? (
                <ExpectForm
                  charge={-Number(r.amount)}
                  expected={expectedOn(r)}
                  people={people}
                  busy={busy}
                  onCancel={close}
                  onSave={async (who, amount, note) => saved(await actions.onExpect(who, amount, note), close)}
                />
              ) : (
                <LinkForm
                  payment={Number(r.amount)}
                  open={open}
                  busy={busy}
                  onCancel={close}
                  onLink={async (ids) => saved(await actions.onLink(ids), close)}
                />
              )}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
