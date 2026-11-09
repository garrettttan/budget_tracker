import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import Button from './Button';
import { usePopover } from './usePopover';

export type MenuItem = {
  label: string;
  /** what picking it does (the menu closes first) */
  onSelect?: () => void;
  /** instead of onSelect: what the popover shows in place of the menu (Add tag's picker); `close` shuts it */
  panel?: (close: () => void) => ReactNode;
  disabled?: boolean;
  /** why it's disabled, or what it does */
  title?: string;
  danger?: boolean;
  /** shown on phones only (Add tag: wider screens have a Tags column) */
  phoneOnly?: boolean;
};

const WIDTH = 224; // 14rem
const PANEL_WIDTH = 256; // 16rem

/**
 * A row's ⋯ button and its menu of actions. Arrow keys move between items;
 * Esc or a tap outside closes it. An item with a `panel` swaps the menu for it,
 * in the same popover.
 */
export default function RowMenu({ label, items, disabled }: { label: string; items: MenuItem[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<MenuItem | null>(null);
  const menuId = useId();
  const list = useRef<HTMLDivElement>(null);

  function close(refocus = true) {
    setOpen(false);
    setPanel(null);
    if (refocus) trigger.current?.focus();
  }

  // a panel is wider and taller: the new width also places the popover again
  const { trigger, pop, style } = usePopover({
    open,
    width: panel ? PANEL_WIDTH : WIDTH,
    align: 'end',
    roomBelow: panel ? 320 : 160,
    onDismiss: close,
  });

  /** the items on screen and usable (phone-only ones are hidden on wider screens) */
  const usable = () =>
    [...(list.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])].filter((b) => b.offsetParent !== null);
  // focus the first item that can be used, once the menu is placed (it's invisible until then,
  // and an invisible button can't take focus)
  const placed = open && !('visibility' in style);
  useEffect(() => {
    if (placed && !panel) usable()[0]?.focus();
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
        <div ref={pop} className={panel ? 'row-menu row-menu-panel' : 'row-menu'} style={style}>
          {panel ? (
            panel.panel?.(close)
          ) : (
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
                    if (item.panel) return setPanel(item);
                    close(false);
                    item.onSelect?.();
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
