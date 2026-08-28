import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/**
 * SERVER ONLY (enforced by the import above).
 *
 * A Supabase client scoped to one request, authenticated by a minted token.
 *
 * The anon key is the apikey; the minted JWT is the identity. RLS therefore
 * still applies to everything this client does — it is a backstop against our
 * own bugs, since the primary defence is the verified LINE token upstream.
 *
 * There is deliberately NO service-role client in this directory. The
 * service-role key bypasses RLS entirely and must never appear in a request
 * path (CLAUDE.md §2). Migrations and seeds run through the SQL editor instead.
 *
 * The minted token never leaves the server: it is not returned in any response
 * body, header or cookie. bookings_read_own_tenant is tenant-wide rather than
 * customer-scoped on that basis, so handing one to a browser would widen read
 * access well beyond the caller's own bookings.
 */
export function createRequestScopedClient(accessToken: string): SupabaseClient {
  return createClient(serverEnv.supabaseUrl(), serverEnv.supabaseAnonKey(), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    // No session to persist or refresh: the token is request-scoped and dies
    // with it. Leaving these on would have supabase-js try to manage storage
    // that does not exist on the server.
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
