# CLAUDE.md

## Project

Multi-tenant LINE LIFF booking system for Taiwanese salons.

**Stack:** Next.js (App Router) · TypeScript · Tailwind CSS · Supabase (Postgres) · deployed on Vercel
**Primary users:** salon customers booking appointments inside the LINE in-app browser
**Primary language:** Traditional Chinese (zh-TW)

---

## 1. Ask before deciding — this rule outranks the others

Do not guess. If there is more than one reasonable interpretation, stop and ask.

Always ask before:

- inventing or changing a **requirement** or user flow
- designing or altering **database schema** — tables, columns, keys, constraints, RLS policies
- deciding **business logic** — booking rules, cancellation windows, overlap handling, staff availability, pricing
- adding a **dependency**, or picking a library where more than one reasonable option exists
- anything tenant-visible: copy, branding behavior, defaults

You do not need to ask about: variable naming, file placement consistent with existing patterns, formatting, or a mechanical refactor with no behavioral change.

When asking: state the options and the trade-off, give a recommendation, then wait. Do not ask and proceed anyway. Do not bury a decision inside a large diff and hope it passes review.

## 2. Multi-tenancy

Isolation model: **shared tables + Postgres Row Level Security.**

- Every tenant-scoped table has a `tenant_id` column with a foreign key to `tenants`. No exceptions.
- **RLS is the enforcement boundary, not application code.** Every tenant-scoped table has RLS enabled with explicit policies. A missing policy is a security bug, not a TODO.
- **Never use the Supabase service-role key in a request path** — route handlers, server actions, or RSC render. It bypasses RLS entirely. Service role is for migrations, seeds, and offline jobs only, and those files should be obviously separate from request code.
- The client never chooses its own tenant. Tenant is resolved server-side from the request and validated against the authenticated user before any read or write.
- New table checklist: `tenant_id` column → FK → RLS enabled → policies for select/insert/update/delete → index on `tenant_id` and on the columns you filter alongside it.

## 3. Trust boundary — LINE identity

**Never trust a `userId` sent from the client.** A LIFF client can send anything it likes.

- Every mutating request carries the LINE **ID token**. The server verifies it before the request touches the database. Verify on **every** request — there is no session cache in this design.
- Verification means checking signature, `aud` (our channel ID), `iss`, and `exp`. Never decode without verifying.
- The `sub` claim from the *verified* token is the only acceptable source of a LINE user ID. A handler that reads a user ID from the request body, a query param, or client state is a bug.
- `liff.getProfile()` output is display data only — name and avatar for the UI. It is never an authorization input.
- Treat **`(tenant_id, line_user_id)`** as the user identity key, never `line_user_id` alone. This is load-bearing, not defensive: **a LINE user ID is scoped to the Provider**, so the same physical person genuinely has a different `sub` at each salon, because each salon has its own Provider. Channels under one Provider share a user's ID; different Providers do not.
- The expected **`aud` comes from `tenants.line_login_channel_id`** for the resolved tenant, read per request — never from an env var. A global channel id is wrong for every salon but one, and checking `aud` is exactly what stops Salon A's token from being replayed against Salon B.
- **Resolve the tenant before verifying**, because its channel id is what you verify against: resolve tenant from the request → read `line_login_channel_id` → verify the token against that `aud` → take `sub`. Reject early if the tenant does not resolve. The tenant identifier arrives unverified from the client, and that is fine — it only selects which `aud` to check, and a wrong guess makes verification fail. Do not "harden" this into something that breaks it.

## 4. Time and timezone

Business timezone is **Asia/Taipei**.

- **Store UTC** in the database (`timestamptz`). Convert to Asia/Taipei only at the display boundary — the component or formatter that renders it.
- **No naive date math.** Never add hours to shift a timezone. Never build a date by slicing strings. Never rely on the process's local timezone — Vercel runs UTC, your laptop does not.
- Anything a human picked — a booking slot, a business-hours row, a day off — is a **wall-clock time in Asia/Taipei**. Convert it to UTC explicitly, at one known point, with the timezone named in the code.
- "Today", day boundaries, and week boundaries for availability and reporting are computed in Asia/Taipei. Never truncate `new Date()` on the server and call it a day boundary.
- Taiwan has no DST, so that is not the hazard here. The hazard is a UTC server silently producing off-by-eight-hours results that look plausible in testing.
- Timezone-aware date library not yet chosen — ask before adding one, and do not hand-roll it in the meantime.

## 5. Tenant values belong in config/database, never in components

