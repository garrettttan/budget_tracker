import { useId, type MouseEvent, type ReactNode } from 'react';
import { shortDate } from '../lib/format';
import Button from './Button';
import Collapse from './Collapse';

/**
 * A transaction's merchant name, with a chevron: it opens the row's details
 * (date and account, which phones hide; the bank's text, your note, and
 * anything passed as children), as does a tap anywhere else on the row that
 * isn't a control (rowToggle). Hover (desktop) shows the bank's text.
 */
export default function MerchantCell({
  name,
  description,
  postedDate,
  account,
  note,
  summary,
  open,
  onToggle,
  children,
}: {
  name: string | undefined;
  description: string;
  postedDate: string;
  account: string | undefined;
  note?: string | null;
  /** a line always shown under the name, e.g. who owes you part of it */
  summary?: ReactNode;
  /** whether the details show; the row holds it, since a tap on the row opens them too */
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  const id = useId();
  const text = name ?? description;
  // the chevron stays on the same line as the name's last word
  const split = text.lastIndexOf(' ');
  return (
    <>
      <Button variant="link" className="merchant-toggle" title={description} aria-expanded={open} aria-controls={id} onClick={onToggle}>
        {split > 0 ? text.slice(0, split + 1) : ''}
        <span className="merchant-last">
          {split > 0 ? text.slice(split + 1) : text}
          <svg className="merchant-chevron" viewBox="0 0 6 10" aria-hidden="true">
            <path d="M1 1l4 4-4 4" />
          </svg>
        </span>
      </Button>
      {summary}
      <Collapse open={open}>
        <div id={id} className="row-details">
          <span className="phone-only">
            {shortDate(postedDate)} · {account}
            <br />
          </span>
          {description}
          {note && <span className="row-note">Note: {note}</span>}
          {children}
        </div>
      </Collapse>
    </>
  );
}

// what a tap on the row leaves alone: its controls, and the cells holding small ones (a near miss
// on a checkbox or ⋯ shouldn't open the details)
const CONTROLS = 'button, a, input, select, textarea, label, [role="combobox"], [role="listbox"], .combobox';
const CONTROL_CELLS = 'td.select-col, td.approved-col, td.menu-col';

/**
 * A row's onClick: toggles its details unless the tap was on a control (the
 * merchant button toggles them itself), in a control's cell, or the end of
 * selecting text.
 */
export function rowToggle(toggle: () => void) {
  return (e: MouseEvent<HTMLTableRowElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest(CONTROLS) || target.closest(CONTROL_CELLS)) return;
    if (window.getSelection()?.toString()) return;
    toggle();
  };
}
