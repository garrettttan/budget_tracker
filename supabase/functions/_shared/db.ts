// Small helpers over supabase-js query results.

type Result = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Awaits a query and throws on error, returning its data. */
export async function must<T>(query: Result): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as T;
}

/** Reads every page of a query (PostgREST returns at most 1000 rows per request). */
export async function selectAll<T>(page: (from: number, to: number) => Result): Promise<T[]> {
  const size = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const batch = await must<T[]>(page(from, from + size - 1));
    rows.push(...batch);
    if (batch.length < size) return rows;
  }
}

export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
