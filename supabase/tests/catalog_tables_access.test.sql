-- Who can read products, product_images, categories and stores
-- (migration 20261109_catalog_tables_signed_in_only).
--
-- Run against STAGING only. Read-only: it switches role inside the transaction
-- and changes no data. Needs the two staging test accounts
-- claude.seller@prody.local (seller) and claude.admin@prody.local (admin).
-- Every row should read passed = true.

create or replace function pg_temp.visible(p_role text, p_uid uuid, p_table text)
returns text language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '{"role":"anon"}'
         else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  execute format('select count(*) from public.%I', p_table) into n;
  reset role;
  return n::text;
exception when others then
  reset role;
  return 'error ' || sqlstate;
end $$;

with t(name) as (values ('products'), ('product_images'), ('categories'), ('stores')),
seller as (select id from public.users where email = 'claude.seller@prody.local'),
admin as (select id from public.users where email = 'claude.admin@prody.local'),
r as (
  select t.name,
    pg_temp.visible('anon', null, t.name) as anon,
    pg_temp.visible('authenticated', (select id from seller), t.name) as seller,
    pg_temp.visible('authenticated', (select id from admin), t.name) as admin,
    case t.name
      when 'products' then (select count(*) from public.products where status = 'active')
      when 'product_images' then (select count(*) from public.product_images i join public.products p on p.id = i.product_id where p.status = 'active')
      when 'categories' then (select count(*) from public.categories)
      when 'stores' then (select count(*) from public.stores)
    end as seller_expected,
    case t.name
      when 'products' then (select count(*) from public.products)
      when 'product_images' then (select count(*) from public.product_images)
      when 'categories' then (select count(*) from public.categories)
      when 'stores' then (select count(*) from public.stores)
    end as admin_expected
  from t
)
select name as test,
  anon = 'error 42501' and seller = seller_expected::text and admin = admin_expected::text as passed,
  format('anon=%s seller=%s/%s admin=%s/%s', anon, seller, seller_expected, admin, admin_expected) as detail
from r order by name;