Branding (name, logo, colors), service lists and prices, business hours, staff, and all tenant-facing copy come from the database or tenant config.

- No salon name, phone number, service, price, or opening hour as a literal in a component. Not even temporarily, not even as a placeholder.
- If you need sample data to build a screen, put it in a seed or fixture file that is obviously not production — not inline in JSX.
- A component that cannot render without one specific salon's data is a broken component. Build for "any tenant."
- Theming flows through Tailwind tokens and CSS variables fed by tenant config — never conditional class strings keyed on a tenant name.

## 6. Mobile-first

The design target is the **LINE in-app browser at ~375px wide, held in one hand, operated with a thumb.**

- Build the 375px layout first. Wider viewports are the enhancement, not the base case.
- **Minimum 44×44px tap targets**, with real spacing between them. This especially includes date and time-slot pickers — the most-tapped and most-cramped part of any booking flow.
- Primary actions sit within thumb reach, in the lower half of the screen. The confirm button does not go at the top.
- Account for LINE's browser chrome and iOS safe areas. Use dynamic viewport units (`dvh`), not `vh`.
- Assume mobile data and a mid-range Android device. Keep the bundle small; no heavy client library for something a server component can render.
- Verify at 375px before calling a screen done.

## 7. Internationalization

Traditional Chinese (zh-TW) is the primary UI language.

- **No hardcoded user-facing strings.** Every string goes through an i18n key from the first commit — including error messages, empty states, button labels, validation text, toasts, and `aria-label`s.
- Keys are semantic (`booking.confirm.cta`), not derived from English content (`bookNow`).
- Copy is zh-TW written for Taiwanese users — not Simplified Chinese converted, not machine-translated from English. If you need new copy and do not have it, ask. Do not invent it.
- Never concatenate translated fragments. Use interpolation with named placeholders; Chinese word order will not follow an English mental model.
- Format dates, times, and TWD currency through the locale layer, not hand-built strings.
- i18n library not yet chosen — ask before adding one.

Note: tenant-specific copy (section 5) is tenant *data*, not translation strings. A salon's own marketing copy does not go in the locale files.

---

## Open decisions — ask, do not assume

- **Date/time library** — not chosen. Timezone handling currently uses `Intl` plus an explicit `+08:00`, confined to `src/lib/time/taipei.ts`.
- **i18n library** — not chosen. Strings sit behind keys in `src/i18n/`, in a shape a real library can consume.

## Settled decisions

- **LINE channel topology: one Login channel per salon**, under a Provider in that salon's legal name. This follows LINE's policy for agency integrations, so it is not a free choice. Consequences: `liff_id` and `line_login_channel_id` are per-tenant columns and never env vars, and onboarding a salon means a new Provider, two channels, and a LIFF app.
- **A salon's Messaging API channel MUST sit under that salon's own Provider**, alongside its Login channel. User IDs are Provider-scoped, so a Messaging API channel under a different Provider cannot push to the `sub` the booking route verified — the id identifies nobody there. This is an onboarding-time constraint that is invisible until a confirmation message silently fails to arrive.
- **Pushing to a customer requires them to have added that salon's official account as a friend.** LIFF's bot link feature prompts this during login; without it, a customer can book successfully and receive nothing.
- **Tenancy: shared tables with RLS.** RLS is a backstop. The primary defence is the route verifying a LINE ID token, then minting a short-lived Supabase JWT (HS256, secret used as its UTF-8 string) whose claims the policies read. That JWT never reaches the browser.
- **Booking statuses:** `confirmed` / `cancelled` / `completed` / `no_show`. Adding `pending` later is anticipated — see the comment on the `bookings_status_valid` constraint.
- **Currency renders via the locale layer** (`$800` for TWD in zh-Hant-TW), not hand-built strings.

## Known divergences

None outstanding. The booking page loads its tenant, services, staff, hours and
closures from the database via `src/lib/tenants/load.ts`, so the UI and the API
routes share one source of truth.

**Nothing in a request path may import `config/tenants/*`.** That file is the
seed's source of truth and the oracle for `scripts/verify-slots.ts`, nothing
more. When the page rendered from it, the UI offered `serviceId: "cut"` while
the database held a uuid — every availability call returned 400 and no booking
could succeed. Unit tests, the parity suite and manual curl checks all passed
throughout, because every one of them used ids copied from the seed rather than
the ids a customer's screen produces.

`scripts/verify-booking-endpoints.ts` is the guard against that returning: it
takes ids from the same loader the page uses and sends them to the real
endpoints. Any test that hardcodes an id cannot catch this class of bug.

## Repo status

