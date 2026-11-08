import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const GUTTER = 16;

export type PopoverPosition = { top?: number; bottom?: number; left: number; maxHeight: number; width: number };

/**
 * A popover anchored to a trigger button (HeaderFilter, RowMenu): placed under
 * it (above when there's more room there), kept inside the screen, following
 * the trigger when the page scrolls. Esc or a tap outside calls `onDismiss`
 * (`refocus` is true for Esc, so focus goes back to the trigger).
 */
export function usePopover({
  open,
  width,
  align,
  roomBelow = 320,
  onDismiss,
}: {
  open: boolean;
  /** wanted width; narrowed to fit the screen */
  width: number;
  /** which edge of the trigger the popover lines up with */
  align: 'start' | 'end';
  /** stay below the trigger if at least this much room is there */
  roomBelow?: number;
  onDismiss: (refocus: boolean) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PopoverPosition | null>(null);
  // the latest onDismiss, without re-subscribing the listeners each render
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  function place() {
    if (!trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 2 * GUTTER);
    const wanted = align === 'end' ? r.right - w : r.left;
    const left = Math.max(GUTTER, Math.min(wanted, window.innerWidth - w - GUTTER));
    const below = window.innerHeight - r.bottom - 4 - GUTTER;
    const above = r.top - 4 - GUTTER;
    if (below >= roomBelow || below >= above) setPos({ top: r.bottom + 4, left, maxHeight: below, width: w });
    else setPos({ bottom: window.innerHeight - r.top + 4, left, maxHeight: above, width: w });
  }

  useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !trigger.current?.contains(t)) dismiss.current(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && dismiss.current(true);
    // the page scrolling (e.g. a phone bringing a search box into view) moves it along
    const follow = (e: Event) => {
      if (!pop.current?.contains(e.target as Node)) place();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [open]);

  /** for the popover's style: hidden until placed, so it never flashes in the corner */
  const style = pos ?? { visibility: 'hidden' as const };
  return { trigger, pop, style };
}
