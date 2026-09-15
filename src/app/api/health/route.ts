import { NextResponse } from "next/server";
import { createRequestScopedClient } from "@/lib/supabase/client";
import { mintTenantLookupToken } from "@/lib/supabase/tokens";

/**
 * GET /api/health — liveness plus a KEEP-WARM database touch.
 *
 * Its real job is to run one trivial query against Supabase on a schedule, so
 * the free-tier project never sits idle long enough to auto-pause. A pause is
 * what made the slot grid fail mid-booking after the project had gone unused;
 * this prevents the project reaching that state. See vercel.json for the cron.
 *
 * Deliberately cheap and safe to leave public: it mints a slug-only lookup
 * token (no secret beyond the JWT signing key the server already holds), reads
 * a single non-sensitive column, and returns no customer data. A HEAD-style
 * count still executes SQL, which is what keeps Postgres warm — an empty result
 * under RLS is fine, the query ran either way.
 *
 * Also useful by hand: curl it before a demo to confirm the database is awake
 * and reachable rather than discovering a cold start in front of a salon owner.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();

  try {
    const client = createRequestScopedClient(await mintTenantLookupToken("demo"));

    // head:true issues a count with no row body — the lightest query that still
    // reaches Postgres and therefore still counts as activity.
    const { error } = await client
      .from("tenants")
      .select("id", { count: "exact", head: true })
      .eq("slug", "demo");

    const elapsedMs = Date.now() - startedAt;

    if (error) {
      return NextResponse.json(
        { ok: false, database: "error", elapsedMs, detail: error.message },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }

    return NextResponse.json(
      { ok: true, database: "reachable", elapsedMs },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    // A paused or waking project surfaces here as a fetch failure.
    return NextResponse.json(
      {
        ok: false,
        database: "unreachable",
        elapsedMs: Date.now() - startedAt,
        detail: String(error),
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
