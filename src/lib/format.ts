const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** Formats a signed amount; negative = money out. */
export function money(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  return usd.format(Number(amount));
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  // Dates without a time are calendar dates; don't let the timezone shift them
  const d = iso.length === 10 ? new Date(iso + 'T12:00:00') : new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return shortDate(iso);
}
