import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import Button from './Button';
import { usePopover } from './usePopover';

export type MenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** why it's disabled, or what it does */
  title?: string;
  danger?: boolean;
  /** shown on phones only (Add tag: wider screens have a Tags column) */
  phoneOnly?: boolean;
};

const WIDTH = 224; // 14rem

/**
 * A row's ⋯ button and its menu of actions. Arrow keys move between items;
 * Esc or a tap outside closes it.
 */
export default function RowMenu({ label, items, disabled }: { label: string; items: MenuItem[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const list = useRef<HTMLDivElement>(null);

  function close(refocus = true) {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }

  const { trigger, pop, style } = usePopover({ open, width: WIDTH, align: 'end', roomBelow: 160, onDismiss: close });

  /** the items on screen and usable (phone-only ones are hidden on wider screens) */
  const usable = () =>
    [...(list.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])].filter((b) => b.offsetParent !== null);
  // focus the first item that can be used, once the menu is placed (it's invisible until then,
  // and an invisible button can't take focus)
  const placed = open && !('visibility' in style);
  useEffect(() => {
    if (placed) usable()[0]?.focus();
  }, [placed]);

  /** Up/Down/Home/End move focus between the enabled items */
  function onKeyDown(e: KeyboardEvent) {
    const buttons = usable();
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'ArrowDown' ? (at + 1) % buttons.length
      : e.key === 'ArrowUp' ? (at - 1 + buttons.length) % buttons.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? buttons.length - 1
      : null;
    if (next === null) return;
    e.preventDefault();
    buttons[next].focus();
  }

  return (
    <>
      <Button
        ref={trigger}
        variant="icon"
        size="small"
        className={items.every((i) => i.phoneOnly) ? 'row-menu-button menu-phone-only' : 'row-menu-button'}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
      >
        ⋯
      </Button>
      {open && (
        <div ref={pop} className="row-menu" style={style}>
          <div ref={list} id={menuId} role="menu" aria-label={label} onKeyDown={onKeyDown}>
            {items.map((item) => (
              <Button
                key={item.label}
                variant="link"
                role="menuitem"
                className={[item.danger ? 'danger' : '', item.phoneOnly ? 'menu-phone-only' : ''].join(' ').trim() || undefined}
                disabled={item.disabled}
                title={item.title}
                onClick={() => {
                  close(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
