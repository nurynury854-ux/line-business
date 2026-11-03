import { NextResponse } from "next/server";
import { readAdminRequest, serverError } from "@/lib/admin/request";
import { calendarDateInTaipei } from "@/lib/time/taipei";

/**
 * POST /api/admin/settings — everything the owner's settings page edits.
 *
 * Unlike the tenant loader, this returns HIDDEN services and stylists too: the
 * owner needs to see them to put them back. Reads go through the admin's own
 * request-scoped client, so RLS still scopes every row to this tenant.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await readAdminRequest(request);
  if ("response" in parsed) return parsed.response;
  const { session } = parsed;
  const { client } = session;

  const now = new Date();
  const today = calendarDateInTaipei(now);

  const [services, staff, hours, closed, profile, upcoming] = await Promise.all([
    client
      .from("services")
      .select("id, name, description, duration_minutes, price_twd, is_active, sort_order")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    client
      .from("staff")
      .select("id, name, title, is_active, sort_order")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    client
      .from("business_hours")
      .select("weekday, opens_at, closes_at")
      .order("weekday", { ascending: true })
      .order("opens_at", { ascending: true }),
    // Past days off are history; the owner only manages what is ahead.
    client
      .from("closed_dates")
      .select("closed_on")
      .gte("closed_on", today)
      .order("closed_on", { ascending: true }),
    client
      .from("tenants")
      .select("address, phone, maps_url, instagram_url, website_url, cancellation_cutoff_minutes")
      .eq("id", session.tenant.id)
      .single(),
    // So the form can warn BEFORE the owner hides someone with bookings ahead.
    client
      .from("bookings")
      .select("service_id, staff_id")
      .eq("status", "confirmed")
      .gte("starts_at", now.toISOString()),
  ]);

  const failed = [services, staff, hours, closed, profile, upcoming].find((result) => result.error);
  if (failed?.error) return serverError("Could not load settings.", failed.error.message);

  const upcomingBy = (column: "service_id" | "staff_id") => {
    const counts = new Map<string, number>();
    for (const row of upcoming.data ?? []) {
      const key = row[column] as string;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const upcomingByService = upcomingBy("service_id");
  const upcomingByStaff = upcomingBy("staff_id");

  return NextResponse.json(
    {
      today,
      services: (services.data ?? []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        description: (row.description as string | null) ?? "",
        durationMinutes: row.duration_minutes as number,
        priceTwd: row.price_twd as number,
        isActive: row.is_active as boolean,
        upcomingCount: upcomingByService.get(row.id as string) ?? 0,
      })),
      staff: (staff.data ?? []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        title: (row.title as string | null) ?? "",
        isActive: row.is_active as boolean,
        upcomingCount: upcomingByStaff.get(row.id as string) ?? 0,
      })),
      // `time` columns arrive as "HH:MM:SS"; the form uses "HH:mm".
      hours: (hours.data ?? []).map((row) => ({
        weekday: Number(row.weekday),
        opensAt: String(row.opens_at).slice(0, 5),
        closesAt: String(row.closes_at).slice(0, 5),
      })),
      closedDates: (closed.data ?? []).map((row) => String(row.closed_on)),
      profile: {
        address: (profile.data?.address as string | null) ?? "",
        phone: (profile.data?.phone as string | null) ?? "",
        mapsUrl: (profile.data?.maps_url as string | null) ?? "",
        instagramUrl: (profile.data?.instagram_url as string | null) ?? "",
        websiteUrl: (profile.data?.website_url as string | null) ?? "",
        cancellationCutoffMinutes: profile.data?.cancellation_cutoff_minutes as number,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
