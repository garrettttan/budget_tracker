import { useId, useState, type ReactNode } from 'react';
import { shortDate } from '../lib/format';
import Button from './Button';

/**
 * A transaction's merchant name. Hover (desktop) shows the bank's text;
 * click/tap shows details: date and account (phones hide those columns), the
 * bank's text, your note, and any extra actions passed as children.
 */
export default function MerchantCell({
  name,
  description,
  postedDate,
  account,
  note,
  summary,
  children,
}: {
  name: string | undefined;
  description: string;
  postedDate: string;
  account: string | undefined;
  note?: string | null;
  /** a line always shown under the name, e.g. who owes you part of it */
  summary?: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <Button
        variant="link"
        className="merchant-toggle"
        title={description}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {name ?? description}
      </Button>
      {summary}
      {open && (
        <div id={id} className="row-details">
          <span className="phone-only">
            {shortDate(postedDate)} · {account}
            <br />
          </span>
          {description}
          {note && <span className="row-note">Note: {note}</span>}
          {children}
        </div>
      )}
    </>
  );
}
