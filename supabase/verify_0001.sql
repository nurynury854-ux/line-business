-- Paste into the Supabase SQL editor. Confirms every object in
-- 0001_initial_schema.sql actually landed. Read-only.
with expected(name) as (
  values ('tenants'),('services'),('staff'),('business_hours'),
         ('closed_dates'),('customers'),('bookings')
)
select 'extension btree_gist' as check_name,
       case when exists (select 1 from pg_extension where extname = 'btree_gist')
            then 'OK' else 'MISSING' end as result,
       '1' as expected
union all
select 'tables created',
       count(*)::text,
       '7'
  from pg_tables
 where schemaname = 'public' and tablename in (select name from expected)
union all
select 'RLS enabled',
       count(*)::text,
       '7'
  from pg_tables
 where schemaname = 'public'
   and tablename in (select name from expected)
   and rowsecurity
union all
select 'policies',
       count(*)::text,
       '11'
  from pg_policies
 where schemaname = 'public'
union all
select 'overlap exclusion constraint',
       case when exists (
         select 1 from pg_constraint
          where conname = 'bookings_no_staff_overlap' and contype = 'x'
       ) then 'OK' else 'MISSING' end,
       '1'
union all
select 'triggers (non-internal)',
       count(*)::text,
       '3'
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and not t.tgisinternal
union all
select 'composite FKs on bookings',
       count(*)::text,
       '3'
  from pg_constraint
 where conrelid = 'public.bookings'::regclass
   and contype = 'f'
   and array_length(conkey, 1) = 2
union all
select 'claim helper functions',
       count(*)::text,
       '2'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('current_tenant_id', 'current_line_user_id')
order by check_name;
