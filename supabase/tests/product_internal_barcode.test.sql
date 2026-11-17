-- Tests for migration 20261112_product_internal_barcode. Run against STAGING only, after the
-- migration (SQL Editor). Every change runs in a sub-transaction that is rolled back, so no
-- product stays behind (the sequence moves on by a few numbers; a gap in the codes is fine).
-- Every row should read passed = true.

-- 'ok' when the statements run (then rolled back), the SQLSTATE when they fail.
create or replace function pg_temp.bc_try(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  raise exception 'ROLLBACK';
exception when others then
  if sqlerrm = 'ROLLBACK' then return 'ok'; end if;
  return sqlstate;
end $$;

-- Runs p_sql, returns what p_check selects (as text), then rolls everything back.
create or replace function pg_temp.bc_eval(p_sql text, p_check text)
returns text language plpgsql as $$
declare v text;
begin
  execute p_sql;
  execute p_check into v;
  raise exception 'ROLLBACK:%', coalesce(v, '<null>');
exception when others then
  if sqlerrm like 'ROLLBACK:%' then return substr(sqlerrm, 10); end if;
  return 'error ' || sqlstate || ' ' || sqlerrm;
end $$;

-- Is this a valid EAN-13 of ours (200…, right check digit)?
create or replace function pg_temp.bc_valid(p text)
returns boolean language sql as $$
  select p ~ '^200\d{10}$' and right(p, 1) = public.ean13_check_digit(left(p, 12)) $$;

select * from (values
  ('B1 check digit of a known EAN (400638133393 -> 1)',
   public.ean13_check_digit('400638133393') = '1'),
  ('B2 every product has a valid internal code',
   not exists (select 1 from public.products where internal_barcode is null or not pg_temp.bc_valid(internal_barcode))),
  ('B3 no two products share an internal code',
   (select count(*) = count(distinct internal_barcode) from public.products)),
  ('B4 a new product gets a valid code by itself',
   pg_temp.bc_eval($q$insert into public.products (name, status) values ('TEST баркод нов', 'active')$q$,
                   $q$select pg_temp.bc_valid(internal_barcode)::text from public.products where name = 'TEST баркод нов'$q$) = 'true'),
  ('B5 a code sent with the insert is ignored',
   pg_temp.bc_eval($q$insert into public.products (name, status, internal_barcode) values ('TEST баркод свой', 'active', '123')$q$,
                   $q$select (internal_barcode <> '123' and pg_temp.bc_valid(internal_barcode))::text from public.products where name = 'TEST баркод свой'$q$) = 'true'),
  ('B6 an update cannot change the code',
   pg_temp.bc_eval($q$insert into public.products (name, status) values ('TEST баркод смяна', 'active');
                      create temp table bc_before on commit drop as select internal_barcode from public.products where name = 'TEST баркод смяна';
                      update public.products set internal_barcode = '2000000000000' where name = 'TEST баркод смяна'$q$,
                   $q$select (p.internal_barcode = b.internal_barcode)::text from public.products p, bc_before b where p.name = 'TEST баркод смяна'$q$) = 'true'),
  ('B7 a blank factory barcode is stored as empty (NULL)',
   pg_temp.bc_eval($q$insert into public.products (name, status, barcode) values ('TEST баркод празен', 'active', '   ')$q$,
                   $q$select (barcode is null)::text from public.products where name = 'TEST баркод празен'$q$) = 'true'),
  ('B8 a factory barcode is trimmed',
   pg_temp.bc_eval($q$insert into public.products (name, status, barcode) values ('TEST баркод интервали', 'active', ' 3800000000001 ')$q$,
                   $q$select barcode from public.products where name = 'TEST баркод интервали'$q$) = '3800000000001'),
  ('B9 the same factory barcode on two products is refused',
   pg_temp.bc_try($q$insert into public.products (name, status, barcode) values ('TEST баркод 1', 'active', '3800000000002');
                     insert into public.products (name, status, barcode) values ('TEST баркод 2', 'active', '3800000000002')$q$) = '23505'),
  ('B10 another product''s internal code as a factory barcode is refused',
   pg_temp.bc_try(format($q$insert into public.products (name, status, barcode) values ('TEST баркод чужд', 'active', %L)$q$,
                         (select internal_barcode from public.products order by created_at limit 1))) = '23505'),
  ('B11 a product keeps its own factory barcode on an unrelated update',
   pg_temp.bc_try($q$insert into public.products (name, status, barcode) values ('TEST баркод свой 2', 'active', '3800000000003');
                     update public.products set price = 1.23 where name = 'TEST баркод свой 2'$q$) = 'ok'),
  ('B12 "Малък продукт" is off by default',
   pg_temp.bc_eval($q$insert into public.products (name, status) values ('TEST баркод малък', 'active')$q$,
                   $q$select (small_item = false)::text from public.products where name = 'TEST баркод малък'$q$) = 'true'),
  ('B13 signed-in users and anon cannot take codes or touch the sequence',
   not has_function_privilege('authenticated', 'public.next_internal_barcode()', 'EXECUTE')
   and not has_function_privilege('anon', 'public.next_internal_barcode()', 'EXECUTE')
   and not has_sequence_privilege('authenticated', 'public.product_internal_barcode_seq', 'USAGE')
   and not has_sequence_privilege('anon', 'public.product_internal_barcode_seq', 'USAGE')),
  ('B14 nothing was left behind',
   not exists (select 1 from public.products where name like 'TEST баркод%'))
) as t(test, passed);
