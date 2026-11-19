-- Tests for migration 20261117_supplier_order_plan (distribution per store already in
-- the order to the supplier).
--
-- Run against STAGING only (SQL Editor), after the migration. Synthetic products
-- named 'TEST order plan' and a supplier 'TEST order plan supplier'; every scenario
-- ends by raising 'ROLLBACK', so nothing stays. Needs an admin, the warehouse (Офис)
-- and at least two other active stores. Every row (10) should read passed = true.

create or replace function pg_temp.sp_product()
returns uuid language sql as $$
  insert into public.products (name, status, price, cost_price, quantity_on_hand)
  values ('TEST order plan', 'inactive', 10, 2, 0) returning id $$;

create or replace function pg_temp.sp_supplier()
returns uuid language sql as $$
  insert into public.suppliers (name) values ('TEST order plan supplier') returning id $$;

create or replace function pg_temp.sp_line(p_product uuid, p_qty int, p_plan jsonb default null)
returns jsonb language sql as $$
  select jsonb_build_object('product_id', p_product, 'quantity', p_qty)
         || case when p_plan is null then '{}'::jsonb else jsonb_build_object('plan', p_plan) end $$;

create or replace function pg_temp.sp_row(p_store uuid, p_qty int)
returns jsonb language sql as $$ select jsonb_build_object('store_id', p_store, 'planned_qty', p_qty) $$;

create or replace function pg_temp.sp_tests()
returns table(test text, passed boolean, detail text) language plpgsql as $$
declare
  v_admin uuid; v_wh uuid; v_s1 uuid; v_s2 uuid; v_sup uuid; v_p1 uuid; v_p2 uuid;
  v_o uuid; v_d uuid; v_j jsonb; v_j2 jsonb; v_ts timestamptz;
  v_txt text; v_txt2 text; v_err text; v_err2 text; v_err3 text; v_err4 text; v_err5 text; v_n int;
