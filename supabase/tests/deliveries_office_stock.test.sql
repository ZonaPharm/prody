-- Tests for migration 20261112_deliveries_office_stock (add_office_stock, and send_trip /
-- confirm_shipment / resolve_signal with lines of Office stock), on top of the phase 1–3
-- delivery migrations and 20261111_deliveries_trip_edit.
--
-- Run against STAGING only (SQL Editor or psql on ruhhsixmqusnpiajkbxe), after the
-- migration. Self-contained like the other delivery tests: synthetic products named
-- 'TEST deliveries', every scenario ends by raising 'ROLLBACK', so nothing stays.
-- Every row should read passed = true.

-- A product with p_qty units in Офис at cost 2 (no delivery). Returns its id.
create or replace function pg_temp.os_product(p_wh uuid, p_qty int)
returns uuid language plpgsql as $$
declare v_p uuid;
begin
  insert into public.products (name, status, price, quantity_on_hand, needs_label)
  values ('TEST deliveries', 'inactive', 5, p_qty, false) returning id into v_p;
  insert into public.stock_batches (product_id, store_id, quantity_remaining, unit_cost, created_at)
  values (v_p, p_wh, p_qty, 2, now() - interval '1 day');
  return v_p;
end $$;

-- A saved delivery of one new product: 20 units, plan 6 for store A and 4 for store B,
-- all received into Офис and labelled for A. Returns {delivery, item, plan_a, product}.
create or replace function pg_temp.os_delivery(p_admin uuid, p_sa uuid, p_sb uuid)
returns jsonb language plpgsql as $$
declare v_p uuid; v_j jsonb; v_d uuid; v_i uuid; v_pa uuid;
begin
  insert into public.products (name, status, price, quantity_on_hand, needs_label)
  values ('TEST deliveries', 'inactive', 1, 0, true) returning id into v_p;
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
  select id into v_pa from public.delivery_item_plan where delivery_item_id = v_i and store_id = p_sa;
  return jsonb_build_object('delivery', v_d, 'item', v_i, 'plan_a', v_pa, 'product', v_p);
end $$;

-- [{product_id, qty}] for one product.
create or replace function pg_temp.os_line(p_product uuid, p_qty int)
returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('product_id', p_product, 'qty', p_qty)) $$;

-- Pack every line of a shipment as it is.
create or replace function pg_temp.os_pack(p_admin uuid, p_ship uuid, p_boxes int)
returns jsonb language sql as $$
  select public.pack_shipment_checked(p_ship, p_admin,
    (select jsonb_agg(jsonb_build_object('line_id', id, 'qty', qty)) from public.shipment_lines where shipment_id = p_ship),
    p_boxes, '[]'::jsonb) $$;

-- Units of a product in a store's batches.
create or replace function pg_temp.os_stock(p_product uuid, p_store uuid)
returns int language sql as $$
  select coalesce(sum(quantity_remaining), 0)::int from public.stock_batches where product_id = p_product and store_id = p_store $$;

create or replace function pg_temp.os_tests()
returns table(test text, passed boolean, detail text) language plpgsql as $$
declare
  v_admin uuid; v_wh uuid; v_sa uuid; v_sb uuid;
  v_p uuid; v_p2 uuid; v_x jsonb; v_j jsonb; v_j2 jsonb; v_trip uuid; v_ship uuid; v_line uuid; v_sig uuid;
  v_n int; v_n2 int; v_n3 int; v_txt text; v_txt2 text; v_txt3 text;
  v_err text; v_err2 text; v_err3 text; v_err4 text; v_err5 text;
