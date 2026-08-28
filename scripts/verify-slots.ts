import fs from "node:fs";
import path from "node:path";
import { demoTenant } from "@config/tenants/demo";
import { ANY_STAFF, buildDateOptions, generateSlots } from "@/lib/booking/slots";
import { weekdayOf } from "@/lib/time/taipei";
import { decideSlot } from "@/lib/booking/availability";

const NOW = new Date("2026-08-28T12:00:00+08:00");
const show = (s: { start: string; isAvailable: boolean; reason?: string }[]) =>
  s.map((x) => (x.isAvailable ? x.start : `[${x.start}:${x.reason}]`)).join(" ");

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
}

const days = buildDateOptions(demoTenant, NOW);
console.log("=== date window ===");
console.log(days.map((d) => `${d.date}(w${weekdayOf(d.date)})${d.isOpen ? "" : "-CLOSED"}`).join(" "));
check("window length is 14", days.length, 14);
check("starts today", days[0].date, "2026-08-28");
check("today flagged", days[0].isToday, true);

const monday = days.find((d) => weekdayOf(d.date) === 1)!;
check("Monday is closed (weekly day off)", monday.isOpen, false);
const holiday = days.find((d) => d.date === "2026-09-03")!;
check("2026-09-03 closed (one-off closedDates)", holiday.isOpen, false);

console.log("\n=== today, 60min cut, any staff (now=12:00, lead=60m) ===");
const today = generateSlots({ tenant: demoTenant, date: "2026-08-28", serviceId: "cut", staffId: ANY_STAFF, now: NOW });
console.log(show(today));
check("10:00 today is past", today.find((s) => s.start === "10:00")?.reason, "past");
check("12:30 blocked by lead time", today.find((s) => s.start === "12:30")?.reason, "past");
check("13:00 all three staff booked", today.find((s) => s.start === "13:00")?.reason, "booked");
// 13:30-14:30 still collides with all three (yuki runs to 15:30, lin/chen to 14:00).
check("13:30 still fully booked", today.find((s) => s.start === "13:30")?.reason, "booked");
// 14:00-15:00 is free for lin and chen even though yuki is busy -> "any" succeeds.
check("14:00 free once lin/chen finish", today.find((s) => s.start === "14:00")?.isAvailable, true);

console.log("\n=== today, 60min cut, staff=yuki only ===");
const yuki = generateSlots({ tenant: demoTenant, date: "2026-08-28", serviceId: "cut", staffId: "yuki", now: NOW });
console.log(show(yuki));
check("yuki booked 16:00", yuki.find((s) => s.start === "16:00")?.reason, "booked");
// yuki's 13:00 booking runs to 15:30, and a second starts at 16:00.
check("yuki busy 15:00 (inside 150min booking)", yuki.find((s) => s.start === "15:00")?.reason, "booked");
check("yuki free 17:00", yuki.find((s) => s.start === "17:00")?.isAvailable, true);

console.log("\n=== Thursday 2026-09-03 is closed; use next Thursday for the break test ===");
const thursday = days.find((d) => weekdayOf(d.date) === 4 && d.isOpen)!;
const thu = generateSlots({ tenant: demoTenant, date: thursday.date, serviceId: "cut", staffId: ANY_STAFF, now: NOW });
console.log(`${thursday.date}: ${show(thu)}`);
check("no 14:00 start (lunch break)", thu.some((s) => s.start === "14:00"), false);
check("13:00 exists (ends exactly at 14:00)", thu.some((s) => s.start === "13:00"), true);
check("15:00 resumes after break", thu.some((s) => s.start === "15:00"), true);

console.log("\n=== 180min perm on a Sunday (10:00-18:00) ===");
const sunday = days.find((d) => weekdayOf(d.date) === 0 && d.isOpen)!;
const perm = generateSlots({ tenant: demoTenant, date: sunday.date, serviceId: "perm", staffId: ANY_STAFF, now: NOW });
console.log(`${sunday.date}: ${show(perm)}`);
check("last perm slot is 15:00 (ends 18:00)", perm.at(-1)?.start, "15:00");
check("perm grid still steps by 30min", perm.slice(0, 3).map((s) => s.start), ["10:00", "10:30", "11:00"]);

console.log("\n=== closed day yields no slots ===");
check("Monday returns []", generateSlots({ tenant: demoTenant, date: monday.date, serviceId: "cut", staffId: ANY_STAFF, now: NOW }).length, 0);


// ===========================================================================
// PARITY — AN INDEPENDENT ORACLE FOR THE AVAILABILITY RULES.
//
// What this guards has CHANGED, so read this before acting on a failure.
//
// It used to guard client/server drift: the booking UI generated its grid with
// generateSlots, and a disagreement meant a customer could be shown a slot the
// server would refuse. That risk is gone — the UI now renders from
// GET /api/availability, so generateSlots is no longer in any production path.
//
// What it guards NOW is regression in the rules themselves. decideSlot in
// src/lib/booking/availability.ts is the single authority for production, and
// authority with no second opinion is where a quiet behaviour change lives.
// src/lib/booking/slots.ts is that second opinion: the same rules reached by a
// different route — whole-grid generation from tenant config, rather than
// single-point validation against database rows. Because nobody edits it while
// changing the server, a disagreement is evidence the SERVER moved.
//
// ON FAILURE, decideSlot is authoritative and slots.ts is the oracle:
//   - server change was INTENTIONAL  -> update slots.ts to match, keep the test
//   - server change was UNINTENTIONAL -> you have just caught a regression
// Never reconcile them by relaxing or deleting an assertion here. That converts
// a caught regression into a shipped one.
//
// AND: src/lib/booking/slots.ts is NOT dead code, despite nothing in src/
// importing it. Deleting it deletes the oracle. See the note at its head.
//
// PARITY: the client grid vs the server's single-slot decision
//
// src/lib/booking/slots.ts and src/lib/booking/availability.ts implement the
// same rules against different shapes. This walks the whole time axis of a day
// and asserts they never disagree — the guard against one drifting from the
// other when a rule changes.
// ===========================================================================
console.log("\n=== parity: client grid vs server decision ===");

