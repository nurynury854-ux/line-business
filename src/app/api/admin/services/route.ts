import { badRequest, readAdminRequest, serverError } from "@/lib/admin/request";
import { moveRow, nextSortOrder, savedResponse, updateRow } from "@/lib/admin/catalog";
import { LIMITS } from "@/lib/admin/limits";
import { durationMinutes, id, integerIn, optionalText, requiredText } from "@/lib/admin/validate";

/**
 * POST /api/admin/services — the owner adds, edits, hides or reorders a service.
 *
 *   { action: "create", name, description?, durationMinutes, priceTwd }
 *   { action: "update", id, name, description?, durationMinutes, priceTwd, isActive }
 *   { action: "move",   id, direction: "up" | "down" }
 *
 * A booking copies duration_minutes and price_twd when it is made, so editing
 * a service never changes an appointment already on the books. Hiding one
 * (isActive: false) removes it from the booking page and flags its upcoming
 * bookings for the owner; nothing is cancelled.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serviceFields(body: Record<string, unknown>) {
  const name = requiredText(body.name, LIMITS.serviceName);
  const description = optionalText(body.description, LIMITS.serviceDescription);
  const duration = durationMinutes(body.durationMinutes);
  const price = integerIn(body.priceTwd, 0, LIMITS.maxPriceTwd);
  if (name === undefined || description === undefined || duration === undefined || price === undefined) {
    return undefined;
  }
  return { name, description, duration_minutes: duration, price_twd: price };
}

export async function POST(request: Request) {
  const parsed = await readAdminRequest(request);
  if ("response" in parsed) return parsed.response;
  const { session, body } = parsed;
  const { client } = session;

  switch (body.action) {
    case "create": {
      const fields = serviceFields(body);
      if (!fields) return badRequest("Invalid service.");
      const { data, error } = await client
        .from("services")
        .insert({ tenant_id: session.tenant.id, ...fields, sort_order: await nextSortOrder(client, "services") })
        .select("id")
        .single();
      if (error) return serverError("Could not save.", error.message);
      return savedResponse(client, { id: data.id });
    }

    case "update": {
      const rowId = id(body.id);
      const fields = serviceFields(body);
      if (!rowId || !fields || typeof body.isActive !== "boolean") return badRequest("Invalid service.");
      const failed = await updateRow(client, "services", rowId, { ...fields, is_active: body.isActive });
      return failed ?? savedResponse(client);
    }

    case "move": {
      const rowId = id(body.id);
      if (!rowId || (body.direction !== "up" && body.direction !== "down")) return badRequest("Invalid move.");
      const failed = await moveRow(client, "services", rowId, body.direction);
      return failed ?? savedResponse(client);
    }

    default:
      return badRequest("Unknown action.");
  }
}
