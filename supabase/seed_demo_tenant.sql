-- Seeds the demo salon, mirroring config/tenants/demo.ts exactly.
--
-- Run in the Supabase SQL editor AFTER 0001 and 0002. Idempotent: safe to run
-- repeatedly. Fixed UUIDs so re-running updates rows rather than duplicating
-- them, and so scripts/verify-role-mapping.mjs can reference the tenant id.
--
-- >>> BEFORE RUNNING: replace REPLACE_ME_LOGIN_CHANNEL_ID below with this
-- >>> salon's LINE Login channel id. It is the expected `aud` when verifying an
-- >>> ID token, so a wrong value makes every verification fail (CLAUDE.md §3).

insert into public.tenants (
  id, slug, name, logo_url, brand,
  line_login_channel_id, liff_id,
  slot_interval_minutes, minimum_lead_time_minutes, booking_window_days
) values (
  '11111111-1111-4111-8111-111111111111',
  'demo',
  '沐光髮藝',
  '/tenants/demo/logo.svg',
  '{"primary":"#1f5f4e","onPrimary":"#ffffff","accent":"#c9a227"}'::jsonb,
  'REPLACE_ME_LOGIN_CHANNEL_ID',
  null,
  30, 60, 14
)
on conflict (id) do update set
  slug = excluded.slug,
  name = excluded.name,
  logo_url = excluded.logo_url,
  brand = excluded.brand,
  slot_interval_minutes = excluded.slot_interval_minutes,
  minimum_lead_time_minutes = excluded.minimum_lead_time_minutes,
  booking_window_days = excluded.booking_window_days;

-- Services. Upserted by id rather than deleted, because bookings reference them.
insert into public.services (id, tenant_id, name, description, duration_minutes, price_twd, sort_order) values
  ('22222222-2222-4222-8222-000000000001','11111111-1111-4111-8111-111111111111','洗剪吹','洗髮、剪髮與吹整造型',60,800,1),
  ('22222222-2222-4222-8222-000000000002','11111111-1111-4111-8111-111111111111','頭皮養護','深層清潔與頭皮按摩',45,1200,2),
  ('22222222-2222-4222-8222-000000000003','11111111-1111-4111-8111-111111111111','護髮療程','結構式深層護髮',60,1500,3),
  ('22222222-2222-4222-8222-000000000004','11111111-1111-4111-8111-111111111111','染髮','全頭染色，含護色護髮',150,3200,4),
  ('22222222-2222-4222-8222-000000000005','11111111-1111-4111-8111-111111111111','燙髮','溫塑燙或冷燙，含造型',180,4500,5)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  duration_minutes = excluded.duration_minutes,
  price_twd = excluded.price_twd,
  sort_order = excluded.sort_order;

insert into public.staff (id, tenant_id, name, title, sort_order) values
  ('33333333-3333-4333-8333-000000000001','11111111-1111-4111-8111-111111111111','小雨','總監',1),
  ('33333333-3333-4333-8333-000000000002','11111111-1111-4111-8111-111111111111','林設計師','資深設計師',2),
  ('33333333-3333-4333-8333-000000000003','11111111-1111-4111-8111-111111111111','陳設計師','設計師',3)
on conflict (id) do update set
  name = excluded.name,
  title = excluded.title,
  sort_order = excluded.sort_order;

-- Availability is replaced wholesale: nothing references these rows, and
-- delete-then-insert keeps the seed authoritative when hours change.
-- Monday (1) is absent on purpose — that IS the weekly day off.
-- Thursday (4) has two spans — that IS the lunch break.
delete from public.business_hours where tenant_id = '11111111-1111-4111-8111-111111111111';
insert into public.business_hours (tenant_id, weekday, opens_at, closes_at) values
  ('11111111-1111-4111-8111-111111111111', 0, '10:00', '18:00'),
  ('11111111-1111-4111-8111-111111111111', 2, '10:00', '20:00'),
  ('11111111-1111-4111-8111-111111111111', 3, '10:00', '20:00'),
  ('11111111-1111-4111-8111-111111111111', 4, '10:00', '14:00'),
  ('11111111-1111-4111-8111-111111111111', 4, '15:00', '20:00'),
  ('11111111-1111-4111-8111-111111111111', 5, '10:00', '20:00'),
  ('11111111-1111-4111-8111-111111111111', 6, '10:00', '18:00');

delete from public.closed_dates where tenant_id = '11111111-1111-4111-8111-111111111111';
insert into public.closed_dates (tenant_id, closed_on, reason) values
  ('11111111-1111-4111-8111-111111111111', date '2026-09-03', '員工教育訓練');

-- Seed report. Every row should read OK.
select 'tenant' as seeded, count(*)::text as actual, '1' as expected,
       case when count(*) = 1 then 'OK' else 'WRONG' end as status
  from public.tenants where id = '11111111-1111-4111-8111-111111111111'
union all
select 'services', count(*)::text, '5', case when count(*) = 5 then 'OK' else 'WRONG' end
  from public.services where tenant_id = '11111111-1111-4111-8111-111111111111'
union all
select 'staff', count(*)::text, '3', case when count(*) = 3 then 'OK' else 'WRONG' end
  from public.staff where tenant_id = '11111111-1111-4111-8111-111111111111'
union all
select 'business_hours spans', count(*)::text, '7', case when count(*) = 7 then 'OK' else 'WRONG' end
  from public.business_hours where tenant_id = '11111111-1111-4111-8111-111111111111'
union all
select 'closed_dates', count(*)::text, '1', case when count(*) = 1 then 'OK' else 'WRONG' end
  from public.closed_dates where tenant_id = '11111111-1111-4111-8111-111111111111'
union all
select 'triggers (from 0002)', count(*)::text, '3', case when count(*) = 3 then 'OK' else 'RUN 0002' end
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and not t.tgisinternal
union all
select 'login channel id set', case when line_login_channel_id = '2011293661'
                                    then 'placeholder' else 'set' end, 'set',
       case when line_login_channel_id = '2011293661' then 'STILL PLACEHOLDER' else 'OK' end
  from public.tenants where id = '11111111-1111-4111-8111-111111111111'
order by seeded;
