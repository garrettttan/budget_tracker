// Request handling shared by the edge functions the browser calls
// (simplefin-claim, sync-now).
import type { SupabaseClient, User } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*', // auth is a bearer token, not cookies
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** A JSON response the browser may read. Errors are `{ error: message }`. */
export const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

/** The answer to a CORS preflight request, or null for any other request. */
export const preflight = (req: Request) => (req.method === 'OPTIONS' ? new Response(null, { headers: CORS }) : null);

/** The user whose Supabase JWT came with the request; null if it's missing or invalid. */
export async function signedInUser(admin: SupabaseClient, req: Request): Promise<User | null> {
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const { data } = await admin.auth.getUser(jwt);
  return data.user;
}
