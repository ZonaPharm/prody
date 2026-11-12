-- Tests for migration 20261112_user_roles. Run against STAGING only, after the
-- migration (SQL Editor). Every change runs in its own sub-transaction that is
-- rolled back, so nothing stays. Every row should read passed = true.

-- Runs p_setup, then p_probe (one value), and rolls both back.
-- Returns the probe's value as text, or 'ERR <sqlstate>' when something fails.
create or replace function pg_temp.ur_probe(p_setup text, p_probe text)
returns text language plpgsql as $$
declare v text;
begin
  execute p_setup;
  execute p_probe into v;
  raise exception 'ROLLBACK:%', coalesce(v, '<null>');
exception when others then
  if sqlerrm like 'ROLLBACK:%' then return substr(sqlerrm, 10); end if;
  return 'ERR ' || sqlstate;
end $$;

-- A seller and an admin to try things on (changes are rolled back).
create or replace function pg_temp.ur_seller() returns uuid language sql as $$
  select id from public.users where role = 'seller' and not ('driver' = any (roles)) order by created_at limit 1 $$;
create or replace function pg_temp.ur_admin() returns uuid language sql as $$
  select id from public.users where role = 'admin' order by created_at limit 1 $$;

select * from (values
  ('R1 every account has at least one role',
   not exists (select 1 from public.users where cardinality(roles) = 0)),
  ('R2 role and roles agree for everybody',
   not exists (select 1 from public.users
               where role <> case when 'admin' = any (roles) then 'admin' else 'seller' end)),
  ('R3 whoever signed for a trip is a driver',
   not exists (select 1 from public.trips t join public.users u on u.id = t.driver_id
               where not ('driver' = any (u.roles)))),
  ('R4 Офис + Шофьор: role becomes seller',
   pg_temp.ur_probe(format('update public.users set roles = %L where id = %L', '{driver,office}', pg_temp.ur_admin()),
                    format('select role || '' '' || roles::text from public.users where id = %L', pg_temp.ur_admin()))
   = 'seller {office,driver}'),
  ('R5 adding Администратор makes role admin',
   pg_temp.ur_probe(format('update public.users set roles = %L where id = %L', '{seller,admin,seller}', pg_temp.ur_seller()),
                    format('select role || '' '' || roles::text from public.users where id = %L', pg_temp.ur_seller()))
   = 'admin {admin,seller}'),
  ('R6 old code changing only role keeps the other roles',
   pg_temp.ur_probe(format('update public.users set roles = %L where id = %L; update public.users set role = %L where id = %L',
                           '{seller,driver}', pg_temp.ur_seller(), 'admin', pg_temp.ur_seller()),
                    format('select role || '' '' || roles::text from public.users where id = %L', pg_temp.ur_seller()))
   = 'admin {admin,driver}'),
  ('R7 an unknown role is refused',
   pg_temp.ur_probe(format('update public.users set roles = %L where id = %L', '{seller,boss}', pg_temp.ur_seller()),
                    'select 1') = 'ERR 23514'),
  ('R8 no roles at all is refused',
   pg_temp.ur_probe(format('update public.users set roles = %L where id = %L', '{}', pg_temp.ur_seller()),
                    'select 1') = 'ERR 23514'),
  ('R9 a new account from sign-up gets the seller role',
   pg_temp.ur_probe($q$insert into auth.users (id, email) values (gen_random_uuid(), 'roles-test@example.invalid')$q$,
                    $q$select role || ' ' || roles::text from public.users where email = 'roles-test@example.invalid'$q$)
   = 'seller {seller}'),
  ('R10 has_role: callable by signed-in users only, false without a session',
   has_function_privilege('authenticated', 'public.has_role(text)', 'EXECUTE')
   and not has_function_privilege('anon', 'public.has_role(text)', 'EXECUTE')
   and public.has_role('admin') = false),
  ('R11 the sync trigger function cannot be called by clients',
   not has_function_privilege('authenticated', 'public.users_sync_role()', 'EXECUTE')
   and not has_function_privilege('anon', 'public.users_sync_role()', 'EXECUTE')),
  ('R12 a seller can file a request only for their own store',
   (select with_check from pg_policies where schemaname = 'public' and tablename = 'stock_requests'
      and policyname = 'Sellers insert own requests') like '%store_id%'),
  ('R13 Офис reads the delivery tables, and not sales',
   (select count(*) from pg_policies where schemaname = 'public' and policyname like 'Office reads %'
      and tablename in ('deliveries', 'delivery_items', 'delivery_item_plan', 'delivery_events', 'delivery_signals',
                        'shipments', 'shipment_lines', 'trips', 'suppliers', 'products', 'product_images', 'users')) = 12
   and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sales' and policyname like 'Office%')),
  ('R14 nothing was left behind',
   not exists (select 1 from public.users where email = 'roles-test@example.invalid'))
) as t(test, passed);
