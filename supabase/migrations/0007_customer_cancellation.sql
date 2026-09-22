-- Customers cancel their own bookings, up to a per-salon cutoff before the start.
--
-- The rule lives in the DATABASE, not only in the route. bookings_update_self
-- already lets a customer update their own rows, but a policy cannot say "only
-- the status column, only to 'cancelled', and only this far ahead" — so the
-- route calls one SECURITY DEFINER function that checks everything and returns
-- a code, in the same shape as reminders_due()/reminders_mark_sent() in 0005.
-- The route's job is to turn the code into a friendly message.
--
-- Idempotent.

-- ---------------------------------------------------------------------------
-- 1. The cutoff is tenant data, like minimum_lead_time_minutes beside it.
-- ---------------------------------------------------------------------------

alter table public.tenants
  add column if not exists cancellation_cutoff_minutes integer not null default 120
    check (cancellation_cutoff_minutes >= 0);

comment on column public.tenants.cancellation_cutoff_minutes is
  'A customer may cancel until this many minutes before starts_at. 0 means up to '
  'the start. Past the cutoff the customer is told to contact the salon; nothing '
  'is cancelled for them.';

alter table public.bookings
  add column if not exists cancelled_at timestamptz;

comment on column public.bookings.cancelled_at is
  'When the CUSTOMER cancelled through the app. NULL for a booking the salon '
  'cancelled by hand or that was never cancelled; status is the source of truth, '
  'this is the audit trail.';

-- ---------------------------------------------------------------------------
-- 2. The one write path.
-- ---------------------------------------------------------------------------

/**
 * Cancels the caller's own booking. Returns one of:
 *
 *   'cancelled'          done
 *   'not_found'          no such booking for THIS customer at THIS tenant
 *   'already_cancelled'  nothing to do
 *   'not_cancellable'    completed or no_show: history, not a future slot
 *   'past'               already started
 *   'too_late'           inside the salon's cutoff
 *
 * Identity comes from the JWT claims only. A missing claim reads as not_found,
 * never as an error, so an unauthenticated caller learns nothing about whether
 * the id exists.
 *
 * The row is locked before it is checked so two taps cannot both succeed, and
 * so a cancellation cannot race the reminder job's read of status.
 */
create or replace function public.cancel_own_booking(p_booking_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_tenant_id    uuid := public.current_tenant_id();
  v_line_user_id text := public.current_line_user_id();
  v_booking      public.bookings%rowtype;
  v_cutoff       integer;
begin
  if v_tenant_id is null or v_line_user_id is null then
    return 'not_found';
  end if;

  select b.*
    into v_booking
    from public.bookings  b
    join public.customers c
      on c.id = b.customer_id
     and c.tenant_id = b.tenant_id
   where b.id = p_booking_id
     and b.tenant_id = v_tenant_id
     and c.line_user_id = v_line_user_id
     for update of b;

  if not found then
    return 'not_found';
  end if;

  if v_booking.status = 'cancelled' then
    return 'already_cancelled';
  end if;

  if v_booking.status <> 'confirmed' then
    return 'not_cancellable';
  end if;

  if v_booking.starts_at <= now() then
    return 'past';
  end if;

  select t.cancellation_cutoff_minutes
    into v_cutoff
    from public.tenants t
   where t.id = v_tenant_id;

  if v_booking.starts_at - make_interval(mins => v_cutoff) <= now() then
    return 'too_late';
  end if;

  update public.bookings
     set status       = 'cancelled',
         cancelled_at = now()
   where id = v_booking.id;

  return 'cancelled';
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, and revoking from
-- anon alone leaves that in place — anon still executes via PUBLIC. So revoke
-- from PUBLIC and grant back only the roles the request path actually uses.
-- (The function is claim-gated regardless; this is the second lock.)
revoke execute on function public.cancel_own_booking(uuid) from public, anon;
grant  execute on function public.cancel_own_booking(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The reminder card gains a "my bookings" button, so the job needs each
--    tenant's liff_id to build the link. A function's return type cannot be
--    altered in place, hence the drop.
-- ---------------------------------------------------------------------------

drop function if exists public.reminders_due();

create or replace function public.reminders_due()
returns table (
  booking_id       uuid,
  tenant_id        uuid,
  tenant_name      text,
  tenant_brand     jsonb,
  tenant_liff_id   text,
  line_user_id     text,
  service_name     text,
  staff_name       text,
  starts_at        timestamptz,
  duration_minutes integer,
  price_twd        integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  taipei_today date := (now() at time zone 'Asia/Taipei')::date;
  window_from timestamptz := timezone('Asia/Taipei', (taipei_today + 1)::timestamp);
  window_to   timestamptz := timezone('Asia/Taipei', (taipei_today + 2)::timestamp);
begin
  if public.current_job() is distinct from 'reminders' then
    return;
  end if;

  return query
  select b.id, b.tenant_id, t.name, t.brand, t.liff_id, c.line_user_id,
         s.name, st.name, b.starts_at, b.duration_minutes, b.price_twd
    from public.bookings b
    join public.tenants   t  on t.id  = b.tenant_id
    join public.customers c  on c.id  = b.customer_id
    join public.services  s  on s.id  = b.service_id
    join public.staff     st on st.id = b.staff_id
   where b.status = 'confirmed'
     and b.reminder_sent_at is null
     and b.starts_at >= window_from
     and b.starts_at <  window_to
   order by b.starts_at;
end;
$$;

-- Same posture as cancel_own_booking above. The cron route's job token carries
-- role=authenticated, so that grant is what keeps reminders working.
revoke execute on function public.reminders_due() from public, anon;
grant  execute on function public.reminders_due() to authenticated, service_role;
