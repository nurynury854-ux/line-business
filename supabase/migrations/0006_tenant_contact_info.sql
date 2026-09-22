-- Salon contact details, for the 店家資訊 page.
--
-- Columns on tenants rather than a side table: there is exactly one address,
-- one phone and one map link per salon, and every one of them is optional. The
-- page renders whichever are present and omits the rest, so a salon with no
-- Instagram simply has no Instagram row (CLAUDE.md §5).
--
-- Readable through the existing tenants policies. Nothing here is secret: it is
-- what the salon prints on its door.
--
-- Idempotent.

alter table public.tenants
  add column if not exists address       text,
  add column if not exists phone         text,
  add column if not exists maps_url      text,
  add column if not exists instagram_url text,
  add column if not exists website_url   text;

comment on column public.tenants.address is
  'Street address as the salon writes it, one line. Display only.';
comment on column public.tenants.phone is
  'As dialled from a Taiwanese phone, e.g. 02-2345-6789. Rendered as a tel: link, '
  'so keep it to digits and separators.';
comment on column public.tenants.maps_url is
  'A Google Maps share link. Kept separate from address because geocoding an '
  'address is guesswork and a wrong pin sends a customer to the wrong street.';
