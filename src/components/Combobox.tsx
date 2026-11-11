import { useId, useRef, useState } from 'react';
import { strings } from '../lib/strings';

const t = strings.picker;

export type Option = { value: string; text: string };

/** Option value for "Create …" (shown when `onCreate` is passed and nothing matches exactly). */
const CREATE = '\u0000create';

/**
 * Searchable picker (an ARIA combobox): type to filter, ↑/↓ to move, Enter to
 * pick, Esc to cancel. Used for categories, merchants and tags. With
 * `onCreate`, typing a name no option has offers to create it.
 */
export default function Combobox({
  options,
  value,
  onChange,
  label,
  disabled,
  autoFocus,
  placeholder = t.choose,
  onCreate,
  createLabel = t.create,
  onClose,
}: {
  options: Option[];
  value: string | null;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  onCreate?: (text: string) => void;
  createLabel?: (text: string) => string;
  /** Called when the list closes without a pick (Esc or leaving the box). */
  onClose?: () => void;
}) {
  const selectedText = options.find((o) => o.value === value)?.text ?? '';

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const typed = query.trim();
  const filtered = typed ? options.filter((o) => o.text.toLowerCase().includes(typed.toLowerCase())) : options;
  const exact = options.some((o) => o.text.toLowerCase() === typed.toLowerCase());
  const matches = onCreate && typed && !exact ? [...filtered, { value: CREATE, text: createLabel(typed) }] : filtered;

  function start() {
    setQuery('');
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function pick(optionValue: string) {
    setOpen(false);
    setQuery('');
    if (optionValue === CREATE) onCreate?.(typed);
    else if (optionValue !== value) onChange(optionValue);
    input.current?.blur();
  }

  function cancel() {
    setOpen(false);
    setQuery('');
    onClose?.();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault();
      return start();
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matches[active]) pick(matches[active].value);
    } else if (e.key === 'Escape') {
      // inside a modal, Esc closes just the open list; the next Esc closes the modal
      if (open) e.preventDefault();
      cancel();
    }
  }

  return (
    <div className="combobox">
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        autoFocus={autoFocus}
        value={open ? query : selectedText}
        onFocus={start}
        onBlur={cancel}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul id={listId} role="listbox" aria-label={label}>
          {matches.length === 0 && (
            <li className="combobox-empty">{onCreate && !typed ? t.typeToCreate : t.noMatch}</li>
          )}
          {matches.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={i === active ? 'active' : undefined}
              // mousedown, not click: picks before the input's blur closes the list
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o.value);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {o.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
