-- Tests for migration 20261118_product_supplier. Run against STAGING only (SQL Editor),
-- after the migration. Synthetic products 'TEST product supplier' and suppliers
-- 'TEST Доставчик …'; every scenario ends by raising 'ROLLBACK', so nothing stays.
-- Every row should read passed = true.

create or replace function pg_temp.ps_tests()
returns table(test text, passed boolean, detail text) language plpgsql as $$
declare v_s1 uuid; v_s2 uuid; v_p uuid; v_t text; v_t2 text; v_t3 text; v_t4 text; v_n int;
begin
  test := 'S0 every product with a supplier shows its name in Източник';
  select count(*) into v_n from public.products p join public.suppliers s on s.id = p.supplier_id
  where p.source is distinct from s.name;
  passed := v_n = 0;
  detail := format('mismatched=%s', v_n);
  return next;

  test := 'S1 no product whose Източник names a supplier is left without one';
  select count(*) into v_n from public.products p
  where p.supplier_id is null and public.supplier_for_name(p.source) is not null;
  passed := v_n = 0;
  detail := format('unlinked=%s', v_n);
  return next;

  test := 'S2 clients cannot call the helper functions';
  passed := not has_function_privilege('authenticated', 'public.supplier_for_name(text)', 'execute')
        and not has_function_privilege('anon', 'public.supplier_for_name(text)', 'execute')
        and not has_function_privilege('authenticated', 'public.products_sync_supplier()', 'execute');
  detail := '';
  return next;

  -- S3 insert: supplier_id writes the name; text alone finds the supplier
  -- (case, spaces); unknown text stays as typed with no supplier.
  begin
    insert into public.suppliers (name) values ('TEST Доставчик Едно') returning id into v_s1;
    insert into public.products (name, status, price, supplier_id, source)
      values ('TEST product supplier', 'inactive', 1, v_s1, 'нещо друго') returning id into v_p;
    select coalesce(source, '∅') || '|' || (supplier_id = v_s1) into v_t from public.products where id = v_p;
    insert into public.products (name, status, price, source)
      values ('TEST product supplier', 'inactive', 1, '  test   доставчик  ЕДНО ') returning id into v_p;
    select coalesce(source, '∅') || '|' || (supplier_id = v_s1) into v_t2 from public.products where id = v_p;
    insert into public.products (name, status, price, source)
      values ('TEST product supplier', 'inactive', 1, 'TEST няма такъв') returning id into v_p;
    select coalesce(source, '∅') || '|' || coalesce(supplier_id::text, '∅') into v_t3 from public.products where id = v_p;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'S3 insert: by supplier, by text, unknown text';
    if sqlerrm = 'ROLLBACK' then
      passed := v_t = 'TEST Доставчик Едно|true' and v_t2 = 'TEST Доставчик Едно|true'
                and v_t3 = 'TEST няма такъв|∅';
      detail := format('id=%s text=%s unknown=%s', v_t, v_t2, v_t3);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- S4 update: changing supplier_id rewrites the name, clearing it clears the
  -- name; old code writing only source moves the supplier; an edit of other
  -- fields leaves both alone.
  begin
    insert into public.suppliers (name) values ('TEST Доставчик Едно') returning id into v_s1;
    insert into public.suppliers (name) values ('TEST Доставчик Две') returning id into v_s2;
    insert into public.products (name, status, price, supplier_id)
      values ('TEST product supplier', 'inactive', 1, v_s1) returning id into v_p;
    update public.products set supplier_id = v_s2 where id = v_p;
    select source || '|' || (supplier_id = v_s2) into v_t from public.products where id = v_p;
    update public.products set source = 'test доставчик едно' where id = v_p;
    select source || '|' || (supplier_id = v_s1) into v_t2 from public.products where id = v_p;
    update public.products set price = 2 where id = v_p;
    select source || '|' || (supplier_id = v_s1) into v_t3 from public.products where id = v_p;
    update public.products set supplier_id = null where id = v_p;
    select coalesce(source, '∅') || '|' || coalesce(supplier_id::text, '∅') into v_t4 from public.products where id = v_p;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'S4 update: supplier, text only, other field, cleared';
    if sqlerrm = 'ROLLBACK' then
      passed := v_t = 'TEST Доставчик Две|true' and v_t2 = 'TEST Доставчик Едно|true'
                and v_t3 = 'TEST Доставчик Едно|true' and v_t4 = '∅|∅';
      detail := format('changed=%s text=%s other=%s cleared=%s', v_t, v_t2, v_t3, v_t4);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- S5 renaming a supplier renames it on its products.
  begin
    insert into public.suppliers (name) values ('TEST Доставчик Едно') returning id into v_s1;
    insert into public.products (name, status, price, supplier_id)
      values ('TEST product supplier', 'inactive', 1, v_s1) returning id into v_p;
    update public.suppliers set name = 'TEST Доставчик Преименуван' where id = v_s1;
    select source || '|' || (supplier_id = v_s1) into v_t from public.products where id = v_p;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'S5 a renamed supplier renames its products';
    if sqlerrm = 'ROLLBACK' then
      passed := v_t = 'TEST Доставчик Преименуван|true';
      detail := v_t;
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  test := 'S6 nothing left behind';
  passed := not exists (select 1 from public.products where name = 'TEST product supplier')
        and not exists (select 1 from public.suppliers where name like 'TEST Доставчик%');
  detail := '';
  return next;
end $$;

select * from pg_temp.ps_tests();
