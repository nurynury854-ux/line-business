-- Initial schema: tenants, catalogue, availability, customers, bookings.
--
-- Conventions (CLAUDE.md §2, §3, §4):
--   * every tenant-scoped table carries tenant_id and has RLS enabled
--   * child tables expose unique (tenant_id, id) so parents can be referenced
--     with COMPOSITE foreign keys — a cross-tenant reference then fails to
--     insert rather than merely being unlikely
--   * business_hours holds Asia/Taipei WALL CLOCK times (`time`), never instants
--   * bookings hold instants (`timestamptz`, i.e. UTC), never wall clock
--
-- RLS is a backstop here, not the primary defence. The primary defence is the
-- route verifying a LINE ID token and minting a short-lived Supabase JWT whose
-- claims these policies read. That JWT is never handed to the browser.

-- Required by the bookings exclusion constraint below, which mixes an equality
-- operator (staff_id) with a range overlap operator in one GiST index. Without
-- btree_gist, `staff_id with =` has no GiST operator class and the constraint
-- fails to create.
create extension if not exists btree_gist;


-- ---------------------------------------------------------------------------
-- Claim helpers
-- ---------------------------------------------------------------------------

-- Reads tenant_id from the minted Supabase JWT. Returns null when absent, which
-- makes every policy below fail closed.
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'tenant_id', '')::uuid;
$$;

-- The LINE subject from the verified ID token. Never client-supplied: the route
-- puts it in the JWT only after verifying the token against LINE (CLAUDE.md §3).
create or replace function public.current_line_user_id()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'line_user_id', '');
$$;


-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------

create table public.tenants (
  id                        uuid primary key default gen_random_uuid(),
  slug                      text not null unique,
  name                      text not null,
  logo_url                  text,
  brand                     jsonb not null default '{}'::jsonb,

  -- Expected `aud` when verifying an ID token for this tenant. Per-tenant
  -- because the channel topology is still open (CLAUDE.md → Open decisions):
  -- one shared channel means every row holds the same value, one channel per
  -- salon means they differ. Both work without a schema change.
  line_login_channel_id     text not null,
  liff_id                   text,

  slot_interval_minutes     integer not null default 30 check (slot_interval_minutes > 0),
  minimum_lead_time_minutes integer not null default 60 check (minimum_lead_time_minutes >= 0),
  booking_window_days       integer not null default 14 check (booking_window_days between 1 and 90),

  created_at                timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------

create table public.services (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  name             text not null,
  description      text,
  duration_minutes integer not null check (duration_minutes > 0),
  -- TWD has no circulating subunit, so prices are whole dollars as integers.
  -- Integers rather than numeric: no rounding to reason about.
  price_twd        integer not null check (price_twd >= 0),
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),

  unique (tenant_id, id)
);

create index services_tenant_idx on public.services (tenant_id) where is_active;

create table public.staff (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  name       text not null,
  title      text,
  is_active  boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),

  unique (tenant_id, id)
);

create index staff_tenant_idx on public.staff (tenant_id) where is_active;


-- ---------------------------------------------------------------------------
-- Availability
-- ---------------------------------------------------------------------------

-- Opening spans per weekday, as Asia/Taipei wall clock. TWO rows for one weekday
-- expresses a mid-day break; ZERO rows expresses a recurring day off, which is
-- why there is no is_closed flag.
create table public.business_hours (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),  -- 0 = Sunday
  opens_at   time not null,
  closes_at  time not null,

  constraint business_hours_span_ordered check (closes_at > opens_at),
  unique (tenant_id, weekday, opens_at)
);

create index business_hours_lookup_idx on public.business_hours (tenant_id, weekday);

-- One-off closures only: holidays, training days. Recurring days off are the
-- absence of business_hours rows, not entries here.
create table public.closed_dates (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  closed_on date not null,
  reason    text,

  primary key (tenant_id, closed_on)
);


-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

create table public.customers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,

  -- A LINE user id is unique only within a channel/provider, so identity is the
  -- PAIR, never line_user_id alone (CLAUDE.md §3). The unique constraint below
  -- is deliberately composite for that reason.
  line_user_id  text not null,

  -- Display data copied from the LINE profile. Never an authorisation input.
  display_name  text,
  picture_url   text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (tenant_id, line_user_id),
  unique (tenant_id, id)
);


-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------

create table public.bookings (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,

  customer_id      uuid not null,
  service_id       uuid not null,
  staff_id         uuid not null,

  -- Instants, in UTC. The Asia/Taipei wall clock the customer chose is converted
  -- once, in the route, before it reaches this column (CLAUDE.md §4).
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,

  -- Snapshots, not joins: repricing a service must not rewrite what past
  -- customers were quoted and charged.
  duration_minutes integer not null check (duration_minutes > 0),
  price_twd        integer not null check (price_twd >= 0),

  status           text not null default 'confirmed',

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Composite FKs: a booking cannot reference another tenant's rows, because
  -- tenant_id has to match on both sides of every reference.
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete restrict,
  foreign key (tenant_id, service_id)  references public.services  (tenant_id, id) on delete restrict,
  foreign key (tenant_id, staff_id)    references public.staff     (tenant_id, id) on delete restrict,

  constraint bookings_status_valid
    check (status in ('confirmed', 'cancelled', 'completed', 'no_show')),

  constraint bookings_interval_ordered check (ends_at > starts_at)
);