Deployed and working end to end: a customer books inside LINE, gets a Flex
confirmation in their chat, and a reminder the evening before. The salon owner
sees today's and the coming week's bookings.

### Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local dev server |
| `npm run build` | Production build — also runs ESLint and typechecks |
| `npm run lint` | ESLint alone |
| `npx tsc --noEmit` | Typecheck alone |

The verification scripts are not wired into `npm test`; there is no test runner.
Run them directly:

```
NODE_OPTIONS=--conditions=react-server npx tsx scripts/verify-slots.ts
NODE_OPTIONS=--conditions=react-server npx tsx scripts/verify-supabase-tokens.ts
NODE_OPTIONS=--conditions=react-server npx tsx scripts/verify-booking-endpoints.ts
BASE_URL=https://line-business.vercel.app NODE_OPTIONS=--conditions=react-server \
  npx tsx scripts/verify-booking-endpoints.ts     # same guards, against production
node scripts/check-env-safety.mjs                 # plain node, no flags
```

**`NODE_OPTIONS=--conditions=react-server` is required**, not optional. The
modules under test import `server-only`, whose default export throws outside a
React Server build; Next resolves it to an empty module via that export
condition, and the flag makes plain node do the same. Without it the scripts die
on import with "This module cannot be imported from a Client Component module".

`scripts/` also holds two operational tools, not tests: `set-tenant-line-ids.ts`
(writes a tenant's LIFF and channel ids from `SEED_DEMO_*`; the only code that
authenticates with the service-role key — `check-env-safety.mjs` names it too,
but only to scan for leaks) and `send-test-push.ts` (previews either Flex card;
pass `reminder` for the reminder one).

### Layout

```
config/tenants/      seed source + the oracle for verify-slots.ts. NOT a runtime import.
supabase/migrations/ numbered, applied in order by hand in the SQL editor
supabase/*.sql       one-off operational scripts, not migrations
src/app/api/         route handlers
src/app/liff/        every LIFF page — see the endpoint constraint below
src/components/      UI
src/i18n/            zh-Hant strings behind semantic keys
src/lib/booking/     slot rules: availability.ts is production, slots.ts is the oracle
src/lib/line/        ID token verification, push, Flex card builders
src/lib/supabase/    token minting and the request-scoped client
src/lib/tenants/     database-backed tenant loader the pages render from
src/lib/time/        the only module allowed to convert Taipei wall clock to instants
```

**Every LIFF page must live at or below `/liff/booking`**, because that is the
LIFF app's registered endpoint URL and `liff.init()` only runs there. A sibling
route is rejected by LINE with a bare `400 Bad Request` on every device, which is
indistinguishable from a broken deploy. This already cost a debugging session.

### Schema

Migrations `0001`–`0005`, applied in order. `0001` creates tenants, services,
staff, business_hours, closed_dates, customers and bookings; `0002` repairs
`updated_at` triggers for databases that ran an early `0001`; `0003` adds the
slug-claim policy the two-phase token needs; `0004` adds tenant_admins; `0005`
adds reminder tracking.

Two things worth knowing before changing anything here:

- **`bookings_no_staff_overlap`** is a GiST exclusion constraint, and it — not
  the application's availability check — is what makes double-booking
  impossible. The server's check exists to produce a friendly error; the
  constraint is the guarantee. `23P01` is therefore an expected outcome under
  concurrency, not a fault.
- **`reminder_sent_at`** is what stops a customer being reminded twice. Only
  null rows are selected, and stamping happens only after LINE accepts the push.

### Scheduled jobs

`vercel.json` defines two crons. `/api/health` every three days keeps the
free-tier Supabase project from auto-pausing after seven days idle — a pause
presents as the slot grid failing mid-booking. `/api/cron/reminders` daily at
11:00 UTC, which is 19:00 Asia/Taipei. Both Vercel schedules are UTC and may
drift by up to an hour.

`/api/cron/reminders` refuses to run unless `CRON_SECRET` is set and matches,
because it sends real messages to real customers.

### Still deferred

Pending/approval flow, per-staff hours, per-staff services, payments,
multi-branch — all waiting on a real salon owner asking for them. Browser access
to the admin view is also deferred: LIFF depends on browser storage that
external browsers often block, and the intended fix is a short-lived signed link
issued from the LIFF admin page, not a second auth system.

The reminder job's tenant enumeration reads every tenant through a claim-gated
function, so it scales, but `TENANT_SLUG` is still hardcoded in the two LIFF
pages. Swapping that for a route segment is the one remaining step to real
multi-tenancy.
