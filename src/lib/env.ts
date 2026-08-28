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

export const serverEnv = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseJwtSecret: () => required("SUPABASE_JWT_SECRET"),
};

// There is deliberately no accessor for a LINE Login channel id. With one
// channel per salon it is tenant data, read from tenants.line_login_channel_id
// for the resolved tenant (CLAUDE.md §3). A global value would be wrong for
// every salon but one.
