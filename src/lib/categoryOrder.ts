/** A category row loaded with `transactions(count)`. */
type Counted = { name: string; transactions?: { count: number }[] };

export const usageCount = (c: Counted) => c.transactions?.[0]?.count ?? 0;

/**
 * The one order categories appear in everywhere (Settings list, every picker):
 * most transactions first, then A–Z.
 */
export function byUse<T extends Counted>(rows: T[]): T[] {
  return [...rows].sort((a, b) => usageCount(b) - usageCount(a) || a.name.localeCompare(b.name));
}
