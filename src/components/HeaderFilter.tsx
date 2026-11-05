import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Button from './Button';

type Item = { id: string; name: string };

const WIDTH = 288; // 18rem
const GUTTER = 16;

/**
 * A column header that filters its column: tap it for a searchable checklist,
 * spreadsheet style. Everything is ticked (shown) by default; untick to hide.
 * "Select all" ticks or unticks whatever the search matches, and each row has
 * "Only". Closes on Esc or a tap outside; follows the header when the page scrolls.
 */
export default function HeaderFilter({
  label,
  items,
  hidden,
  onChange,
  onOnly,
  align = 'start',
}: {
  label: string;
  items: Item[];
  /** ids unticked */
  hidden: string[];
  onChange: (hidden: string[]) => void;
  onOnly: (id: string) => void;
  /** which edge of the header the popover lines up with */
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const count = items.filter((i) => hidden.includes(i.id)).length;
  const typed = query.trim().toLowerCase();
  const matches = typed ? items.filter((i) => i.name.toLowerCase().includes(typed)) : items;
  const shownMatches = matches.filter((i) => !hidden.includes(i.id)).length;
  const allShown = matches.length > 0 && shownMatches === matches.length;

  function close(refocus = true) {
    setOpen(false);
    setQuery('');
    if (refocus) trigger.current?.focus();
  }

  // under the header, kept inside the screen
  function place() {
    if (!trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - 2 * GUTTER);
    const wanted = align === 'end' ? r.right - width : r.left;
    setPos({ top: r.bottom + 4, left: Math.max(GUTTER, Math.min(wanted, window.innerWidth - width - GUTTER)) });
  }

  useLayoutEffect(() => {
    if (open) place();
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !trigger.current?.contains(t)) close(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    // the page scrolling (e.g. a phone bringing the search box into view) moves it along
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

  const toggle = (id: string) => onChange(hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id]);
  const ids = matches.map((i) => i.id);
  const selectAll = () =>
    onChange(allShown ? [...new Set([...hidden, ...ids])] : hidden.filter((h) => !ids.includes(h)));

  return (
    <>
      <Button
        ref={trigger}
        variant="link"
        className={`th-filter${count ? ' active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Filter ${label}${count ? `, ${count} hidden` : ''}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="th-filter-label">{label}</span>
        {count > 0 && <span className="badge">{count}</span>}
        <span className="th-caret" aria-hidden="true">
          ▾
        </span>
      </Button>
      {open && (
        <div
          ref={pop}
          className="header-filter-pop"
          role="dialog"
          aria-labelledby={titleId}
          style={pos ? { top: pos.top, left: pos.left, width: Math.min(WIDTH, window.innerWidth - 2 * GUTTER) } : { visibility: 'hidden' }}
        >
          <span id={titleId} className="visually-hidden">
            Filter {label}
          </span>
          <input
            type="search"
            className="header-filter-search"
            placeholder={`Search ${label.toLowerCase()}`}
            aria-label={`Search ${label.toLowerCase()}`}
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="header-filter-all">
            <input
              type="checkbox"
              checked={allShown}
              disabled={matches.length === 0}
              ref={(el) => {
                if (el) el.indeterminate = shownMatches > 0 && !allShown;
              }}
              onChange={selectAll}
            />
            {typed ? 'Select all matches' : 'Select all'}
          </label>
          <ul className="header-filter-list">
            {matches.map((i) => (
              <li key={i.id}>
                <label>
                  <input type="checkbox" checked={!hidden.includes(i.id)} onChange={() => toggle(i.id)} />
                  <span>{i.name}</span>
                </label>
                <Button
                  variant="link"
                  size="small"
                  className="header-filter-only"
                  aria-label={`Only ${i.name}`}
                  onClick={() => {
                    onOnly(i.id);
                    close();
                  }}
                >
                  Only
                </Button>
              </li>
            ))}
            {matches.length === 0 && <li className="muted small">No matches.</li>}
          </ul>
          <div className="header-filter-foot">
            <Button
              variant="link"
              size="small"
              disabled={count === 0}
              title={count ? undefined : 'Nothing is hidden'}
              onClick={() => onChange([])}
            >
              Show all
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
