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
  /** shown inside the box, before what's typed (Amount's $) */
  prefix?: string;
};

const WIDTH = 256; // 16rem

/** What a typed filter needs; shared by the header popover and the phones' Filters sheet. */
export type FieldsProps = {
  label: string;
  fields: Field[];
  /** every field's value by key ('' = not set) */
  onApply: (values: Record<string, string>) => void;
};

export const fieldsOn = (fields: Field[]) => fields.some((f) => f.value !== '');

/**
 * A column header that filters its column by typed values (dates, amounts,
 * text), where HeaderFilter's checklist doesn't fit: tap it for a small form
 * (FieldsForm). Teal while any field is set. Closes on Esc or a tap outside,
 * dropping unapplied edits.
 */
export default function HeaderFields({
  align = 'start',
  children,
  ...form
}: FieldsProps & {
  /** which edge of the header the popover lines up with */
  align?: 'start' | 'end';
  /** what the header shows, if not `label` */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const { label } = form;
  const on = fieldsOn(form.fields);

  function close(refocus = true) {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }
  const { trigger, pop, style } = usePopover({ open, width: WIDTH, align, roomBelow: 200, onDismiss: close });

  return (
    <>
      <Button
        ref={trigger}
        variant="link"
        className={`th-filter${on ? ' active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Filter ${label}${on ? ', filter on' : ''}`}
        onClick={() => (open ? close() : setOpen(true))}
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
          <FieldsForm {...form} onDone={close} />
        </div>
      )}
    </>
  );
}

/** The form itself: Apply (or Enter) sets every field at once, Clear empties them; either then calls `onDone`. */
export function FieldsForm({ fields, onApply, onDone }: FieldsProps & { onDone: () => void }) {
  // starts from what's applied; edits stay here until Apply
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.value])));
  const on = fieldsOn(fields);

  function apply(e: FormEvent) {
    e.preventDefault();
    onApply(Object.fromEntries(fields.map((f) => [f.key, (draft[f.key] ?? '').trim()])));
    onDone();
  }

  return (
    <form className="header-fields" onSubmit={apply}>
      {fields.map((f, i) => (
        <label key={f.key}>
          <span>{f.label}</span>
          <span className={f.prefix ? 'header-fields-box has-prefix' : 'header-fields-box'}>
            {f.prefix && (
              <span className="header-fields-prefix" aria-hidden="true">
                {f.prefix}
              </span>
            )}
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
          </span>
        </label>
      ))}
      <div className="header-fields-actions">
        <Button
          variant="link"
          size="small"
          disabled={!on && fields.every((f) => !draft[f.key])}
          onClick={() => {
            onApply(Object.fromEntries(fields.map((f) => [f.key, ''])));
            onDone();
          }}
        >
          Clear
        </Button>
        <Button variant="primary" size="small" type="submit">
          Apply
        </Button>
      </div>
    </form>
  );
}
