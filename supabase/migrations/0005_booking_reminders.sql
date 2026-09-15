-- Day-before reminders.
--
-- The job needs each customer's line_user_id to push to, but customers is
-- readable only by that customer or a tenant admin — a cron is neither. Rather
-- than reach for the service-role key (forbidden in a request path, and a cron
-- handler is still a route handler), this exposes two narrow SECURITY DEFINER
-- functions gated on a `job` claim that only the cron route mints, behind
-- CRON_SECRET. RLS on the tables is untouched; nothing else gains access.
--
-- The functions return the minimum the job needs. Note what is absent:
-- display_name is never selected, because a push needs an id, not a name.

alter table public.bookings
  add column if not exists reminder_sent_at timestamptz;

comment on column public.bookings.reminder_sent_at is
  'When the day-before reminder was pushed. NULL means unsent. The job selects '
  'only NULL rows and stamps this after a successful push, so a retry, a '
  'redeploy or a double-fired cron cannot send a customer the same reminder '
  'twice -- which is worse than not sending one at all.';

-- Partial: the job only ever asks for unsent rows, and this stays small as sent
-- reminders accumulate.
create index if not exists bookings_reminder_pending_idx
  on public.bookings (starts_at)
  where reminder_sent_at is null and status = 'confirmed';

create or replace function public.current_job()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'job', '');
$$;

/**
 * Bookings starting tomorrow (Asia/Taipei) that have not been reminded yet.
 *
 * Tomorrow is computed IN Asia/Taipei, not UTC: at 19:00 Taipei the UTC date is
 * still today, so a UTC-based "tomorrow" would select the wrong day entirely
 * (CLAUDE.md §4).
 */
create or replace function public.reminders_due()
returns table (
  booking_id       uuid,
  tenant_id        uuid,
  tenant_name      text,
  tenant_brand     jsonb,
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
  -- Fails closed: without the claim this returns nothing rather than raising,
  -- so a stray caller learns only that there is nothing here for them.
  if public.current_job() is distinct from 'reminders' then
    return;
  end if;

  return query
  select b.id, b.tenant_id, t.name, t.brand, c.line_user_id,
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

/** Stamps a reminder as sent. Only ever called after LINE accepted the push. */
create or replace function public.reminders_mark_sent(p_booking_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if public.current_job() is distinct from 'reminders' then
    return false;
  end if;

  update public.bookings
     set reminder_sent_at = now()
   where id = p_booking_id
     and reminder_sent_at is null;

  return found;
end;
$$;

-- Both are claim-gated internally, so EXECUTE may be granted broadly without
-- widening access. Revoke from anon regardless: an unauthenticated caller has
-- no business reaching them at all.
revoke execute on function public.reminders_due() from anon;
revoke execute on function public.reminders_mark_sent(uuid) from anon;