begin
  select id into v_admin from public.users where role = 'admin' order by created_at limit 1;
  select id into v_wh from public.stores where is_warehouse and is_active limit 1;
  select id into v_s1 from public.stores where not coalesce(is_warehouse, false) and is_active order by name limit 1;
  select id into v_s2 from public.stores where not coalesce(is_warehouse, false) and is_active and id <> v_s1 order by name limit 1;

  test := 'P0 fixtures: an admin, the warehouse and two stores';
  passed := v_admin is not null and v_wh is not null and v_s1 is not null and v_s2 is not null;
  detail := format('admin=%s warehouse=%s stores=%s,%s', v_admin, v_wh, v_s1, v_s2); return next;

  -- P1 a draft with a plan: rows kept (0 dropped); a second save replaces them.
  begin
    v_sup := pg_temp.sp_supplier(); v_p1 := pg_temp.sp_product(); v_p2 := pg_temp.sp_product();
    v_j := public.save_supplier_order(null, v_admin, null, jsonb_build_object('supplier_id', v_sup,
      'items', jsonb_build_array(
        pg_temp.sp_line(v_p1, 10, jsonb_build_array(pg_temp.sp_row(v_s1, 3), pg_temp.sp_row(v_s2, 0))),
        pg_temp.sp_line(v_p2, 5))));
    v_o := (v_j ->> 'id')::uuid;
    select string_agg((product_id = v_p1)::text || ':' || (store_id = v_s1)::text || ':' || planned_qty, ',')
      into v_txt from public.supplier_order_plan where order_id = v_o;
    v_j2 := public.save_supplier_order(v_o, v_admin, (v_j ->> 'updated_at')::timestamptz, jsonb_build_object('supplier_id', v_sup,
      'items', jsonb_build_array(
        pg_temp.sp_line(v_p1, 10, jsonb_build_array(pg_temp.sp_row(v_s2, 4))),
        pg_temp.sp_line(v_p2, 5, jsonb_build_array(pg_temp.sp_row(v_s1, 5))))));
    select string_agg((product_id = v_p1)::text || ':' || (store_id = v_s1)::text || ':' || planned_qty, ',' order by planned_qty)
      into v_txt2 from public.supplier_order_plan where order_id = v_o;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'P1 save_supplier_order keeps the plan, drops 0 rows, replaces on save';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = 'true:true:3' and v_txt2 = 'true:false:4,false:true:5';
      detail := format('first=%s second=%s', v_txt, v_txt2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- P2 refused plans: the warehouse, a store twice, more than the line, a fraction, an unknown store.
  begin
    v_sup := pg_temp.sp_supplier(); v_p1 := pg_temp.sp_product();
    begin
      perform public.save_supplier_order(null, v_admin, null, jsonb_build_object('supplier_id', v_sup,
        'items', jsonb_build_array(pg_temp.sp_line(v_p1, 10, jsonb_build_array(pg_temp.sp_row(v_wh, 2))))));
      v_err := 'saved';
    exception when others then v_err := sqlerrm; end;
    begin
      perform public.save_supplier_order(null, v_admin, null, jsonb_build_object('supplier_id', v_sup,
        'items', jsonb_build_array(pg_temp.sp_line(v_p1, 10, jsonb_build_array(pg_temp.sp_row(v_s1, 2), pg_temp.sp_row(v_s1, 1))))));
      v_err2 := 'saved';
    exception when others then v_err2 := sqlerrm; end;
    begin
      perform public.save_supplier_order(null, v_admin, null, jsonb_build_object('supplier_id', v_sup,
        'items', jsonb_build_array(pg_temp.sp_line(v_p1, 10, jsonb_build_array(pg_temp.sp_row(v_s1, 6), pg_temp.sp_row(v_s2, 5))))));
      v_err3 := 'saved';
    exception when others then v_err3 := sqlerrm; end;
    begin
      perform public.save_supplier_order(null, v_admin, null, jsonb_build_object('supplier_id', v_sup,
        'items', jsonb_build_array(pg_temp.sp_line(v_p1, 10, jsonb_build_array(jsonb_build_object('store_id', v_s1, 'planned_qty', 1.5))))));
      v_err4 := 'saved';
    exception when others then v_err4 := sqlerrm; end;
    begin
      perform public.save_supplier_order(null, v_admin, null, jsonb_build_object('supplier_id', v_sup,
        'items', jsonb_build_array(pg_temp.sp_line(v_p1, 10, jsonb_build_array(pg_temp.sp_row(gen_random_uuid(), 1))))));
      v_err5 := 'saved';
    exception when others then v_err5 := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'P2 warehouse, repeated store, over the line, fraction and unknown store are refused';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like '%не може да е в разпределението%'
                and v_err2 like 'Магазин се повтаря%'
                and v_err3 like '%разпределени са 11 бр., а се поръчват 10'
                and v_err4 like 'Всеки магазин в разпределението%'
                and v_err5 = 'Магазин от разпределението не е намерен';
      detail := format('wh=%s dup=%s over=%s frac=%s unknown=%s', v_err, v_err2, v_err3, v_err4, v_err5);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- P3 save_supplier_order_plan on a SENT order: only the listed line changes; stale,
  -- foreign product and over-plan are refused; updated_at moves.
  begin
    v_sup := pg_temp.sp_supplier(); v_p1 := pg_temp.sp_product(); v_p2 := pg_temp.sp_product();
    v_j := public.save_supplier_order(null, v_admin, null, jsonb_build_object('supplier_id', v_sup,
      'items', jsonb_build_array(
        pg_temp.sp_line(v_p1, 10, jsonb_build_array(pg_temp.sp_row(v_s1, 3))),
        pg_temp.sp_line(v_p2, 6, jsonb_build_array(pg_temp.sp_row(v_s2, 2))))));
    v_o := (v_j ->> 'id')::uuid;
    perform public.send_supplier_order(v_o, v_admin, 'manual', null);
    select updated_at into v_ts from public.supplier_orders where id = v_o;
    v_j2 := public.save_supplier_order_plan(v_o, v_admin, v_ts, jsonb_build_array(
      jsonb_build_object('product_id', v_p1, 'plan', jsonb_build_array(pg_temp.sp_row(v_s1, 4), pg_temp.sp_row(v_s2, 6)))));
    select string_agg((product_id = v_p1)::text || ':' || (store_id = v_s1)::text || ':' || planned_qty, ',' order by product_id = v_p1, planned_qty)
      into v_txt from public.supplier_order_plan where order_id = v_o;
    v_txt2 := ((v_j2 ->> 'updated_at')::timestamptz >= v_ts)::text || '|' || (select status from public.supplier_orders where id = v_o);
    begin
      perform public.save_supplier_order_plan(v_o, v_admin, '2000-01-01'::timestamptz, jsonb_build_array(
        jsonb_build_object('product_id', v_p1, 'plan', '[]'::jsonb)));
      v_err := 'saved';
    exception when others then v_err := sqlerrm; end;
    begin
      perform public.save_supplier_order_plan(v_o, v_admin, null, jsonb_build_array(
        jsonb_build_object('product_id', pg_temp.sp_product(), 'plan', '[]'::jsonb)));
      v_err2 := 'saved';
    exception when others then v_err2 := sqlerrm; end;
    begin
      perform public.save_supplier_order_plan(v_o, v_admin, null, jsonb_build_array(
        jsonb_build_object('product_id', v_p2, 'plan', jsonb_build_array(pg_temp.sp_row(v_s1, 7)))));
      v_err3 := 'saved';
    exception when others then v_err3 := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'P3 save_supplier_order_plan changes a sent order''s plan line by line';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = 'false:false:2,true:true:4,true:false:6' and v_txt2 = 'true|sent'
                and v_err like 'Поръчката е променена от друг човек%'
                and v_err2 = 'Продуктът не е в тази поръчка'
                and v_err3 like '%разпределени са 7 бр., а се поръчват 6';
      detail := format('plan=%s after=%s stale=%s foreign=%s over=%s', v_txt, v_txt2, v_err, v_err2, v_err3);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- P4 "Пристигна": the draft delivery gets the plan; afterwards the order's plan is closed.
  begin
    v_sup := pg_temp.sp_supplier(); v_p1 := pg_temp.sp_product(); v_p2 := pg_temp.sp_product();
    v_j := public.save_supplier_order(null, v_admin, null, jsonb_build_object('supplier_id', v_sup,
      'items', jsonb_build_array(
        pg_temp.sp_line(v_p1, 10, jsonb_build_array(pg_temp.sp_row(v_s1, 3), pg_temp.sp_row(v_s2, 4))),
        pg_temp.sp_line(v_p2, 6))));
    v_o := (v_j ->> 'id')::uuid;
    perform public.send_supplier_order(v_o, v_admin, 'manual', null);
    v_d := (public.supplier_order_to_delivery(v_o, v_admin) ->> 'delivery_id')::uuid;
    select string_agg((di.product_id = v_p1)::text || ':' || di.quantity || ':' ||
                      coalesce((select string_agg((p.store_id = v_s1)::text || '=' || p.planned_qty || '/' || p.ready_qty, ';' order by p.planned_qty)
                                from public.delivery_item_plan p where p.delivery_item_id = di.id), '-'),
                      ',' order by di.sort_order)
      into v_txt from public.delivery_items di where di.delivery_id = v_d;
    select status into v_txt2 from public.deliveries where id = v_d;
    begin
      perform public.save_supplier_order_plan(v_o, v_admin, null, jsonb_build_array(
        jsonb_build_object('product_id', v_p1, 'plan', '[]'::jsonb)));
      v_err := 'saved';
    exception when others then v_err := sqlerrm; end;
    select count(*) into v_n from public.stock_batches where product_id in (v_p1, v_p2);
    raise exception 'ROLLBACK';
  exception when others then
    test := 'P4 Пристигна copies the plan into the draft delivery; then the order plan is closed';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = 'true:10:true=3/0;false=4/0,false:6:-' and v_txt2 = 'draft'
                and v_err = 'Стоката вече пристигна: сменете разпределението в доставката'
                and v_n = 0;
      detail := format('lines=%s status=%s after=%s batches=%s', v_txt, v_txt2, v_err, v_n);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- P5 an old caller without "plan" still saves (no plan rows), and so does an empty plan.
  begin
    v_sup := pg_temp.sp_supplier(); v_p1 := pg_temp.sp_product(); v_p2 := pg_temp.sp_product();
    v_j := public.save_supplier_order(null, v_admin, null, jsonb_build_object('supplier_id', v_sup,
      'items', jsonb_build_array(pg_temp.sp_line(v_p1, 2), pg_temp.sp_line(v_p2, 3, '[]'::jsonb))));
    v_o := (v_j ->> 'id')::uuid;
    select count(*) into v_n from public.supplier_order_plan where order_id = v_o;
    select count(*)::text into v_txt from public.supplier_order_items where order_id = v_o;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'P5 lines without a plan are saved as before';
    if sqlerrm = 'ROLLBACK' then
      passed := v_n = 0 and v_txt = '2';
      detail := format('plan rows=%s lines=%s', v_n, v_txt);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- P6 deleting a draft order takes its plan with it.
  begin
    v_sup := pg_temp.sp_supplier(); v_p1 := pg_temp.sp_product();
    v_j := public.save_supplier_order(null, v_admin, null, jsonb_build_object('supplier_id', v_sup,
      'items', jsonb_build_array(pg_temp.sp_line(v_p1, 2, jsonb_build_array(pg_temp.sp_row(v_s1, 1))))));
    v_o := (v_j ->> 'id')::uuid;
    delete from public.supplier_orders where id = v_o;
    select count(*) into v_n from public.supplier_order_plan where order_id = v_o;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'P6 a deleted draft leaves no plan behind';
    if sqlerrm = 'ROLLBACK' then
      passed := v_n = 0; detail := format('plan rows=%s', v_n);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- P6b share_plan: off by default; set on save; the plan call keeps it on null and
  -- changes it alone with an empty list.
  begin
    v_sup := pg_temp.sp_supplier(); v_p1 := pg_temp.sp_product();
    v_j := public.save_supplier_order(null, v_admin, null, jsonb_build_object('supplier_id', v_sup,
      'items', jsonb_build_array(pg_temp.sp_line(v_p1, 2))));
    v_o := (v_j ->> 'id')::uuid;
    select share_plan::text into v_txt from public.supplier_orders where id = v_o;
    v_j := public.save_supplier_order(v_o, v_admin, null, jsonb_build_object('supplier_id', v_sup, 'share_plan', true,
      'items', jsonb_build_array(pg_temp.sp_line(v_p1, 2))));
    select v_txt || '|' || share_plan into v_txt from public.supplier_orders where id = v_o;
    perform public.send_supplier_order(v_o, v_admin, 'manual', null);
    v_j2 := public.save_supplier_order_plan(v_o, v_admin, null, jsonb_build_array(
      jsonb_build_object('product_id', v_p1, 'plan', jsonb_build_array(pg_temp.sp_row(v_s1, 1)))));
    select v_txt || '|' || share_plan || '|' || (v_j2 ->> 'share_plan') into v_txt from public.supplier_orders where id = v_o;
    v_j2 := public.save_supplier_order_plan(v_o, v_admin, null, '[]'::jsonb, false);
    select v_txt || '|' || share_plan || '|' || (select count(*) from public.supplier_order_plan where order_id = v_o)
      into v_txt from public.supplier_orders where id = v_o;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'P6b share_plan: default off, saved with the order, changed alone after sending';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = 'false|true|true|true|false|1';
      detail := v_txt;
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  test := 'P7 only service_role may execute; RLS on; anon cannot read';
  passed := not has_function_privilege('anon', 'public.save_supplier_order_plan(uuid, uuid, timestamptz, jsonb, boolean)', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.save_supplier_order_plan(uuid, uuid, timestamptz, jsonb, boolean)', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.supplier_order_plan_problem(jsonb)', 'EXECUTE')
            and not has_function_privilege('anon', 'public.supplier_order_plan_problem(jsonb)', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.save_supplier_order(uuid, uuid, timestamptz, jsonb)', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.supplier_order_to_delivery(uuid, uuid)', 'EXECUTE')
            and has_function_privilege('service_role', 'public.save_supplier_order_plan(uuid, uuid, timestamptz, jsonb, boolean)', 'EXECUTE')
            and has_function_privilege('service_role', 'public.supplier_order_to_delivery(uuid, uuid)', 'EXECUTE')
            and (select relrowsecurity from pg_class where oid = 'public.supplier_order_plan'::regclass)
            and not has_table_privilege('anon', 'public.supplier_order_plan', 'SELECT')
            and not has_table_privilege('authenticated', 'public.supplier_order_plan', 'INSERT');
  detail := 'EXECUTE only for service_role; supplier_order_plan RLS on'; return next;

  test := 'P8 nothing left behind';
  passed := not exists (select 1 from public.products where name = 'TEST order plan')
            and not exists (select 1 from public.suppliers where name = 'TEST order plan supplier');
  detail := 'no TEST products or suppliers remain'; return next;
end $$;

select * from pg_temp.sp_tests();
