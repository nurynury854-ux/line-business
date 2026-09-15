import "server-only";

/**
 * Server-side environment access.
 *
 * Deliberately lazy functions rather than module-level constants: reading a
 * missing variable at import time would fail the Vercel BUILD, not the request,
 * which turns a configuration problem into a deploy outage.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `See .env.example. NEXT_PUBLIC_* values are inlined at build time, so ` +
        `adding one in Vercel requires a redeploy to take effect.`,
    );
  }
  return value;
}

/** For features that degrade gracefully when unconfigured. */
function optional(name: string): string | undefined {
  const value = process.env[name];
  return value ? value : undefined;
}

export const serverEnv = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseJwtSecret: () => required("SUPABASE_JWT_SECRET"),

  /**
   * SINGLE-TENANT SHORTCUT. With one Messaging API channel per salon this is
   * tenant data, exactly like line_login_channel_id — but unlike that value it
   * is a SECRET, and tenants rows are readable by every request token for that
   * tenant. So it cannot simply become a tenants column; it needs a store our
   * request path can reach but a tenant-scoped read cannot. Until that exists,
   * this env var serves the one demo tenant. Optional: absent means bookings
   * still succeed and the confirmation is skipped, never that booking fails.
   */
  lineMessagingChannelAccessToken: () =>
    optional("LINE_MESSAGING_CHANNEL_ACCESS_TOKEN"),
};

// There is deliberately no accessor for a LINE Login channel id. With one
// channel per salon it is tenant data, read from tenants.line_login_channel_id
// for the resolved tenant (CLAUDE.md §3). A global value would be wrong for
// every salon but one.
