import Button from './Button';
import { type Category, UNCATEGORIZED } from './CategorySelect';
import Combobox from './Combobox';
import type { Tag } from './TagCell';
import { strings } from '../lib/strings';

const t = strings.bulk;

/**
 * Actions for the selected rows: approve them, give them all one category,
 * add a tag to all of them (or create one), or take a tag off all of them.
 */
export default function BulkBar({
  count,
  approvable,
  categories,
  categorizable,
  allTags,
  tagsOnSelected,
  busy,
  onApprove,
  onSetCategory,
  onAddTag,
  onCreateTag,
  onRemoveTag,
  onClear,
}: {
  count: number;
  /** selected rows still waiting for review */
  approvable: number;
  categories: Category[];
  /** selected rows that take a category (a linked payback doesn't) */
  categorizable: number;
  allTags: Tag[];
  /** tags at least one selected row carries */
  tagsOnSelected: Tag[];
  busy: boolean;
  onApprove: () => void;
  /** a category id or UNCATEGORIZED */
  onSetCategory: (value: string) => void;
  onAddTag: (tagId: string) => void;
  onCreateTag: (name: string) => void;
  onRemoveTag: (tagId: string) => void;
  onClear: () => void;
}) {
  const options = (tags: Tag[]) => tags.map((t) => ({ value: t.id, text: t.name }));
  return (
    <div className="bulk-bar" role="region" aria-label={t.region}>
      <strong>{t.selected(count)}</strong>
      <Button
        variant="primary"
        size="small"
        disabled={busy || approvable === 0}
        title={approvable === 0 ? t.noneToApprove : undefined}
        onClick={onApprove}
      >
        {t.approve(approvable)}
      </Button>
      <Combobox
        options={[...categories.map((c) => ({ value: c.id, text: c.name })), { value: UNCATEGORIZED, text: strings.common.uncategorized }]}
        value={null}
        label={t.setCategoryLabel}
        placeholder={t.setCategory}
        disabled={busy || categorizable === 0}
        onChange={onSetCategory}
      />
      <Combobox
        options={options(allTags)}
        value={null}
        label={t.addTagLabel}
        placeholder={t.addTag}
        disabled={busy}
        onChange={onAddTag}
        onCreate={onCreateTag}
        createLabel={strings.common.newTag}
      />
      <Combobox
        options={options(tagsOnSelected)}
        value={null}
        label={t.removeTagLabel}
        placeholder={t.removeTag}
        disabled={busy || tagsOnSelected.length === 0}
        onChange={onRemoveTag}
      />
      <Button variant="link" size="small" disabled={busy} onClick={onClear}>
        {strings.spending.clearSelection}
      </Button>
    </div>
  );
}