begin
  select id into v_admin from public.users where role = 'admin'
    order by (email = 'claude.admin@prody.local') desc, created_at limit 1;
  select id into v_wh from public.stores where is_warehouse and is_active;
  select id into v_sa from public.stores where is_active and not coalesce(is_warehouse, false) order by name limit 1;
  select id into v_sb from public.stores where is_active and not coalesce(is_warehouse, false) and id <> v_sa order by name limit 1;

  test := 'O0 fixtures: admin, warehouse, two stores';
  passed := v_admin is not null and v_wh is not null and v_sa is not null and v_sb is not null;
  detail := format('admin=%s wh=%s sa=%s sb=%s', v_admin, v_wh, v_sa, v_sb);
  return next;

  -- O1 Office stock without a delivery: a new trip with one shipment; adding the same
  -- product again raises the one Office line; the log has trip_created and office_added.
  begin
    v_p := pg_temp.os_product(v_wh, 10);
    v_j := public.add_office_stock(null, v_sa, v_admin, pg_temp.os_line(v_p, 3));
    v_trip := (v_j ->> 'trip_id')::uuid;
    v_ship := (v_j ->> 'shipment_id')::uuid;
    v_j2 := public.add_office_stock(v_trip, v_sa, v_admin, pg_temp.os_line(v_p, 2));
    select sh.status || '|' || count(sl.id) || '|' || coalesce(sum(sl.qty), 0) || '|' || bool_and(sl.plan_id is null and sl.delivery_item_id is null)
      into v_txt
    from public.shipments sh left join public.shipment_lines sl on sl.shipment_id = sh.id
    where sh.id = v_ship group by sh.status;
    select count(*) filter (where type = 'trip_created'), count(*) filter (where type = 'office_added')
      into v_n, v_n2 from public.delivery_events where trip_id = v_trip;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'O1 add_office_stock: new trip, one line per product';
    if sqlerrm = 'ROLLBACK' then
      passed := (v_j ->> 'new_trip')::boolean and not (v_j2 ->> 'new_trip')::boolean
                and (v_j2 ->> 'shipment_id')::uuid = v_ship
                and v_txt = 'packing|1|5|true' and v_n = 1 and v_n2 = 2;
      detail := format('first=%s second=%s shipment=%s created=%s added=%s', v_j, v_j2, v_txt, v_n, v_n2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- O2 refusals: more than is free (10 in Офис, 6 already wait in a shipment), the same
  -- product twice, 0 units, the warehouse as the store, a trip that has left.
  begin
    v_p := pg_temp.os_product(v_wh, 10);
    v_trip := (public.add_office_stock(null, v_sa, v_admin, pg_temp.os_line(v_p, 6)) ->> 'trip_id')::uuid;
    begin perform public.add_office_stock(null, v_sb, v_admin, pg_temp.os_line(v_p, 5)); exception when others then v_err := sqlerrm; end;
    begin perform public.add_office_stock(v_trip, v_sa, v_admin,
            jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1), jsonb_build_object('product_id', v_p, 'qty', 1)));
    exception when others then v_err2 := sqlerrm; end;
    begin perform public.add_office_stock(v_trip, v_sa, v_admin, pg_temp.os_line(v_p, 0)); exception when others then v_err3 := sqlerrm; end;
    begin perform public.add_office_stock(v_trip, v_wh, v_admin, pg_temp.os_line(v_p, 1)); exception when others then v_err4 := sqlerrm; end;
    -- 4 are still free: that goes.
    perform public.add_office_stock(null, v_sb, v_admin, pg_temp.os_line(v_p, 4));
    perform pg_temp.os_pack(v_admin, (select id from public.shipments where trip_id = v_trip), 1);
    perform public.send_trip(v_trip, v_admin);
    begin perform public.add_office_stock(v_trip, v_sa, v_admin, pg_temp.os_line(v_p, 1)); exception when others then v_err5 := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'O2 add_office_stock refuses: not free, twice, 0, warehouse, departed';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like 'Няма толкова „TEST deliveries“ в %: налични 10 бр., за доставки 0 бр., чакат в пратки 6 бр., свободни 4 бр.'
                and v_err2 = 'Продукт се повтаря: въведете го веднъж с общия брой'
                and v_err3 = 'Всеки ред трябва да има продукт и брой поне 1'
                and v_err4 like 'Складът % не получава пратки'
                and v_err5 like 'Курс К-% не се променя: той е тръгнал';
      detail := format('free=%s | twice=%s | zero=%s | warehouse=%s | departed=%s', v_err, v_err2, v_err3, v_err4, v_err5);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- O3 a packed shipment gets one more product at the last minute: it is opened for
  -- packing again ('unpacked' logged with the reason) and must be packed and signed anew.
  begin
    v_p := pg_temp.os_product(v_wh, 10);
    v_p2 := pg_temp.os_product(v_wh, 3);
    v_j := public.add_office_stock(null, v_sa, v_admin, pg_temp.os_line(v_p, 2));
    v_trip := (v_j ->> 'trip_id')::uuid;
    v_ship := (v_j ->> 'shipment_id')::uuid;
    perform pg_temp.os_pack(v_admin, v_ship, 2);
    v_j2 := public.add_office_stock(v_trip, v_sa, v_admin, pg_temp.os_line(v_p2, 1));
    select status || '|' || coalesce(box_count::text, 'null') into v_txt from public.shipments where id = v_ship;
    select details ->> 'reason' into v_txt2 from public.delivery_events where shipment_id = v_ship and type = 'unpacked';
    begin perform public.send_trip(v_trip, v_admin); exception when others then v_err := sqlerrm; end;
    perform pg_temp.os_pack(v_admin, v_ship, 2);
    perform public.send_trip(v_trip, v_admin);
    select status into v_txt3 from public.shipments where id = v_ship;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'O3 last minute: a packed shipment opens for packing again';
    if sqlerrm = 'ROLLBACK' then
      passed := (v_j2 ->> 'reopened')::boolean and v_txt = 'packing|null' and v_txt2 = 'office_added'
                and v_err like 'Пратка П-% за % още не е опакована' and v_txt3 = 'sent';
      detail := format('result=%s after=%s reason=%s send before packing=%s final=%s', v_j2, v_txt, v_txt2, v_err, v_txt3);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- O4 a trip with a delivery line and an Office line for the same store: both leave
  -- Офис FIFO, the plan row counts only the delivery line, the store gets both; the
  -- 'sent' event tells the Office units apart.
  begin
    v_x := pg_temp.os_delivery(v_admin, v_sa, v_sb);
    v_p := pg_temp.os_product(v_wh, 10);
    v_trip := (public.create_trip(v_admin, array[v_sa], null) ->> 'trip_id')::uuid;
    v_ship := (select id from public.shipments where trip_id = v_trip and store_id = v_sa);
    perform public.add_office_stock(v_trip, v_sa, v_admin, pg_temp.os_line(v_p, 4));
    perform pg_temp.os_pack(v_admin, v_ship, 1);
    perform public.send_trip(v_trip, v_admin);
    v_n := pg_temp.os_stock(v_p, v_wh);
    v_n2 := pg_temp.os_stock(v_p, v_sa);
    v_n3 := pg_temp.os_stock((v_x ->> 'product')::uuid, v_sa);
    select shipped_qty::text into v_txt from public.delivery_item_plan where id = (v_x ->> 'plan_a')::uuid;
    select (details ->> 'office_units') || '|' || jsonb_array_length(details -> 'delivery_ids') into v_txt2
    from public.delivery_events where shipment_id = v_ship and type = 'sent';
    select count(*)::text into v_txt3 from public.stock_batches
    where product_id = v_p and store_id = v_sa and delivery_item_id is null;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'O4 send_trip: delivery and Office lines together';
    if sqlerrm = 'ROLLBACK' then
      passed := v_n = 6 and v_n2 = 4 and v_n3 = 6 and v_txt = '6' and v_txt2 = '4|1' and v_txt3 = '1';
      detail := format('office left=%s store office product=%s store delivery product=%s plan shipped=%s sent event=%s batches=%s',
                       v_n, v_n2, v_n3, v_txt, v_txt2, v_txt3);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- O5 the store is 1 short on an Office line: the signal has no delivery, the store's
  -- stock goes down by 1; "Намерени" puts it back at the cost it came with (2).
  begin
    v_p := pg_temp.os_product(v_wh, 10);
    v_j := public.add_office_stock(null, v_sa, v_admin, pg_temp.os_line(v_p, 5));
    v_trip := (v_j ->> 'trip_id')::uuid;
    v_ship := (v_j ->> 'shipment_id')::uuid;
    perform pg_temp.os_pack(v_admin, v_ship, 1);
    perform public.send_trip(v_trip, v_admin);
    select id into v_line from public.shipment_lines where shipment_id = v_ship;
    v_j2 := public.confirm_shipment(v_ship, v_admin,
      jsonb_build_array(jsonb_build_object('line_id', v_line, 'received_qty', 4, 'reason', 'missing')));
    v_n := pg_temp.os_stock(v_p, v_sa);
    select id, (delivery_id is null and delivery_item_id is null)::text into v_sig, v_txt
    from public.delivery_signals where shipment_id = v_ship;
    perform public.resolve_signal(v_sig, v_admin, 'found', 'TEST');
    v_n2 := pg_temp.os_stock(v_p, v_sa);
    select unit_cost::text into v_txt2 from public.stock_movements
    where shipment_id = v_ship and product_id = v_p and type = 'correction' and quantity > 0;
    select status into v_txt3 from public.trips where id = v_trip;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'O5 confirm and resolve an Office line';
    if sqlerrm = 'ROLLBACK' then
      passed := v_j2 ->> 'status' = 'received_with_issues' and v_n = 4 and v_txt = 'true'
                and v_n2 = 5 and v_txt2::numeric = 2 and v_txt3 = 'completed';
      detail := format('confirm=%s store after=%s no delivery=%s after found=%s cost=%s trip=%s',
                       v_j2, v_n, v_txt, v_n2, v_txt2, v_txt3);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- O6 a delivery line still cannot be half set; nothing was left behind.
  begin
    v_x := pg_temp.os_delivery(v_admin, v_sa, v_sb);
    v_trip := (public.create_trip(v_admin, array[v_sa], null) ->> 'trip_id')::uuid;
    begin
      update public.shipment_lines set plan_id = null
      where shipment_id = (select id from public.shipments where trip_id = v_trip);
    exception when others then v_err := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'O6 a line is from a delivery or from Офис, never half';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like '%shipment_lines_source_check%';
      detail := v_err;
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- O7 office_free_stock: what an open delivery still needs is not free. Delivery of 20,
  -- plan A 6 + B 4, 6 labelled and ready for A: bound = 10 for the stores + Офис's 10
  -- unlabelled = 20, free 0. After a trip takes A's 6: bound 14 of 14 in Офис. Labelling
  -- Офис's 10 frees them (bound 4 for B). Plus 3 units of stock from before: free 3, then 13.
  begin
    v_x := pg_temp.os_delivery(v_admin, v_sa, v_sb);
    v_p := (v_x ->> 'product')::uuid;
    insert into public.stock_batches (product_id, store_id, quantity_remaining, unit_cost, created_at)
    values (v_p, v_wh, 3, 2, now() - interval '2 day');
    select on_hand || '|' || for_deliveries || '|' || in_shipments || '|' || free into v_txt
    from public.office_free_stock(array[v_p]);
    v_trip := (public.create_trip(v_admin, array[v_sa], null) ->> 'trip_id')::uuid;
    perform pg_temp.os_pack(v_admin, (select id from public.shipments where trip_id = v_trip), 1);
    perform public.send_trip(v_trip, v_admin);
    select on_hand || '|' || for_deliveries || '|' || free into v_txt2 from public.office_free_stock(array[v_p]);
    perform public.label_items_checked(v_admin,
      jsonb_build_array(jsonb_build_object('item_id', v_x ->> 'item', 'qty', 10,
        'split', jsonb_build_array(jsonb_build_object('store_id', null, 'qty', 10)))), '[]'::jsonb);
    select on_hand || '|' || for_deliveries || '|' || free into v_txt3 from public.office_free_stock(array[v_p]);
    begin perform public.add_office_stock(null, v_sb, v_admin, pg_temp.os_line(v_p, 14)); exception when others then v_err := sqlerrm; end;
    v_j := public.add_office_stock(null, v_sb, v_admin, pg_temp.os_line(v_p, 13));
    raise exception 'ROLLBACK';
  exception when others then
    test := 'O7 office_free_stock keeps what open deliveries still need';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = '23|20|0|3' and v_txt2 = '17|14|3' and v_txt3 = '17|4|13'
                and v_err like 'Няма толкова%свободни 13 бр.' and (v_j ->> 'units')::int = 13;
      detail := format('start=%s after trip=%s after office labelled=%s | over=%s', v_txt, v_txt2, v_txt3, v_err);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  test := 'O8 nothing left behind';
  passed := not exists (select 1 from public.products where name = 'TEST deliveries');
  detail := '';
  return next;
end $$;

select * from pg_temp.os_tests();
