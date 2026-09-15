-- Corrects make_me_admin.sql, which promoted the wrong row.
--
-- My own test scripts (verify-slots.ts, verify-supabase-tokens.ts) create
-- customer rows named 'concurrency-probe' and 'verification-probe', and those
-- were created BEFORE your real booking. "Promote the earliest customer" then
-- picked a test fixture instead of you.
--
-- Real LINE user ids always start with 'U' followed by 32 hex characters, which
-- is what distinguishes you from a probe. Safe to run more than once.

-- 1. Drop any admin that is not a real LINE account.
delete from public.tenant_admins
where tenant_id = '11111111-1111-4111-8111-111111111111'
  and line_user_id !~ '^U[0-9a-f]{32}$';

-- 2. Promote every REAL customer of the demo salon. Right now that is only you.
--    Re-running this once real customers exist would make them admins too, so
--    from here on add admins by explicit line_user_id instead.
insert into public.tenant_admins (tenant_id, line_user_id, display_name)
select c.tenant_id, c.line_user_id, c.display_name
from public.customers c
where c.tenant_id = '11111111-1111-4111-8111-111111111111'
  and c.line_user_id ~ '^U[0-9a-f]{32}$'
on conflict (tenant_id, line_user_id) do nothing;

-- 3. Clear the test fixtures so they stop polluting counts and ordering.
delete from public.bookings
where tenant_id = '11111111-1111-4111-8111-111111111111'
  and customer_id in (
    select id from public.customers
    where tenant_id = '11111111-1111-4111-8111-111111111111'
      and line_user_id !~ '^U[0-9a-f]{32}$'
  );

delete from public.customers
where tenant_id = '11111111-1111-4111-8111-111111111111'
  and line_user_id !~ '^U[0-9a-f]{32}$';

-- 4. Verify. Expect exactly one admin, with YOUR display name.
select a.display_name,
       left(a.line_user_id, 6) || '…' as line_user_id_prefix,
       case when a.line_user_id ~ '^U[0-9a-f]{32}$' then 'real LINE account' else 'NOT A REAL ACCOUNT' end as kind
from public.tenant_admins a
where a.tenant_id = '11111111-1111-4111-8111-111111111111';
