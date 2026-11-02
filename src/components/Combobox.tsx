import { useId, useRef, useState } from 'react';

export type Option = { value: string; text: string };

/**
 * Searchable picker (an ARIA combobox): type to filter, ↑/↓ to move, Enter to
 * pick, Esc to cancel. Used for categories and merchants.
 */
export default function Combobox({
  options,
  value,
  onChange,
  label,
  disabled,
  autoFocus,
}: {
  options: Option[];
  value: string | null;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const selectedText = options.find((o) => o.value === value)?.text ?? '';

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const matches = query ? options.filter((o) => o.text.toLowerCase().includes(query.toLowerCase())) : options;

  function start() {
    setQuery('');
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function pick(optionValue: string) {
    setOpen(false);
    setQuery('');
    if (optionValue !== value) onChange(optionValue);
    input.current?.blur();
  }

  function cancel() {
    setOpen(false);
    setQuery('');
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
        placeholder="Choose…"
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
          {matches.length === 0 && <li className="combobox-empty">No match</li>}
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
