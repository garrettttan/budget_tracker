import Button from './Button';
import Combobox from './Combobox';
import type { Tag } from './TagCell';

/**
 * Actions for the selected rows: approve them, add a tag to all of them (or
 * create one), or take a tag off all of them.
 */
export default function BulkBar({
  count,
  approvable,
  allTags,
  tagsOnSelected,
  busy,
  onApprove,
  onAddTag,
  onCreateTag,
  onRemoveTag,
  onClear,
}: {
  count: number;
  /** selected rows that are unapproved and have a category or are transfers */
  approvable: number;
  allTags: Tag[];
  /** tags at least one selected row carries */
  tagsOnSelected: Tag[];
  busy: boolean;
  onApprove: () => void;
  onAddTag: (tagId: string) => void;
  onCreateTag: (name: string) => void;
  onRemoveTag: (tagId: string) => void;
  onClear: () => void;
}) {
  const options = (tags: Tag[]) => tags.map((t) => ({ value: t.id, text: t.name }));
  return (
    <div className="bulk-bar" role="region" aria-label="Selected transactions">
      <strong>{count} selected</strong>
      <Button
        variant="primary"
        size="small"
        disabled={busy || approvable === 0}
        title={approvable === 0 ? 'None of the selected rows is waiting for review with a category' : undefined}
        onClick={onApprove}
      >
        Approve{approvable ? ` ${approvable}` : ''}
      </Button>
      <Combobox
        options={options(allTags)}
        value={null}
        label="Add a tag to the selected transactions"
        placeholder="+ Add tag"
        disabled={busy}
        onChange={onAddTag}
        onCreate={onCreateTag}
        createLabel={(text) => `New tag “${text}”`}
      />
      <Combobox
        options={options(tagsOnSelected)}
        value={null}
        label="Remove a tag from the selected transactions"
        placeholder="− Remove tag"
        disabled={busy || tagsOnSelected.length === 0}
        onChange={onRemoveTag}
      />
      <Button variant="link" size="small" disabled={busy} onClick={onClear}>
        Clear selection
      </Button>
    </div>
  );
}
