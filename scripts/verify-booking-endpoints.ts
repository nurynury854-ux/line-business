/**
 * END-TO-END GUARD: the ids the UI renders must be the ids the API accepts.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/verify-booking-endpoints.ts
 *   BASE_URL=https://line-business.vercel.app NODE_OPTIONS=... npx tsx scripts/...
 *
 * This exists because of a bug that every other test missed. The booking page
 * rendered from tenant config (service id "cut") while the API read Postgres
 * (service id "22222222-..."), so every availability call returned 400 and no
 * booking could ever succeed. Unit tests passed, the parity suite passed, and
 * manual curl tests passed — because they all used ids copied from the seed,
 * never the ids a customer's screen actually produces.
 *
 * So: take the ids straight from the same loader the page uses, and send those.
 * Nothing here may hardcode an id.
 */
import fs from "node:fs";
import path from "node:path";

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

import { loadTenantBySlug } from "@/lib/tenants/load";
import { calendarDateInTaipei, addCalendarDays } from "@/lib/time/taipei";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const SLUG = "demo";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
}

async function main() {
  console.log(`target: ${BASE_URL}\n`);

  const loaded = await loadTenantBySlug(SLUG);
  if (!loaded) {
    console.log("FAIL  loader returned no tenant — cannot continue");
    process.exit(1);
  }

  const service = loaded.tenant.services[0];
  const member = loaded.tenant.staff[0];
  check("loader returned services and staff",
    Boolean(service && member),
    `${loaded.tenant.services.length} services, ${loaded.tenant.staff.length} staff`);
  if (!service || !member) process.exit(1);

  // The shape check that would have caught the original bug on its own.
  check("service ids the UI renders are database uuids", UUID.test(service.id), `first: ${service.id}`);
  check("staff ids the UI renders are database uuids", UUID.test(member.id), `first: ${member.id}`);
  check("liff id comes from the tenant row", Boolean(loaded.liffId), `${loaded.liffId ?? "(null — LIFF pages will show an error)"}`);

  // Pick a date the salon is actually open on, the way the UI would.
  const today = calendarDateInTaipei(new Date());
  let openDate: string | null = null;
  for (let offset = 1; offset < loaded.tenant.booking.windowDays; offset++) {
    const date = addCalendarDays(today, offset);
    const weekday = new Date(`${date}T12:00:00+08:00`).getUTCDay();
    if (loaded.tenant.businessHours[weekday as 0].length > 0 && !loaded.tenant.closedDates.includes(date)) {
      openDate = date;
      break;
    }
  }
  check("found an open date in the booking window", Boolean(openDate), openDate ?? "none");
  if (!openDate) process.exit(1);

  // THE regression test: UI ids -> availability endpoint.
  for (const staffId of [member.id, "any"]) {
    const url = `${BASE_URL}/api/availability?tenantSlug=${SLUG}&serviceId=${encodeURIComponent(service.id)}&staffId=${encodeURIComponent(staffId)}&date=${openDate}`;
    const response = await fetch(url);
    const payload = (await response.json().catch(() => ({}))) as { slots?: unknown[]; error?: string };
    check(
      `availability accepts the UI's ids (staffId=${staffId === "any" ? "any" : "specific"})`,
      response.status === 200 && Array.isArray(payload.slots),
      response.status === 200
        ? `${payload.slots?.length ?? 0} slots on ${openDate}`
        : `HTTP ${response.status} ${JSON.stringify(payload)}`,
    );
  }

  // Booking must still reject a client-supplied identity, and must get past id
  // validation to the token check rather than failing earlier on an unknown id.
  const body = {
    tenantSlug: SLUG, idToken: "not-a-real-token",
    serviceId: service.id, staffId: member.id, date: openDate, time: "14:00",
  };

  const hostile = await fetch(`${BASE_URL}/api/bookings`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, userId: "U-injected" }),
  });
  check("booking rejects a client-supplied identity field", hostile.status === 400, `HTTP ${hostile.status}`);

  const clean = await fetch(`${BASE_URL}/api/bookings`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const cleanBody = (await clean.json().catch(() => ({}))) as { error?: string };
  // 401 means it reached LINE verification -- i.e. the ids were accepted. A 400
  // here would mean the id mismatch is back.
  check(
    "booking accepts the UI's ids and reaches LINE verification",
    clean.status === 401,
    `HTTP ${clean.status} ${cleanBody.error ?? ""}`,
  );

  // Admin route: the auth ordering must hold before any data is touched.
  const adminPost = (payload: Record<string, unknown>) =>
    fetch(`${BASE_URL}/api/admin/bookings`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

  const adminPostTo = async (route: string, payload: Record<string, unknown>) =>
    (await fetch(`${BASE_URL}${route}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })).status;

  check("admin rejects a missing id token", (await adminPost({ tenantSlug: SLUG })).status === 400);
  check("admin rejects an unknown tenant",
    (await adminPost({ tenantSlug: "no-such-salon", idToken: "x" })).status === 404);
  // 401 proves verification runs BEFORE any admin lookup -- an unverified caller
  // must never reach the membership check, let alone customer rows.
  check("admin verifies the id token before checking membership",
    (await adminPost({ tenantSlug: SLUG, idToken: "not-a-real-token" })).status === 401);

  // Owner settings routes share one gate (authenticateAdmin). Each must refuse
  // in the same order before reading or writing anything: no token, unknown
  // tenant, then an unverifiable token — the write payloads are well-formed, so
  // a 2xx here would mean a write ran without a verified admin.
  for (const [route, payload] of [
    ["/api/admin/settings", {}],
    ["/api/admin/services", { action: "create", name: "probe", durationMinutes: 30, priceTwd: 0 }],
    ["/api/admin/staff", { action: "create", name: "probe" }],
    ["/api/admin/hours", { hours: [] }],
    ["/api/admin/closures", { action: "add", date: addCalendarDays(today, 30) }],
    ["/api/admin/profile", { cancellationCutoffMinutes: 120 }],
  ] as const) {
    const statuses = await Promise.all([
      adminPostTo(route, { ...payload, tenantSlug: SLUG }),
      adminPostTo(route, { ...payload, tenantSlug: "no-such-salon", idToken: "x" }),
      adminPostTo(route, { ...payload, tenantSlug: SLUG, idToken: "not-a-real-token" }),
    ]);
    check(`${route} refuses: no token 400, unknown tenant 404, bad token 401`,
      statuses.join() === "400,404,401", statuses.join(", "));
  }

  // Customer self-service routes: same ordering. Both must refuse before any row
  // is read, and cancel must refuse a non-uuid before even resolving the tenant.
  const post = (route: string, payload: Record<string, unknown>) =>
    fetch(`${BASE_URL}${route}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

  check("my-bookings rejects a missing id token", (await post("/api/bookings/mine", { tenantSlug: SLUG })).status === 400);
  check("my-bookings rejects an unknown tenant",
    (await post("/api/bookings/mine", { tenantSlug: "no-such-salon", idToken: "x" })).status === 404);
  check("my-bookings verifies the id token before reading bookings",
    (await post("/api/bookings/mine", { tenantSlug: SLUG, idToken: "not-a-real-token" })).status === 401);

  const someUuid = service.id;
  check("cancel rejects a non-uuid booking id",
    (await post("/api/bookings/cancel", { tenantSlug: SLUG, idToken: "x", bookingId: "42" })).status === 400);
  check("cancel verifies the id token before touching the booking",
    (await post("/api/bookings/cancel", { tenantSlug: SLUG, idToken: "not-a-real-token", bookingId: someUuid })).status === 401);

  // Every LIFF page renders from the same loader, under the tenant's own route
  // segment. A 200 here also proves the tenant row carries the 0006/0007
  // columns the loader selects — a missing migration turns every page under
  // /liff/booking/{slug} into a 404.
  const home = `/liff/booking/${SLUG}`;
  for (const page of [home, `${home}/mine`, `${home}/info`, `${home}/admin`, `${home}/admin/settings`]) {
    const response = await fetch(`${BASE_URL}${page}`);
    check(`${page} renders`, response.status === 200, `HTTP ${response.status}`);
  }
  for (const page of ["/liff/booking/no-such-salon", "/liff/booking/no-such-salon/mine", "/liff/booking/Not_A_Slug"]) {
    const response = await fetch(`${BASE_URL}${page}`);
    check(`${page} is a 404`, response.status === 404, `HTTP ${response.status}`);
  }

  // The demo's LIFF app may still be registered at the pre-tenancy endpoint.
  // These redirects keep it working, and must keep the query string, because
  // LIFF carries the sub-page in `liff.state`.
  for (const [from, to] of [
    ["/liff/booking?liff.state=%2Fmine", "/liff/booking/demo?liff.state=%2Fmine"],
    ["/liff/booking/mine", "/liff/booking/demo/mine"],
    ["/liff/booking/info", "/liff/booking/demo/info"],
  ] as const) {
    const response = await fetch(`${BASE_URL}${from}`, { redirect: "manual" });
    const location = response.headers.get("location") ?? "";
    check(`legacy ${from} redirects`,
      response.status === 307 && new URL(location, BASE_URL).pathname + new URL(location, BASE_URL).search === to,
      `HTTP ${response.status} -> ${location}`);
  }

  check("loader exposes the cancellation cutoff",
    Number.isInteger(loaded.tenant.booking.cancellationCutoffMinutes),
    `${loaded.tenant.booking.cancellationCutoffMinutes} minutes`);

  // The reminder cron sends real messages to real customers. An open endpoint is
  // a spam cannon, so anything other than 401/503 here is a serious regression.
  const cron = await fetch(`${BASE_URL}/api/cron/reminders`);
  check(
    "reminder cron is not publicly triggerable",
    cron.status === 401 || cron.status === 503,
    `HTTP ${cron.status} (401 = secret set and enforced, 503 = no secret configured)`,
  );

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
