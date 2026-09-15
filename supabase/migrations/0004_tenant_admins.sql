-- Salon-owner identity.
--
-- Owners authenticate exactly like customers: LINE Login through the salon's own
-- LIFF app, ID token verified server-side, identity taken from the verified
-- `sub`. No second auth system, no passwords, no new dependency.
--
-- An admin is simply a (tenant_id, line_user_id) pair present in this table --
-- the same identity key customers use, for the same reason: LINE user ids are
-- Provider-scoped, so the pair is the identity, never line_user_id alone
-- (CLAUDE.md §3).

create table public.tenant_admins (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  line_user_id text not null,
  display_name text,
  created_at   timestamptz not null default now(),

  unique (tenant_id, line_user_id),
  unique (tenant_id, id)
);

create index tenant_admins_tenant_idx on public.tenant_admins (tenant_id);

alter table public.tenant_admins enable row level security;

-- Membership test used by the policies below.
--
-- SECURITY DEFINER on purpose: without it this lookup would itself be filtered
-- by tenant_admins' own RLS policy, which is the classic way an admin check
-- silently evaluates false for the very user it is meant to admit. Pinned
-- search_path so the function cannot be redirected at a different table.
--
-- Note what this does NOT do: trust a claim. There is deliberately no
-- `is_admin` claim in the minted token. A token asserting its own privilege is
-- only as good as the code that minted it; this asks the database instead, so
-- RLS is a real second opinion rather than an echo of the application.
create or replace function public.current_is_tenant_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_admins a
    where a.tenant_id = public.current_tenant_id()
      and a.line_user_id = public.current_line_user_id()
  );
$$;

-- An admin may see their own admin row, which is how the client learns it is
-- looking at an admin. Nobody sees anyone else's.
create policy tenant_admins_read_self on public.tenant_admins
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and line_user_id = public.current_line_user_id()
  );

-- THE point of this migration: an admin can read customers within their own
-- tenant, so the owner view can show who is coming. Customers still read only
-- themselves, via the existing customers_read_self policy -- permissive policies
-- are OR'd, so this widens access for admins alone.
create policy customers_read_by_tenant_admin on public.customers
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_is_tenant_admin()
  );
