-- Lets a request discover which LINE Login channel to verify against, before it
-- holds a verified identity.
--
-- The bootstrap problem: the expected `aud` lives in tenants.line_login_channel_id
-- for the resolved tenant, so the tenant row must be read BEFORE the ID token can
-- be verified — but that read is itself RLS-governed, and 0001's policy requires a
-- tenant_id claim we do not have yet.
--
-- This adds a second, narrower path: a token carrying only `tenant_slug` can read
-- the ONE tenant row with that slug, and nothing else. Policies are OR'd, so this
-- widens tenants only, and a token with neither claim still sees nothing —
-- `slug = null` evaluates to NULL, which fails closed.
--
-- Idempotent.

create or replace function public.current_tenant_slug()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'tenant_slug', '');
$$;

drop policy if exists tenants_read_by_slug_claim on public.tenants;
create policy tenants_read_by_slug_claim on public.tenants
  for select to authenticated
  using (slug = public.current_tenant_slug());
