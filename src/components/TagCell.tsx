import { useState } from 'react';
import Button from './Button';
import Combobox from './Combobox';

export type Tag = { id: string; name: string };

/**
 * A transaction's tags: each one links to the transactions carrying it and has
 * an × to take it off; "+ Tag" opens a picker that can also create a new tag.
 * On phones the row's ⋯ menu opens the picker instead (`adding`, `noAddButton`).
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
  adding: addingProp,
  onAddingChange,
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
  /** the picker's open state, when the row holds it (its ⋯ menu's Add tag opens it) */
  adding?: boolean;
  onAddingChange?: (adding: boolean) => void;
  /** leave out "+ Tag" (phones: Add tag is in the ⋯ menu) */
  noAddButton?: boolean;
}) {
  const [ownAdding, setOwnAdding] = useState(false);
  const adding = addingProp ?? ownAdding;
  const setAdding = onAddingChange ?? setOwnAdding;
  const on = new Set(tags.map((t) => t.id));

  return (
    <div className="tag-cell">
      {tags.map((t) => (
        <span key={t.id} className="tag-chip">
          <Button variant="link" className="tag-chip-name" title={`Show transactions tagged ${t.name}`} onClick={() => onFilter(t.id)}>
            {t.name}
          </Button>
          <Button
            variant="icon"
            className="tag-chip-remove"
            aria-label={`Remove tag ${t.name} from ${rowName}`}
            title="Remove tag"
            disabled={disabled}
            onClick={() => onRemove(t.id)}
          >
            ×
          </Button>
        </span>
      ))}
      {adding ? (
        <Combobox
          options={allTags.filter((t) => !on.has(t.id)).map((t) => ({ value: t.id, text: t.name }))}
          value={null}
          label={`Add a tag to ${rowName}`}
          placeholder="Tag name"
          autoFocus
          disabled={disabled}
          onChange={onAdd}
          onCreate={onCreate}
          createLabel={(text) => `New tag “${text}”`}
          onClose={() => setAdding(false)}
        />
      ) : noAddButton ? null : (
        <Button
          variant="link"
          size="small"
          className="tag-add"
          aria-label={`Add a tag to ${rowName}`}
          disabled={disabled}
          onClick={() => setAdding(true)}
        >
          + Tag
        </Button>
      )}
    </div>
  );
}
