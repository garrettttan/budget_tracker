const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** Formats a signed amount; negative = money out. */
export function money(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  return usd.format(Number(amount));
}

/**
 * Reads a typed amount like "12", "1,234.5" or "$12.50" as a number rounded to
 * cents; null if it isn't one. Negative only with `allowNegative` (a balance).
 */
export function parseAmount(text: string, { allowNegative = false } = {}): number | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const n = Math.round(Number(cleaned) * 100) / 100;
  if (!Number.isFinite(n) || (n < 0 && !allowNegative) || Math.abs(n) >= 1e10) return null;
  return n;
}

/** Today as YYYY-MM-DD in local time (what a date input expects). */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
