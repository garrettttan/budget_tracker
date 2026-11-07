import { createClient, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';

// Both values are safe to ship in the browser: the publishable key only grants
// what row-level security allows, and every table is scoped to the signed-in user.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const isConfigured = Boolean(url && key);

/** The client, or null when the build has no Supabase settings (see pages/NotConfigured). */
export const supabase: SupabaseClient | null = isConfigured
  ? createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

/** The client, for code that only runs once signed in (so it's configured). */
export function db(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

/** An edge function's own error message (it's in the response body), else the generic one. */
export async function functionErrorMessage(error: Error): Promise<string> {
  const body = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
  return body?.error ?? error.message;
}

/** The bank connection, as the browser may read it. */
export type Connection = { id: string; label: string; status: string; status_message: string | null; last_synced_at: string | null };

/** Always these columns, never `*`: the Vault pointer column isn't readable from the browser. */
export const CONNECTION_COLUMNS = 'id, label, status, status_message, last_synced_at';
