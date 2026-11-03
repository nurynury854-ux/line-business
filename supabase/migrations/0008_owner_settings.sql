-- Salon owners edit their own salon: services and prices, stylists, weekly
-- hours, days off, contact details and the cancellation cutoff.
--
-- Every write below is gated on current_is_tenant_admin() from 0004, which asks
-- tenant_admins rather than trusting a claim. The minted token still carries no
-- `is_admin`; the route's own admin check (authenticateAdmin) exists for a clean
-- 403, and these policies are the second, independent opinion.
--
-- What owners deliberately CANNOT do:
--   * delete a service or stylist. Bookings reference both with
--     `on delete restrict`, and history must survive. Removing one means
--     is_active = false, which hides it from the booking page only.
--   * change slug, name, logo, brand, liff_id or line_login_channel_id. Those
--     are onboarding data and identity; a wrong channel id breaks every login.
--     Enforced by a column-level grant, since a policy cannot name columns.
--
-- Run AFTER 0001 through 0007. Idempotent.

-- ---------------------------------------------------------------------------
-- 1. services and staff: insert and update, never delete.
-- ---------------------------------------------------------------------------

drop policy if exists services_insert_by_tenant_admin on public.services;
create policy services_insert_by_tenant_admin on public.services
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.current_is_tenant_admin());

drop policy if exists services_update_by_tenant_admin on public.services;
create policy services_update_by_tenant_admin on public.services
  for update to authenticated
  using      (tenant_id = public.current_tenant_id() and public.current_is_tenant_admin())
  with check (tenant_id = public.current_tenant_id() and public.current_is_tenant_admin());

drop policy if exists staff_insert_by_tenant_admin on public.staff;
create policy staff_insert_by_tenant_admin on public.staff
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.current_is_tenant_admin());

drop policy if exists staff_update_by_tenant_admin on public.staff;
create policy staff_update_by_tenant_admin on public.staff
  for update to authenticated
  using      (tenant_id = public.current_tenant_id() and public.current_is_tenant_admin())
  with check (tenant_id = public.current_tenant_id() and public.current_is_tenant_admin());

-- ---------------------------------------------------------------------------
-- 2. business_hours and closed_dates: rows are replaceable; nothing references
--    them, so insert + delete is the whole write surface.
-- ---------------------------------------------------------------------------

drop policy if exists business_hours_insert_by_tenant_admin on public.business_hours;
create policy business_hours_insert_by_tenant_admin on public.business_hours
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.current_is_tenant_admin());

drop policy if exists business_hours_delete_by_tenant_admin on public.business_hours;
create policy business_hours_delete_by_tenant_admin on public.business_hours
  for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_is_tenant_admin());

drop policy if exists closed_dates_insert_by_tenant_admin on public.closed_dates;
create policy closed_dates_insert_by_tenant_admin on public.closed_dates
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.current_is_tenant_admin());

drop policy if exists closed_dates_delete_by_tenant_admin on public.closed_dates;
create policy closed_dates_delete_by_tenant_admin on public.closed_dates
  for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_is_tenant_admin());

/**
 * Replaces the caller's whole week of opening hours in one transaction, so a
 * failure half-way can never leave the salon with no hours. Returns:
 *
 *   'saved'      done
 *   'not_admin'  caller is not an admin of the tenant in their claims
 *   'invalid'    malformed input, or a span that closes before it opens
 *   'overlap'    two spans on the same weekday overlap
 *
 * p_hours is a JSON array of {"weekday": 0-6, "opens_at": "HH:MM",
 * "closes_at": "HH:MM"}, wall clock in Asia/Taipei — `time` columns hold wall
 * clock, so no timezone conversion happens here or anywhere on this path.
 *
 * SECURITY INVOKER, unlike cancel_own_booking(): the policies above already say
 * exactly who may write, so the function runs under them rather than around
 * them. The admin check up front only turns a silent zero-row delete followed
 * by an RLS error into a clean code.
 */
create or replace function public.set_business_hours(p_hours jsonb)
returns text
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_bad    boolean;
  v_overlap boolean;
