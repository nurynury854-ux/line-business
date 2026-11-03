import { badRequest, readAdminRequest, serverError } from "@/lib/admin/request";
import { savedResponse } from "@/lib/admin/catalog";
import { CUTOFF_OPTIONS, LIMITS } from "@/lib/admin/limits";
import { httpsUrl, optionalText, phone } from "@/lib/admin/validate";

/**
 * POST /api/admin/profile — the salon's contact details and cancellation cutoff.
 *
 *   { address, phone, mapsUrl, instagramUrl, websiteUrl, cancellationCutoffMinutes }
 *
 * Empty strings clear a field, and the info page then simply omits it. The
 * column grant in 0008 is what keeps this to these six columns: an owner
 * cannot change the salon's name, branding, slug or LINE ids, whatever this
 * route is sent.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await readAdminRequest(request);
  if ("response" in parsed) return parsed.response;
  const { session, body } = parsed;
  const { client } = session;

  const values = {
    address: optionalText(body.address, LIMITS.address),
    phone: phone(body.phone),
    maps_url: httpsUrl(body.mapsUrl),
    instagram_url: httpsUrl(body.instagramUrl),
    website_url: httpsUrl(body.websiteUrl),
  };
  const invalid = Object.entries(values).find(([, value]) => value === undefined);
  if (invalid) return badRequest("Invalid field.", { field: invalid[0] });

  // The picker's options, or whatever the salon has now: a cutoff we set at
  // onboarding outside the list must not stop the owner saving a phone number.
  const cutoff = body.cancellationCutoffMinutes;
  const allowed = [...CUTOFF_OPTIONS, session.tenant.cancellation_cutoff_minutes] as number[];
  if (typeof cutoff !== "number" || !allowed.includes(cutoff)) {
    return badRequest("Invalid field.", { field: "cancellation_cutoff_minutes" });
  }

  const { data, error } = await client
    .from("tenants")
    .update({ ...values, cancellation_cutoff_minutes: cutoff })
    .eq("id", session.tenant.id)
    .select("id");
  if (error) return serverError("Could not save.", error.message);
  if (!data || data.length === 0) return serverError("Could not save.", "No row updated.");

  return savedResponse(client);
}
