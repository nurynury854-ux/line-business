-- Repairs 0001 for databases that ran it before the updated_at fix.
--
-- Symptom: `triggers (non-internal)` reports 1 instead of 3 in verify_0001.sql.
-- Cause:   the first cut of 0001 folded updated_at into the column-scoped
--          bookings_set_ends_at trigger, so a status change — the most common
--          write this table sees — never moved updated_at, and customers had no
--          updated_at trigger at all.
--
-- Fully idempotent: safe on a database that ran either version of 0001, and
-- safe to run twice.

-- Restated without the updated_at assignment. On a database that ran the first
-- version this replaces the old body; on a corrected one it is a no-op.
create or replace function public.bookings_set_ends_at()
returns trigger
language plpgsql
as $$
begin
  new.ends_at := new.starts_at + make_interval(mins => new.duration_minutes);
  return new;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Recreated rather than assumed: the column scope on the ends_at trigger is
-- load-bearing, and dropping first makes this run identically on both variants.
drop trigger if exists bookings_set_ends_at_trigger on public.bookings;
create trigger bookings_set_ends_at_trigger
  before insert or update of starts_at, duration_minutes on public.bookings
  for each row execute function public.bookings_set_ends_at();

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();