begin
  if v_tenant is null or not public.current_is_tenant_admin() then
    return 'not_admin';
  end if;

  if jsonb_typeof(p_hours) is distinct from 'array' then
    return 'invalid';
  end if;

  -- Parsing casts can throw (a weekday of "x", a time of "25:00"); any such
  -- failure is bad input, not a fault.
  begin
    with spans as (
      select (e ->> 'weekday')::smallint as weekday,
             (e ->> 'opens_at')::time    as opens_at,
             (e ->> 'closes_at')::time   as closes_at
      from jsonb_array_elements(p_hours) as e
    )
    select exists (
      select 1 from spans
      where weekday is null or opens_at is null or closes_at is null
         or weekday not between 0 and 6
         or closes_at <= opens_at
    )
    into v_bad;
  exception when others then
    return 'invalid';
  end;

  if v_bad then
    return 'invalid';
  end if;

  -- Touching spans (one closes 12:00, the next opens 12:00) are fine; the slot
  -- rules treat each span separately.
  with spans as (
    select n                                  as n,
           (e ->> 'weekday')::smallint        as weekday,
           (e ->> 'opens_at')::time           as opens_at,
           (e ->> 'closes_at')::time          as closes_at
    from jsonb_array_elements(p_hours) with ordinality as t(e, n)
  )
  select exists (
    select 1
    from spans a
    join spans b
      on a.weekday = b.weekday
     and a.n < b.n
     and a.opens_at < b.closes_at
     and b.opens_at < a.closes_at
  )
  into v_overlap;

  if v_overlap then
    return 'overlap';
  end if;

  delete from public.business_hours where tenant_id = v_tenant;

  insert into public.business_hours (tenant_id, weekday, opens_at, closes_at)
  select v_tenant,
         (e ->> 'weekday')::smallint,
         (e ->> 'opens_at')::time,
         (e ->> 'closes_at')::time
  from jsonb_array_elements(p_hours) as e;

  return 'saved';
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function; revoking from anon
-- alone changes nothing (see CLAUDE.md, Schema).
revoke execute on function public.set_business_hours(jsonb) from public, anon;
grant  execute on function public.set_business_hours(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. tenants: an admin updates contact details and the cutoff, and nothing else.
-- ---------------------------------------------------------------------------

revoke update on public.tenants from anon, authenticated;
grant  update (address, phone, maps_url, instagram_url, website_url, cancellation_cutoff_minutes)
  on public.tenants to authenticated;

drop policy if exists tenants_update_by_tenant_admin on public.tenants;
create policy tenants_update_by_tenant_admin on public.tenants
  for update to authenticated
  using      (id = public.current_tenant_id() and public.current_is_tenant_admin())
  with check (id = public.current_tenant_id() and public.current_is_tenant_admin());

-- Links render as href on the info page. An owner can now write them, so the
-- database refuses anything but https — never javascript:, never data:.
alter table public.tenants drop constraint if exists tenants_maps_url_https;
alter table public.tenants add  constraint tenants_maps_url_https
  check (maps_url is null or maps_url ~ '^https://');
alter table public.tenants drop constraint if exists tenants_instagram_url_https;
alter table public.tenants add  constraint tenants_instagram_url_https
  check (instagram_url is null or instagram_url ~ '^https://');
alter table public.tenants drop constraint if exists tenants_website_url_https;
alter table public.tenants add  constraint tenants_website_url_https
  check (website_url is null or website_url ~ '^https://');

-- ---------------------------------------------------------------------------
-- 4. The slug is now a URL segment: /liff/booking/{slug}/mine and friends.
-- ---------------------------------------------------------------------------

-- Same shape the app accepts (src/lib/tenants/slug.ts), and never the name of
-- a page that sits beside it, or that page becomes unreachable for one salon.
alter table public.tenants drop constraint if exists tenants_slug_url_safe;
alter table public.tenants add  constraint tenants_slug_url_safe
  check (
    slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'
    and slug not in ('mine', 'info', 'admin', 'diagnostics', 'settings')
  );
