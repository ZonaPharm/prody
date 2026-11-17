-- Tests for migration 20261117_cancel_delivery_from_stores (cancel_delivery takes the
-- delivery's units back from the stores too; cancel_delivery_preview).
--
-- Run against STAGING only (SQL Editor or psql on ruhhsixmqusnpiajkbxe), after the
-- migration. Self-contained like the other delivery tests: synthetic products named
-- 'TEST deliveries', every scenario ends by raising 'ROLLBACK', so nothing stays.
-- Every row should read passed = true.

-- A saved delivery of p_product (a new one when null): 20 units at cost 2, plan 6 for
-- store A and 4 for store B, all received into Офис and labelled for A.
-- Returns {delivery, item, product}.
create or replace function pg_temp.cd_delivery(p_admin uuid, p_sa uuid, p_sb uuid, p_product uuid default null)
returns jsonb language plpgsql as $$
declare v_p uuid := p_product; v_j jsonb; v_d uuid; v_i uuid;
begin
  if v_p is null then
    insert into public.products (name, status, price, quantity_on_hand, needs_label)
    values ('TEST deliveries', 'inactive', 1, 0, true) returning id into v_p;
  end if;
  v_j := public.save_delivery_draft(null, p_admin, null, jsonb_build_object('notes', 'TEST deliveries', 'items', jsonb_build_array(
    jsonb_build_object('key', 1, 'product_id', v_p, 'quantity', 20, 'unit_cost', 2, 'needs_label', true,
                       'plan', jsonb_build_array(jsonb_build_object('store_id', p_sa, 'planned_qty', 6),
                                                 jsonb_build_object('store_id', p_sb, 'planned_qty', 4))))));
  v_d := (v_j ->> 'id')::uuid;
  v_i := (v_j -> 'items' -> 0 ->> 'id')::uuid;
  perform public.save_delivery(v_d, p_admin);
  perform public.receive_delivery_checked(v_d, p_admin, jsonb_build_array(jsonb_build_object('item_id', v_i, 'qty', 20)), '[]'::jsonb);
  perform public.label_items_checked(p_admin,
    jsonb_build_array(jsonb_build_object('item_id', v_i, 'qty', 6,
      'split', jsonb_build_array(jsonb_build_object('store_id', p_sa, 'qty', 6)))), '[]'::jsonb);
  return jsonb_build_object('delivery', v_d, 'item', v_i, 'product', v_p);
end $$;

-- Pack and send store A's ready units on a new trip. Returns the shipment id.
create or replace function pg_temp.cd_send(p_admin uuid, p_sa uuid)
returns uuid language plpgsql as $$
declare v_trip uuid; v_ship uuid;
begin
  v_trip := (public.create_trip(p_admin, array[p_sa], null) ->> 'trip_id')::uuid;
  select id into v_ship from public.shipments where trip_id = v_trip and store_id = p_sa;
  perform public.pack_shipment_checked(v_ship, p_admin,
    (select jsonb_agg(jsonb_build_object('line_id', id, 'qty', qty)) from public.shipment_lines where shipment_id = v_ship),
    1, '[]'::jsonb);
  perform public.send_trip(v_trip, p_admin);
  return v_ship;
end $$;

-- The store accepts every line of a shipment; p_short units fewer on the first line.
create or replace function pg_temp.cd_accept(p_admin uuid, p_ship uuid, p_short int default 0)
returns jsonb language sql as $$
  select public.confirm_shipment(p_ship, p_admin,
    (select jsonb_agg(jsonb_build_object('line_id', id, 'received_qty', qty - p_short, 'reason', 'short')) from public.shipment_lines where shipment_id = p_ship)) $$;

-- Units of a product in a store's batches.
create or replace function pg_temp.cd_stock(p_product uuid, p_store uuid)
returns int language sql as $$
  select coalesce(sum(quantity_remaining), 0)::int from public.stock_batches where product_id = p_product and store_id = p_store $$;

-- The counter equals the batches.
create or replace function pg_temp.cd_counter_ok(p_product uuid)
returns boolean language sql as $$
  select p.quantity_on_hand = coalesce((select sum(quantity_remaining) from public.stock_batches where product_id = p.id), 0)
  from public.products p where p.id = p_product $$;

create or replace function pg_temp.cd_tests()
returns table(test text, passed boolean, detail text) language plpgsql as $$
declare
  v_admin uuid; v_wh uuid; v_sa uuid; v_sb uuid;
  v_x jsonb; v_d uuid; v_p uuid; v_ship uuid; v_sale uuid; v_r jsonb;
  v_n int; v_n2 int; v_n3 int; v_ok boolean; v_txt text; v_txt2 text;
  v_err text; v_err2 text;
begin
  select id into v_admin from public.users where role = 'admin'
    order by (email = 'claude.admin@prody.local') desc, created_at limit 1;
  select id into v_wh from public.stores where is_warehouse and is_active;
  select id into v_sa from public.stores where is_active and not coalesce(is_warehouse, false) order by name limit 1;
  select id into v_sb from public.stores where is_active and not coalesce(is_warehouse, false) and id <> v_sa order by name limit 1;

  test := 'C0 fixtures: admin, warehouse, two stores';
  passed := v_admin is not null and v_wh is not null and v_sa is not null and v_sb is not null;
  detail := format('admin=%s wh=%s sa=%s sb=%s', v_admin, v_wh, v_sa, v_sb);
  return next;

  -- C1 6 of 20 went to store A and were accepted: the cancel takes 14 from Офис and 6
  -- from A, the counter ends at 0, the plan and the shipment stay as history.
  begin
    v_x := pg_temp.cd_delivery(v_admin, v_sa, v_sb);
    v_d := (v_x ->> 'delivery')::uuid; v_p := (v_x ->> 'product')::uuid;
    v_ship := pg_temp.cd_send(v_admin, v_sa);
    perform pg_temp.cd_accept(v_admin, v_ship);
    select string_agg(store_name || ':' || to_take || ':' || on_hand || ':' || short, ',') into v_txt
    from public.cancel_delivery_preview(v_d);
    v_r := public.cancel_delivery(v_d, v_admin, 'TEST deliveries');
    v_n := pg_temp.cd_stock(v_p, v_wh); v_n2 := pg_temp.cd_stock(v_p, v_sa);
    select quantity_on_hand into v_n3 from public.products where id = v_p;
    v_ok := pg_temp.cd_counter_ok(v_p);
    select d.status || '|' || (select string_agg(m.store_id::text || m.quantity, ',' order by m.quantity)
                               from public.stock_movements m where m.delivery_id = v_d and m.type = 'delivery_cancel')
      into v_txt2 from public.deliveries d where d.id = v_d;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'C1 cancel after shipping: Офис and the store give their units back';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt like '%:14:14:0,%:6:6:0' and (v_r ->> 'removed')::int = 20 and (v_r ->> 'short')::int = 0
                and v_n = 0 and v_n2 = 0 and v_n3 = 0 and v_ok
                and v_txt2 = 'cancelled|' || v_wh || '-14,' || v_sa || '-6';
      detail := format('preview=%s result=%s office=%s store=%s qoh=%s counter ok=%s movements=%s', v_txt, v_r, v_n, v_n2, v_n3, v_ok, v_txt2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- C2 store A sold 2 of its 6: without consent the cancel is refused with the numbers;
  -- with it, 4 leave A, 14 leave Офис, the 2 sold are written as short in the log.
  begin
    v_x := pg_temp.cd_delivery(v_admin, v_sa, v_sb);
    v_d := (v_x ->> 'delivery')::uuid; v_p := (v_x ->> 'product')::uuid;
    v_ship := pg_temp.cd_send(v_admin, v_sa);
    perform pg_temp.cd_accept(v_admin, v_ship);
    insert into public.sales (product_id, store_id, sold_by, quantity, sale_price, sale_group_id)
      values (v_p, v_sa, v_admin, 2, 1.00, gen_random_uuid()) returning id into v_sale;
    perform public.sell_from_batches(v_p, v_sa, 2, 1.00, v_sale, v_admin);
    begin perform public.cancel_delivery(v_d, v_admin, 'TEST deliveries'); v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    select status into v_txt from public.deliveries where id = v_d;
    v_r := public.cancel_delivery(v_d, v_admin, 'TEST deliveries', true);
    v_n := pg_temp.cd_stock(v_p, v_wh); v_n2 := pg_temp.cd_stock(v_p, v_sa);
    v_ok := pg_temp.cd_counter_ok(v_p);
    select (details ->> 'short_units') || '|' || (details -> 'short' -> 0 ->> 'qty') into v_txt2
    from public.delivery_events where delivery_id = v_d and type = 'cancelled';
    raise exception 'ROLLBACK';
  exception when others then
    test := 'C2 part sold in the store: refused, then cancelled with the shortfall logged';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like 'Доставката не може да се откаже: от „TEST deliveries“ трябва да се приберат 6 бр. от %, а там има само 4 бр. (част е продадена).%'
                and v_txt = 'in_progress'
                and (v_r ->> 'removed')::int = 18 and (v_r ->> 'short')::int = 2
                and v_n = 0 and v_n2 = 0 and v_ok and v_txt2 = '2|2';
      detail := format('without consent=%s status=%s | result=%s office=%s store=%s counter ok=%s log=%s', v_err, v_txt, v_r, v_n, v_n2, v_ok, v_txt2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- C3 the shipment is on the road: refused until the store accepts it; then it goes.
  begin
    v_x := pg_temp.cd_delivery(v_admin, v_sa, v_sb);
    v_d := (v_x ->> 'delivery')::uuid; v_p := (v_x ->> 'product')::uuid;
    v_ship := pg_temp.cd_send(v_admin, v_sa);
    begin perform public.cancel_delivery(v_d, v_admin, 'TEST deliveries'); v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    perform pg_temp.cd_accept(v_admin, v_ship);
    v_r := public.cancel_delivery(v_d, v_admin, 'TEST deliveries');
    v_ok := pg_temp.cd_counter_ok(v_p);
    select status into v_txt from public.deliveries where id = v_d;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'C3 on the road: accept first, then cancel';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like 'Пратка П-% до % е на път и още не е приета.%'
                and (v_r ->> 'removed')::int = 20 and v_ok and v_txt = 'cancelled';
      detail := format('on the road=%s | after accept=%s counter ok=%s status=%s', v_err, v_r, v_ok, v_txt);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- C4 the store found 1 missing (open signal, 1 already out of its stock): the cancel
  -- takes the other 5 from the store and closes the signal as 'other'.
  begin
    v_x := pg_temp.cd_delivery(v_admin, v_sa, v_sb);
    v_d := (v_x ->> 'delivery')::uuid; v_p := (v_x ->> 'product')::uuid;
    v_ship := pg_temp.cd_send(v_admin, v_sa);
    perform pg_temp.cd_accept(v_admin, v_ship, 1);
    select to_take into v_n from public.cancel_delivery_preview(v_d) where store_id = v_sa;
    v_r := public.cancel_delivery(v_d, v_admin, 'TEST deliveries');
    v_n2 := pg_temp.cd_stock(v_p, v_sa);
    v_ok := pg_temp.cd_counter_ok(v_p);
    select status || '|' || resolution into v_txt from public.delivery_signals where delivery_id = v_d;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'C4 a store shortfall: takes what arrived, closes the signal';
    if sqlerrm = 'ROLLBACK' then
      passed := v_n = 5 and (v_r ->> 'removed')::int = 19 and (v_r ->> 'signals_closed')::int = 1
                and v_n2 = 0 and v_ok and v_txt = 'resolved|other';
      detail := format('store to take=%s result=%s store left=%s counter ok=%s signal=%s', v_n, v_r, v_n2, v_ok, v_txt);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- C5 Офис and store A already had the product (3 old units each, cost 1). The trip took
  -- the old Office units first (FIFO); the cancel still takes exactly 20 and leaves the
  -- old 3 + 3 in place.
  begin
    insert into public.products (name, status, price, quantity_on_hand, needs_label)
    values ('TEST deliveries', 'inactive', 1, 6, true) returning id into v_p;
    insert into public.stock_batches (product_id, store_id, quantity_remaining, unit_cost, created_at)
    values (v_p, v_wh, 3, 1, now() - interval '2 days'), (v_p, v_sa, 3, 1, now() - interval '2 days');
    v_x := pg_temp.cd_delivery(v_admin, v_sa, v_sb, v_p);
    v_d := (v_x ->> 'delivery')::uuid;
    v_ship := pg_temp.cd_send(v_admin, v_sa);
    perform pg_temp.cd_accept(v_admin, v_ship);
    v_r := public.cancel_delivery(v_d, v_admin, 'TEST deliveries');
    v_n := pg_temp.cd_stock(v_p, v_wh); v_n2 := pg_temp.cd_stock(v_p, v_sa);
    select quantity_on_hand into v_n3 from public.products where id = v_p;
    v_ok := pg_temp.cd_counter_ok(v_p);
    raise exception 'ROLLBACK';
  exception when others then
    test := 'C5 older stock of the same product stays';
    if sqlerrm = 'ROLLBACK' then
      passed := (v_r ->> 'removed')::int = 20 and v_n = 3 and v_n2 = 3 and v_n3 = 6 and v_ok;
      detail := format('result=%s office=%s store=%s qoh=%s counter ok=%s', v_r, v_n, v_n2, v_n3, v_ok);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- C6 nothing shipped (as before): the cancel takes the 20 out of Офис; a trip that has
  -- not left still blocks it; a completed delivery cannot be cancelled.
  begin
    v_x := pg_temp.cd_delivery(v_admin, v_sa, v_sb);
    v_d := (v_x ->> 'delivery')::uuid; v_p := (v_x ->> 'product')::uuid;
    perform public.create_trip(v_admin, array[v_sa], null);
    begin perform public.cancel_delivery(v_d, v_admin, 'TEST deliveries'); v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    v_x := pg_temp.cd_delivery(v_admin, v_sa, v_sb);
    v_r := public.cancel_delivery((v_x ->> 'delivery')::uuid, v_admin, 'TEST deliveries');
    v_n := pg_temp.cd_stock((v_x ->> 'product')::uuid, v_wh);
    update public.deliveries set status = 'completed' where id = v_d;
    begin perform public.cancel_delivery(v_d, v_admin, 'TEST deliveries'); v_err2 := 'no error';
    exception when others then v_err2 := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'C6 unshipped: as before; unsent trip and completed are refused';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like 'Доставката е в курс К-%, който още не е тръгнал%'
                and (v_r ->> 'removed')::int = 20 and v_n = 0
                and v_err2 like 'Доставка Д-% е приключена и не може да се откаже';
      detail := format('unsent trip=%s | office only=%s left=%s | completed=%s', v_err, v_r, v_n, v_err2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- C7 only service_role may call the new functions.
  test := 'C7 grants: service_role only';
  passed := has_function_privilege('service_role', 'public.cancel_delivery(uuid, uuid, text, boolean)', 'EXECUTE')
            and has_function_privilege('service_role', 'public.cancel_delivery_preview(uuid)', 'EXECUTE')
            and not has_function_privilege('anon', 'public.cancel_delivery(uuid, uuid, text, boolean)', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.cancel_delivery(uuid, uuid, text, boolean)', 'EXECUTE')
            and not has_function_privilege('anon', 'public.cancel_delivery_preview(uuid)', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.cancel_delivery_preview(uuid)', 'EXECUTE')
            and to_regprocedure('public.cancel_delivery(uuid, uuid, text)') is null;
  detail := '';
  return next;
end $$;

select * from pg_temp.cd_tests();
