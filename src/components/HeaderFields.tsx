import { type ReactNode, type FormEvent, useId, useState } from 'react';
import Button from './Button';
import { usePopover } from './usePopover';

export type Field = {
  key: string;
  label: string;
  type: 'text' | 'date' | 'number';
  /** the applied value ('' = not set) */
  value: string;
  placeholder?: string;
};

const WIDTH = 256; // 16rem

/**
 * A column header that filters its column by typed values (dates, amounts,
 * text), where HeaderFilter's checklist doesn't fit: tap it for a small form,
 * Apply (or Enter) sets every field at once, Clear empties them. Teal while any
 * field is set. Closes on Esc or a tap outside, dropping unapplied edits.
 */
export default function HeaderFields({
  label,
  fields,
  onApply,
  align = 'start',
  children,
}: {
  label: string;
  fields: Field[];
  /** every field's value by key ('' = not set) */
  onApply: (values: Record<string, string>) => void;
  /** which edge of the header the popover lines up with */
  align?: 'start' | 'end';
  /** what the header shows, if not `label` */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const titleId = useId();
  const on = fields.some((f) => f.value !== '');

  function show() {
    setDraft(Object.fromEntries(fields.map((f) => [f.key, f.value])));
    setOpen(true);
  }
  function close(refocus = true) {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }
  const { trigger, pop, style } = usePopover({ open, width: WIDTH, align, roomBelow: 200, onDismiss: close });

  function apply(e: FormEvent) {
    e.preventDefault();
    onApply(Object.fromEntries(fields.map((f) => [f.key, (draft[f.key] ?? '').trim()])));
    close();
  }

  return (
    <>
      <Button
        ref={trigger}
        variant="link"
        className={`th-filter${on ? ' active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Filter ${label}${on ? ', filter on' : ''}`}
        onClick={() => (open ? close() : show())}
      >
        <span className="th-filter-label">{children ?? label}</span>
        <svg className="th-caret" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M0.5 0.5h9L5 5.5z" />
        </svg>
      </Button>
      {open && (
        <div ref={pop} className="header-filter-pop" role="dialog" aria-labelledby={titleId} style={style}>
          <span id={titleId} className="visually-hidden">
            Filter {label}
          </span>
          <form className="header-fields" onSubmit={apply}>
            {fields.map((f, i) => (
              <label key={f.key}>
                <span>{f.label}</span>
                <input
                  type={f.type}
                  inputMode={f.type === 'number' ? 'decimal' : undefined}
                  min={f.type === 'number' ? 0 : undefined}
                  step={f.type === 'number' ? 'any' : undefined}
                  placeholder={f.placeholder}
                  value={draft[f.key] ?? ''}
                  autoFocus={i === 0}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              </label>
            ))}
            <div className="header-fields-actions">
              <Button
                variant="link"
                size="small"
                disabled={!on && fields.every((f) => !draft[f.key])}
                onClick={() => {
                  onApply(Object.fromEntries(fields.map((f) => [f.key, ''])));
                  close();
                }}
              >
                Clear
              </Button>
              <Button variant="primary" size="small" type="submit">
                Apply
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
