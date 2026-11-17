-- Tests for migration 20261112_product_label_kind. Run against STAGING only (SQL Editor),
-- after the migration. Synthetic products named 'TEST label kind'; every scenario ends
-- by raising 'ROLLBACK', so nothing stays. Every row should read passed = true.

create or replace function pg_temp.lk_tests()
returns table(test text, passed boolean, detail text) language plpgsql as $$
declare v_p uuid; v_t text; v_t2 text; v_t3 text; v_t4 text; v_err text; v_n int;
begin
  test := 'K0 every product has a kind that matches needs_label';
  select count(*) into v_n from public.products
  where label_kind is null or needs_label <> (label_kind = 'full');
  passed := v_n = 0;
  detail := format('mismatched=%s', v_n);
  return next;

  -- K1 a new product: from needs_label when no kind is given; the kind wins when given.
  begin
    insert into public.products (name, status, price) values ('TEST label kind', 'inactive', 1) returning id into v_p;
    select label_kind || '|' || needs_label into v_t from public.products where id = v_p;
    insert into public.products (name, status, price, needs_label) values ('TEST label kind', 'inactive', 1, false) returning id into v_p;
    select label_kind || '|' || needs_label into v_t2 from public.products where id = v_p;
    insert into public.products (name, status, price, needs_label, label_kind) values ('TEST label kind', 'inactive', 1, true, 'price') returning id into v_p;
    select label_kind || '|' || needs_label into v_t3 from public.products where id = v_p;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'K1 insert: default, from needs_label, explicit kind';
    if sqlerrm = 'ROLLBACK' then
      passed := v_t = 'full|true' and v_t2 = 'none|false' and v_t3 = 'price|false';
      detail := format('default=%s needs_label=false → %s kind=price → %s', v_t, v_t2, v_t3);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- K2 updates: the kind sets needs_label; old code writing needs_label alone maps to a
  -- kind and keeps "price"; an unknown kind is refused.
  begin
    insert into public.products (name, status, price) values ('TEST label kind', 'inactive', 1) returning id into v_p;
    update public.products set label_kind = 'price' where id = v_p;
    select label_kind || '|' || needs_label into v_t from public.products where id = v_p;
    update public.products set needs_label = false where id = v_p;
    select label_kind || '|' || needs_label into v_t2 from public.products where id = v_p;
    update public.products set needs_label = true where id = v_p;
    select label_kind || '|' || needs_label into v_t3 from public.products where id = v_p;
    update public.products set needs_label = false where id = v_p;
    select label_kind || '|' || needs_label into v_t4 from public.products where id = v_p;
    begin update public.products set label_kind = 'other' where id = v_p; exception when others then v_err := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'K2 update: kind → needs_label, needs_label → kind';
    if sqlerrm = 'ROLLBACK' then
      passed := v_t = 'price|false' and v_t2 = 'price|false' and v_t3 = 'full|true' and v_t4 = 'none|false'
                and v_err like '%products_label_kind_check%';
      detail := format('price=%s nl=false keeps=%s nl=true=%s nl=false=%s bad=%s', v_t, v_t2, v_t3, v_t4, v_err);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  test := 'K3 nothing left behind';
  passed := not exists (select 1 from public.products where name = 'TEST label kind');
  detail := '';
  return next;
end $$;

select * from pg_temp.lk_tests();
