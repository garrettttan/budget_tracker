import { useState } from 'react';
import Button from './Button';
import Combobox from './Combobox';

export type Tag = { id: string; name: string };

/**
 * A transaction's tags: each one links to the transactions carrying it and has
 * an × to take it off; "+ Tag" opens a picker that can also create a new tag.
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
}: {
  tags: Tag[];
  allTags: Tag[];
  rowName: string;
  disabled?: boolean;
  onAdd: (tagId: string) => void;
  onCreate: (name: string) => void;
  onRemove: (tagId: string) => void;
  onFilter: (tagId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
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
      ) : (
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
