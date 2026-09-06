-- One-off: point the demo tenant at the real LINE app.
-- Paste into the Supabase SQL editor.
--
-- line_login_channel_id is the expected `aud` when verifying an ID token, read
-- per request from this row (CLAUDE.md §3). If it is wrong, every booking gets a
-- clean 401 rather than anything silent — so a wrong guess is visible, not
-- dangerous.
--
-- The numeric prefix of a LIFF ID is the LINE Login channel id, which is where
-- 2011293661 comes from. Confirm it against LINE console -> Basic settings.

update public.tenants
set liff_id              = '2011293661-YL77Id6Y',
    line_login_channel_id = '2011293661'
where slug = 'demo';

select slug, liff_id, line_login_channel_id,
       case when line_login_channel_id = 'REPLACE_ME_LOGIN_CHANNEL_ID'
            then 'STILL PLACEHOLDER' else 'OK' end as status
from public.tenants where slug = 'demo';