function parityForDate(date: string, serviceId: string) {
  const service = demoTenant.services.find((s) => s.id === serviceId)!;
  const weekday = weekdayOf(date);
  const spans = demoTenant.businessHours[weekday].map((r) => ({
    opensAt: r.start,
    closesAt: r.end,
  }));

  const clientGrid = new Set(
    generateSlots({ tenant: demoTenant, date, serviceId, staffId: ANY_STAFF, now: NOW })
      .map((slot) => slot.start),
  );

  const disagreements: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
    const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    const decision = decideSlot({
      date, time,
      serviceDurationMinutes: service.durationMinutes,
      spansForWeekday: spans,
      isClosedDate: demoTenant.closedDates.includes(date),
      slotIntervalMinutes: demoTenant.booking.slotIntervalMinutes,
      minimumLeadTimeMinutes: demoTenant.booking.minimumLeadTimeMinutes,
      bookingWindowDays: demoTenant.booking.windowDays,
      now: NOW,
    });

    const inClientGrid = clientGrid.has(time);
    // The client omits a time entirely when the rules exclude it; the server
    // says ok, or inside_lead_time for a slot that exists but is too soon.
    const serverOffers = decision.ok || (!decision.ok && decision.reason === "inside_lead_time");

    if (inClientGrid !== serverOffers) {
      disagreements.push(
        `${time}: client ${inClientGrid ? "offers" : "omits"}, server ${
          decision.ok ? "ok" : decision.reason}`,
      );
    }
  }
  return disagreements;
}

for (const [date, serviceId, label] of [
  ["2026-08-28", "cut", "today, 60min"],
  ["2026-08-30", "perm", "Sunday, 180min (fit before close)"],
  ["2026-09-10", "cut", "Thursday, split day with lunch break"],
  ["2026-08-31", "cut", "Monday, weekly day off"],
  ["2026-09-03", "cut", "one-off closed date"],
] as const) {
  const disagreements = parityForDate(date, serviceId);
  check(`parity ${date} (${label})`, disagreements.length, 0);
  if (disagreements.length > 0) {
    console.log("      " + disagreements.slice(0, 4).join("\n      "));
  }
}

// ===========================================================================
// CONCURRENCY: 23P01 is the real guarantee, not the availability check
// ===========================================================================
async function concurrencyCase() {
  console.log("\n=== concurrency: exclusion constraint under a race ===");

  for (const raw of fs.existsSync(path.join(process.cwd(), ".env.local"))
    ? fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")
    : []) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const at = line.indexOf("=");
    const key = line.slice(0, at).trim();
    if (!(key in process.env)) {
      process.env[key] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
    }
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_JWT_SECRET) {
    console.log("SKIP  no .env.local — database checks not run");
    return;
  }

  const { mintSessionToken } = await import("@/lib/supabase/tokens");
  const { createRequestScopedClient } = await import("@/lib/supabase/client");

  const TENANT = "11111111-1111-4111-8111-111111111111";
  const STAFF = "33333333-3333-4333-8333-000000000001";
  const SERVICE = "22222222-2222-4222-8222-000000000001";
  // Far outside the booking window on purpose, so this can never collide with
  // real data. The constraint does not care about the window; the route does.
  const START = "2030-01-15T02:00:00.000Z";

  const client = createRequestScopedClient(
    await mintSessionToken(TENANT, "concurrency-probe"),
  );

  const { data: customer } = await client
    .from("customers")
    .upsert({ tenant_id: TENANT, line_user_id: "concurrency-probe" },
            { onConflict: "tenant_id,line_user_id" })
    .select("id").single();

  if (!customer) {
    console.log("FAIL  could not create probe customer");
    failures++;
    return;
  }

  const insert = () =>
    client.from("bookings").insert({
      tenant_id: TENANT, customer_id: customer.id, service_id: SERVICE,
      staff_id: STAFF, starts_at: START, duration_minutes: 60,
      price_twd: 800, status: "confirmed",
    }).select("id").single();

  // Fired together: both pass any availability check, both reach the database.
  const [first, second] = await Promise.all([insert(), insert()]);
  const results = [first, second];
  const created = results.filter((r) => r.data);
  const rejected = results.filter((r) => r.error);

  check("exactly one of two racing inserts succeeds", created.length, 1);
  check("the loser fails with SQLSTATE 23P01",
        rejected[0]?.error?.code ?? "none", "23P01");

  // Cancel rather than delete: there is no DELETE policy for authenticated, by
  // design. A cancelled booking no longer occupies the slot.
  for (const row of created) {
    if (row.data) {
      await client.from("bookings").update({ status: "cancelled" }).eq("id", row.data.id);
    }
  }
  console.log("      cleaned up: probe bookings cancelled");
}

concurrencyCase().then(() => {
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
});
