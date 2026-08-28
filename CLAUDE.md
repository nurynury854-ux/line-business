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
- Treat **`(tenant_id, line_user_id)`** as the user identity key, never `line_user_id` alone. This is load-bearing, not defensive: with one Login channel per salon, the same physical person genuinely has a different `sub` at each salon, because LINE user IDs are unique only within a channel.
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
- **Tenancy: shared tables with RLS.** RLS is a backstop. The primary defence is the route verifying a LINE ID token, then minting a short-lived Supabase JWT (HS256, secret used as its UTF-8 string) whose claims the policies read. That JWT never reaches the browser.
- **Booking statuses:** `confirmed` / `cancelled` / `completed` / `no_show`. Adding `pending` later is anticipated — see the comment on the `bookings_status_valid` constraint.
- **Currency renders via the locale layer** (`$800` for TWD in zh-Hant-TW), not hand-built strings.

## Repo status

The repository is currently empty; the app has not been scaffolded yet. Build, test, and deploy commands, directory conventions, and schema notes should be added to this file once they actually exist — do not infer or invent them.
