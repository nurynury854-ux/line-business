import { badRequest, readAdminRequest, serverError } from "@/lib/admin/request";
import { moveRow, nextSortOrder, savedResponse, updateRow } from "@/lib/admin/catalog";
import { LIMITS } from "@/lib/admin/limits";
import { id, optionalText, requiredText } from "@/lib/admin/validate";

/**
 * POST /api/admin/staff — the owner adds, edits, hides or reorders a stylist.
 *
 *   { action: "create", name, title? }
 *   { action: "update", id, name, title?, isActive }
 *   { action: "move",   id, direction: "up" | "down" }
 *
 * Hiding a stylist keeps every booking with them. Their upcoming bookings are
 * flagged on the owner's schedule so the owner can move each customer to
 * someone else; the overlap constraint still guards the hidden stylist's time.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function staffFields(body: Record<string, unknown>) {
  const name = requiredText(body.name, LIMITS.staffName);
  const title = optionalText(body.title, LIMITS.staffTitle);
  if (name === undefined || title === undefined) return undefined;
  return { name, title };
}

export async function POST(request: Request) {
  const parsed = await readAdminRequest(request);
  if ("response" in parsed) return parsed.response;
  const { session, body } = parsed;
  const { client } = session;

  switch (body.action) {
    case "create": {
      const fields = staffFields(body);
      if (!fields) return badRequest("Invalid stylist.");
      const { data, error } = await client
        .from("staff")
        .insert({ tenant_id: session.tenant.id, ...fields, sort_order: await nextSortOrder(client, "staff") })
        .select("id")
        .single();
      if (error) return serverError("Could not save.", error.message);
      return savedResponse(client, { id: data.id });
    }

    case "update": {
      const rowId = id(body.id);
      const fields = staffFields(body);
      if (!rowId || !fields || typeof body.isActive !== "boolean") return badRequest("Invalid stylist.");
      const failed = await updateRow(client, "staff", rowId, { ...fields, is_active: body.isActive });
      return failed ?? savedResponse(client);
    }

    case "move": {
      const rowId = id(body.id);
      if (!rowId || (body.direction !== "up" && body.direction !== "down")) return badRequest("Invalid move.");
      const failed = await moveRow(client, "staff", rowId, body.direction);
      return failed ?? savedResponse(client);
    }

    default:
      return badRequest("Unknown action.");
  }
}
