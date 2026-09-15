-- ONE-TIME: make yourself an admin of the demo salon.
--
-- >>> RUN THIS ONLY WHILE YOU ARE THE ONLY CUSTOMER IN THE DATABASE. <<<
-- It promotes the EARLIEST customer row, which is you right now. Once real
-- customers exist, promoting "the first customer" would hand a stranger the
-- schedule. After today, add admins by explicit line_user_id instead.

insert into public.tenant_admins (tenant_id, line_user_id, display_name)
select c.tenant_id, c.line_user_id, c.display_name
from public.customers c
where c.tenant_id = '11111111-1111-4111-8111-111111111111'
order by c.created_at asc
limit 1
on conflict (tenant_id, line_user_id) do nothing;

-- Verify: this should be YOU. If display_name is null the profile scope was off
-- when you booked; the admin still works, the name is just missing.
select a.display_name,
       left(a.line_user_id, 8) || '…' as line_user_id_prefix,
       a.created_at
from public.tenant_admins a
where a.tenant_id = '11111111-1111-4111-8111-111111111111';
