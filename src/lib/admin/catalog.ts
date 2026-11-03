import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { upcomingFlaggedBookings } from "@/lib/booking/attention";
import { serverError } from "./request";

/**
 * Shared writes for the two owner-managed lists, services and staff. Both rows
 * carry is_active and sort_order and are never deleted (0008), so add, edit,
 * hide and reorder look the same for each.
 */

export type CatalogTable = "services" | "staff";

/**
 * Every write answers with how many upcoming bookings now need attention, so
 * the settings page can warn at the moment the owner hides a stylist or adds a
 * day off — the flag on the schedule is the lasting reminder.
 */
export async function savedResponse(client: SupabaseClient, extra: Record<string, unknown> = {}) {
  try {
    const flagged = await upcomingFlaggedBookings(client, new Date());
    return NextResponse.json({ ok: true, affectedCount: flagged.length, ...extra });
  } catch (error) {
    // The write itself succeeded; only the follow-up count failed.
    return NextResponse.json({ ok: true, affectedCount: null, detail: (error as Error).message, ...extra });
  }
}

/** New rows go to the end of the list. */
export async function nextSortOrder(client: SupabaseClient, table: CatalogTable): Promise<number> {
  const { data } = await client
    .from(table)
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data?.sort_order as number | undefined) ?? 0) + 10;
}

/**
 * Moves one row a place up or down. Renumbers the whole list in steps of ten
 * rather than swapping two values, because seeded or equal sort_orders would
 * otherwise make a swap a no-op.
 */
export async function moveRow(
  client: SupabaseClient,
  table: CatalogTable,
  rowId: string,
  direction: "up" | "down",
): Promise<NextResponse | null> {
  const { data, error } = await client
    .from(table)
    .select("id, sort_order")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return serverError("Could not reorder.", error.message);

  const ids = (data ?? []).map((row) => row.id as string);
  const index = ids.indexOf(rowId);
  if (index === -1) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ids.length) return null; // already at the edge
  [ids[index], ids[target]] = [ids[target], ids[index]];

  const current = new Map((data ?? []).map((row) => [row.id as string, row.sort_order as number]));
  for (const [position, rowIdAt] of ids.entries()) {
    const sortOrder = (position + 1) * 10;
    if (current.get(rowIdAt) === sortOrder) continue;
    const { error: updateError } = await client.from(table).update({ sort_order: sortOrder }).eq("id", rowIdAt);
    if (updateError) return serverError("Could not reorder.", updateError.message);
  }
  return null;
}

/** Update one row; a 404 when RLS or a wrong id leaves nothing to update. */
export async function updateRow(
  client: SupabaseClient,
  table: CatalogTable,
  rowId: string,
  values: Record<string, unknown>,
): Promise<NextResponse | null> {
  const { data, error } = await client.from(table).update(values).eq("id", rowId).select("id");
  if (error) return serverError("Could not save.", error.message);
  if (!data || data.length === 0) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return null;
}
