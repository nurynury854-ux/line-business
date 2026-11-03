import "server-only";

import { NextResponse } from "next/server";
import { type AdminSession, authenticateAdmin } from "@/lib/line/customer-session";

type Authenticated = Extract<AdminSession, { ok: true }>;

/**
 * The opening every /api/admin/* route shares: parse JSON, require tenantSlug
 * and idToken, then authenticateAdmin. Returns either the session with the rest
 * of the body, or the response to send.
 *
 * POST throughout, even for reads: the ID token is a credential, and a GET
 * would put it in a URL, where it lands in access logs and browser history.
 */
export async function readAdminRequest(
  request: Request,
): Promise<{ session: Authenticated; body: Record<string, unknown> } | { response: NextResponse }> {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return { response: NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 }) };
  }

  const { tenantSlug, idToken } = body;
  if (typeof tenantSlug !== "string" || !tenantSlug) {
    return { response: NextResponse.json({ error: "tenantSlug is required." }, { status: 400 }) };
  }
  if (typeof idToken !== "string" || !idToken) {
    return { response: NextResponse.json({ error: "idToken is required." }, { status: 400 }) };
  }

  const session = await authenticateAdmin(tenantSlug, idToken);
  if (!session.ok) {
    return {
      response: NextResponse.json({ error: session.error, detail: session.detail }, { status: session.status }),
    };
  }
  return { session, body };
}

export function badRequest(error: string, detail?: unknown): NextResponse {
  return NextResponse.json({ error, detail }, { status: 400 });
}

export function serverError(error: string, detail?: unknown): NextResponse {
  return NextResponse.json({ error, detail }, { status: 500 });
}
