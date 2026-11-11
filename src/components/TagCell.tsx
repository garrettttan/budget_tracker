import { useState } from 'react';
import Button from './Button';
import Combobox from './Combobox';
import { strings } from '../lib/strings';

const copy = strings.row;

export type Tag = { id: string; name: string };

/**
 * A transaction's tags: each one links to the transactions carrying it and has
 * an × to take it off; "+ Tag" opens a picker that can also create a new tag.
 * On phones the row's ⋯ menu has Add tag instead (`noAddButton`).
 */
export default function TagCell({
  tags,
  allTags,
  rowName,
  disabled,
  onAdd,
  onCreate,
  onRemove,
  onFilter,
  noAddButton = false,
}: {
  tags: Tag[];
  allTags: Tag[];
  rowName: string;
  disabled?: boolean;
  onAdd: (tagId: string) => void;
  onCreate: (name: string) => void;
  onRemove: (tagId: string) => void;
  onFilter: (tagId: string) => void;
  /** leave out "+ Tag" (phones: Add tag is in the ⋯ menu) */
  noAddButton?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  // nothing to show (phones' row details, no tags): no empty line holding the place of "+ Tag"
  if (noAddButton && tags.length === 0 && !adding) return null;
  const on = new Set(tags.map((t) => t.id));

  return (
    <div className="tag-cell">
      {tags.map((t) => (
        <span key={t.id} className="tag-chip">
          <Button variant="link" className="tag-chip-name" title={copy.showTagged(t.name)} onClick={() => onFilter(t.id)}>
            {t.name}
          </Button>
          <Button
            variant="icon"
            className="tag-chip-remove"
            aria-label={copy.removeTagFrom(t.name, rowName)}
            title={copy.removeTag}
            disabled={disabled}
            onClick={() => onRemove(t.id)}
          >
            {strings.common.closeSymbol}
          </Button>
        </span>
      ))}
      {adding ? (
        <Combobox
          options={allTags.filter((t) => !on.has(t.id)).map((t) => ({ value: t.id, text: t.name }))}
          value={null}
          label={strings.common.addTagTo(rowName)}
          placeholder={strings.common.tagName}
          autoFocus
          disabled={disabled}
          onChange={onAdd}
          onCreate={onCreate}
          createLabel={strings.common.newTag}
          onClose={() => setAdding(false)}
        />
      ) : noAddButton ? null : (
        <Button
          variant="link"
          size="small"
          className="tag-add"
          aria-label={strings.common.addTagTo(rowName)}
          disabled={disabled}
          onClick={() => setAdding(true)}
        >
          {copy.addTagButton}
        </Button>
      )}
    </div>
  );
}
