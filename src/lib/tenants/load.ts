import "server-only";

import type { BusinessHours, TenantConfig, Weekday } from "@config/tenants/types";
import { createRequestScopedClient } from "@/lib/supabase/client";
import { mintTenantLookupToken, mintTenantReadToken } from "@/lib/supabase/tokens";

/**
 * Loads a tenant from the DATABASE into the shape the booking UI renders from.
 *
 * This exists because the UI previously rendered from config/tenants/demo.ts
 * while both API routes read Postgres. The two disagreed on the thing that
 * matters most — primary keys. The UI offered serviceId "cut"; the database
 * holds a uuid; every availability call returned 400 "Unknown service", and
 * booking would have failed identically. Two sources of truth for one entity is
 * the bug, so the runtime now has one: this loader.
 *
 * config/tenants/demo.ts remains, but ONLY as the seed's source of truth and as
 * the oracle for scripts/verify-slots.ts. Nothing in a request path may import
 * it — if it does, the ids diverge again.
 *
 * The returned shape is deliberately TenantConfig, so buildDateOptions and
 * isSalonOpen keep working unchanged; they now read database hours, which is
 * what closes the date-picker/slot-grid divergence too.
 */

const EMPTY_HOURS: BusinessHours = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };

export type LoadedTenant = {
  tenant: TenantConfig;
  /** From tenants.liff_id — per-salon, since each salon has its own LIFF app. */
  liffId: string | null;
};

export async function loadTenantBySlug(slug: string): Promise<LoadedTenant | null> {
  const lookupClient = createRequestScopedClient(await mintTenantLookupToken(slug));

  const { data: row } = await lookupClient
    .from("tenants")
    .select(
      "id, slug, name, logo_url, brand, liff_id, slot_interval_minutes, minimum_lead_time_minutes, booking_window_days",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!row) return null;

  const client = createRequestScopedClient(await mintTenantReadToken(row.id as string));

  const [services, staff, hours, closed] = await Promise.all([
    client
      .from("services")
      .select("id, name, description, duration_minutes, price_twd")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    client
      .from("staff")
      .select("id, name, title")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    client.from("business_hours").select("weekday, opens_at, closes_at"),
    client.from("closed_dates").select("closed_on"),
  ]);

  // Rebuilt per call rather than mutating a shared constant.
  const businessHours: BusinessHours = { ...EMPTY_HOURS, 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const span of hours.data ?? []) {
    const weekday = Number(span.weekday) as Weekday;
    businessHours[weekday].push({
      // `time` columns arrive as "HH:MM:SS"; the UI and slot rules use "HH:mm".
      start: String(span.opens_at).slice(0, 5),
      end: String(span.closes_at).slice(0, 5),
    });
  }
  for (const weekday of Object.keys(businessHours) as unknown as Weekday[]) {
    businessHours[weekday].sort((a, b) => a.start.localeCompare(b.start));
  }

  const brand = (row.brand ?? {}) as Partial<TenantConfig["brand"]>;

  return {
    liffId: (row.liff_id as string | null) ?? null,
    tenant: {
      id: row.id as string,
      name: row.name as string,
      logoUrl: (row.logo_url as string | null) ?? "",
      brand: {
        primary: brand.primary ?? "#222222",
        onPrimary: brand.onPrimary ?? "#ffffff",
        accent: brand.accent ?? "#888888",
      },
      services: (services.data ?? []).map((service) => ({
        id: service.id as string,
        name: service.name as string,
        description: (service.description as string | null) ?? undefined,
        durationMinutes: service.duration_minutes as number,
        priceTwd: service.price_twd as number,
      })),
      staff: (staff.data ?? []).map((member) => ({
        id: member.id as string,
        name: member.name as string,
        title: (member.title as string | null) ?? undefined,
      })),
      businessHours,
      closedDates: (closed.data ?? []).map((entry) => String(entry.closed_on)),
      booking: {
        slotIntervalMinutes: row.slot_interval_minutes as number,
        minimumLeadTimeMinutes: row.minimum_lead_time_minutes as number,
        windowDays: row.booking_window_days as number,
      },
      // Availability comes from GET /api/availability, which reads real
      // bookings. Nothing client-side consults this.
      bookedSlots: [],
    },
  };
}