-- Adding 'pending' later is EXPECTED. If salons want to vet bookings, extend
-- bookings_status_valid to include it and it will slot into the existing
-- machinery without redesign: the overlap constraint below already blocks every
-- status except 'cancelled', so a pending booking would hold its slot from the
-- moment it is created. Route logic must therefore not assume a freshly
-- inserted booking is already 'confirmed'.
comment on constraint bookings_status_valid on public.bookings is
  'Approval flow is anticipated: adding ''pending'' here is a supported change. '
  'The overlap constraint excludes only ''cancelled'', so pending bookings hold their slot.';

-- ends_at is derived, but NOT a generated column: `timestamptz + interval` is
-- STABLE rather than IMMUTABLE (interval arithmetic can depend on TimeZone), and
-- Postgres rejects non-immutable generation expressions. A trigger gives the
-- same guarantee — the application cannot supply an inconsistent ends_at.
create or replace function public.bookings_set_ends_at()
returns trigger
language plpgsql
as $$
begin
  new.ends_at := new.starts_at + make_interval(mins => new.duration_minutes);
  return new;
end;
$$;

-- Narrow on purpose: ends_at only needs recomputing when its inputs change.
create trigger bookings_set_ends_at_trigger
  before insert or update of starts_at, duration_minutes on public.bookings
  for each row execute function public.bookings_set_ends_at();

-- updated_at is maintained SEPARATELY, on every UPDATE. Folding it into the
-- trigger above would have left it stale for the most common write this table
-- sees: a status change. Cancelling or completing a booking touches neither
-- starts_at nor duration_minutes, so a column-scoped trigger never fires for it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- customers.updated_at had nothing maintaining it at all.
create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- THE guarantee against double-booking. The server's availability re-check
-- produces a friendly error; this makes the overwrite impossible even when two
-- requests interleave between that check and the insert. Only 'cancelled' frees
-- a slot — a completed or no-show booking genuinely occupied it.
alter table public.bookings
  add constraint bookings_no_staff_overlap
  exclude using gist (
    staff_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status <> 'cancelled');

create index bookings_tenant_start_idx on public.bookings (tenant_id, starts_at);
create index bookings_customer_idx     on public.bookings (customer_id);


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.tenants        enable row level security;
alter table public.services       enable row level security;
alter table public.staff          enable row level security;
alter table public.business_hours enable row level security;
alter table public.closed_dates   enable row level security;
alter table public.customers      enable row level security;
alter table public.bookings       enable row level security;

-- Catalogue and availability: readable within the caller's tenant. Writes are
-- administrative and go through the service role, which bypasses RLS, so no
-- write policies are granted to authenticated here.
create policy tenants_read_own on public.tenants
  for select to authenticated
  using (id = public.current_tenant_id());

create policy services_read_own_tenant on public.services
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy staff_read_own_tenant on public.staff
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy business_hours_read_own_tenant on public.business_hours
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy closed_dates_read_own_tenant on public.closed_dates
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

-- Customers: a caller sees and touches only their own row, identified by the
-- (tenant_id, line_user_id) pair carried in the verified token's claims.
create policy customers_read_self on public.customers
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and line_user_id = public.current_line_user_id()
  );

create policy customers_insert_self on public.customers
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and line_user_id = public.current_line_user_id()
  );

create policy customers_update_self on public.customers
  for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and line_user_id = public.current_line_user_id()
  )
  with check (
    tenant_id = public.current_tenant_id()
    and line_user_id = public.current_line_user_id()
  );

-- Bookings, read: tenant-wide rather than customer-only, because computing
-- availability and the least-booked stylist requires seeing every booking that
-- occupies a slot. This is not a customer-data leak: the minted JWT never
-- reaches the browser, so the only holder of these claims is our own server.
-- If that ever changes, this policy must narrow and availability must move
-- behind a SECURITY DEFINER function returning slots without customer columns.
create policy bookings_read_own_tenant on public.bookings
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

-- Bookings, write: only ever for the caller's own customer row.
create policy bookings_insert_self on public.bookings
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1
      from public.customers c
      where c.id = customer_id
        and c.tenant_id = public.current_tenant_id()
        and c.line_user_id = public.current_line_user_id()
    )
  );

create policy bookings_update_self on public.bookings
  for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1
      from public.customers c
      where c.id = customer_id
        and c.tenant_id = public.current_tenant_id()
        and c.line_user_id = public.current_line_user_id()
    )
  )
  with check (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1
      from public.customers c
      where c.id = customer_id
        and c.tenant_id = public.current_tenant_id()
        and c.line_user_id = public.current_line_user_id()
    )
  );
