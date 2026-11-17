-- Tests for migration 20261111_deliveries_trip_edit (add_to_trip, remove_shipment,
-- reopen_packing, and send_trip / confirm_shipment with a removed shipment), on top of the
-- phase 1–3 delivery migrations, 20261111_deliveries_label_items and
-- 20261111_deliveries_label_split.
--
-- Run against STAGING only (SQL Editor or psql on ruhhsixmqusnpiajkbxe), after the
-- migration. Self-contained like the other delivery tests: synthetic products named
-- 'TEST deliveries', every scenario ends by raising 'ROLLBACK', so nothing stays.
-- Every row should read passed = true.

-- A saved delivery of one new product: 20 units, plan 6 for store A and 4 for store B,
-- all received into Офис. Returns {delivery, item, plan_a, plan_b}.
create or replace function pg_temp.te_delivery(p_admin uuid, p_sa uuid, p_sb uuid)
returns jsonb language plpgsql as $$
declare v_p uuid; v_j jsonb; v_d uuid; v_i uuid; v_pa uuid; v_pb uuid;
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
  select id into v_pa from public.delivery_item_plan where delivery_item_id = v_i and store_id = p_sa;
  select id into v_pb from public.delivery_item_plan where delivery_item_id = v_i and store_id = p_sb;
  return jsonb_build_object('delivery', v_d, 'item', v_i, 'plan_a', v_pa, 'plan_b', v_pb);
end $$;

-- Label p_qty units of the line for one store (p_store; null = Офис).
create or replace function pg_temp.te_label(p_admin uuid, p_x jsonb, p_store uuid, p_qty int)
returns jsonb language sql as $$
  select public.label_items_checked(p_admin,
    jsonb_build_array(jsonb_build_object('item_id', p_x ->> 'item', 'qty', p_qty,
      'split', jsonb_build_array(jsonb_build_object('store_id', p_store, 'qty', p_qty)))), '[]'::jsonb) $$;

-- The shipment of a trip for a store.
create or replace function pg_temp.te_ship(p_trip uuid, p_store uuid)
returns uuid language sql as $$
  select id from public.shipments where trip_id = p_trip and store_id = p_store $$;

-- Pack every line of a shipment as it is.
create or replace function pg_temp.te_pack(p_admin uuid, p_ship uuid, p_boxes int)
returns jsonb language sql as $$
  select public.pack_shipment_checked(p_ship, p_admin,
    (select jsonb_agg(jsonb_build_object('line_id', id, 'qty', qty)) from public.shipment_lines where shipment_id = p_ship),
    p_boxes, '[]'::jsonb) $$;

-- "status|lines|units" of a shipment.
create or replace function pg_temp.te_state(p_ship uuid)
returns text language sql as $$
  select sh.status || '|' || (select count(*) from public.shipment_lines where shipment_id = sh.id)
      || '|' || (select coalesce(sum(qty), 0) from public.shipment_lines where shipment_id = sh.id)
  from public.shipments sh where sh.id = p_ship $$;

create or replace function pg_temp.te_tests()
returns table(test text, passed boolean, detail text) language plpgsql as $$
declare
  v_admin uuid; v_wh uuid; v_sa uuid; v_sb uuid;
  v_x jsonb; v_j jsonb; v_trip uuid; v_trip2 uuid; v_sha uuid; v_shb uuid; v_n int; v_n2 int;
  v_txt text; v_txt2 text; v_txt3 text; v_err text; v_err2 text; v_err3 text; v_err4 text;
begin
  select id into v_admin from public.users where role = 'admin'
    order by (email = 'claude.admin@prody.local') desc, created_at limit 1;
  select id into v_wh from public.stores where is_warehouse and is_active;
  select id into v_sa from public.stores where is_active and not coalesce(is_warehouse, false) order by name limit 1;
  select id into v_sb from public.stores where is_active and not coalesce(is_warehouse, false) and id <> v_sa order by name limit 1;

  test := 'E0 fixtures: admin, warehouse, two stores';
  passed := v_admin is not null and v_wh is not null and v_sa is not null and v_sb is not null;
  detail := format('admin=%s wh=%s sa=%s sb=%s', v_admin, v_wh, v_sa, v_sb);
  return next;

  -- E1 what is labelled after the trip was made goes into it: more units on the same
  -- line for A, a new shipment for B; one 'trip_changed' event.
  begin
    v_x := pg_temp.te_delivery(v_admin, v_sa, v_sb);
    perform pg_temp.te_label(v_admin, v_x, v_sa, 3);
    v_trip := (public.create_trip(v_admin, array[v_sa], null) ->> 'trip_id')::uuid;
    v_sha := pg_temp.te_ship(v_trip, v_sa);
    perform pg_temp.te_label(v_admin, v_x, v_sa, 3);
    perform pg_temp.te_label(v_admin, v_x, v_sb, 4);
    v_j := public.add_to_trip(v_trip, v_admin, array[v_sa, v_sb]);
    v_shb := pg_temp.te_ship(v_trip, v_sb);
    v_txt := pg_temp.te_state(v_sha) || ' ' || pg_temp.te_state(v_shb);
    select count(*) into v_n from public.delivery_events where trip_id = v_trip and type = 'trip_changed' and details ->> 'action' = 'added';
    raise exception 'ROLLBACK';
  exception when others then
    test := 'E1 add_to_trip: more on the line, a new shipment';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = 'packing|1|6 packing|1|4' and (v_j ->> 'units')::int = 7 and v_n = 1;
      detail := format('shipments=%s result=%s events=%s', v_txt, v_j, v_n);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- E2 add_to_trip refuses: nothing new, a packed shipment with something to add,
  -- a trip that has left. A packed shipment with nothing to add is left alone.
  begin
    v_x := pg_temp.te_delivery(v_admin, v_sa, v_sb);
    perform pg_temp.te_label(v_admin, v_x, v_sa, 3);
    perform pg_temp.te_label(v_admin, v_x, v_sb, 4);
    v_trip := (public.create_trip(v_admin, array[v_sa, v_sb], null) ->> 'trip_id')::uuid;
    v_sha := pg_temp.te_ship(v_trip, v_sa);
    v_shb := pg_temp.te_ship(v_trip, v_sb);
    begin perform public.add_to_trip(v_trip, v_admin, array[v_sa]); exception when others then v_err := sqlerrm; end;
    perform pg_temp.te_pack(v_admin, v_sha, 1);
    perform pg_temp.te_label(v_admin, v_x, v_sa, 3);
    begin perform public.add_to_trip(v_trip, v_admin, array[v_sa]); exception when others then v_err2 := sqlerrm; end;
    -- B has nothing new: A is packed but B is asked, so the packed A is not in the way.
    begin perform public.add_to_trip(v_trip, v_admin, array[v_sb]); exception when others then v_err3 := sqlerrm; end;
    perform pg_temp.te_pack(v_admin, v_shb, 1);
    perform public.send_trip(v_trip, v_admin);
    begin perform public.add_to_trip(v_trip, v_admin, array[v_sa]); exception when others then v_err4 := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'E2 add_to_trip refuses: nothing new, packed, departed';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err = 'Няма нова готова стока за избраните обекти'
                and v_err2 like 'Пратка П-% за % е опакована: първо „Отвори опаковането“'
                and v_err3 = 'Няма нова готова стока за избраните обекти'
                and v_err4 like 'Курс К-% не се променя: той е тръгнал';
      detail := format('nothing=%s | packed=%s | other store=%s | departed=%s', v_err, v_err2, v_err3, v_err4);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- E3 remove_shipment: B leaves the trip, its ready units are free again; the last
  -- shipment cannot be removed; the trip leaves without B and is completed by A alone.
  begin
    v_x := pg_temp.te_delivery(v_admin, v_sa, v_sb);
    perform pg_temp.te_label(v_admin, v_x, v_sa, 6);
    perform pg_temp.te_label(v_admin, v_x, v_sb, 4);
    v_trip := (public.create_trip(v_admin, array[v_sa, v_sb], null) ->> 'trip_id')::uuid;
    v_sha := pg_temp.te_ship(v_trip, v_sa);
    v_shb := pg_temp.te_ship(v_trip, v_sb);
    perform pg_temp.te_pack(v_admin, v_shb, 1);
    begin perform public.remove_shipment(v_shb, v_admin, '  '); exception when others then v_err := sqlerrm; end;
    perform public.remove_shipment(v_shb, v_admin, 'не се събра в колата');
    begin perform public.remove_shipment(v_sha, v_admin, 'грешка'); exception when others then v_err2 := sqlerrm; end;
    begin perform public.remove_shipment(v_shb, v_admin, 'пак'); exception when others then v_err3 := sqlerrm; end;
    v_txt := pg_temp.te_state(v_shb);
    select details ->> 'reason' || '|' || qty into v_txt2 from public.delivery_events
      where shipment_id = v_shb and type = 'trip_changed' and details ->> 'action' = 'removed';
    perform pg_temp.te_pack(v_admin, v_sha, 2);
    perform public.send_trip(v_trip, v_admin);
    v_txt3 := pg_temp.te_state(v_sha) || ' ' || pg_temp.te_state(v_shb);
    select ready_qty - shipped_qty into v_n from public.delivery_item_plan where id = (v_x ->> 'plan_b')::uuid;
    perform public.confirm_shipment(v_sha, v_admin,
      (select jsonb_agg(jsonb_build_object('line_id', id, 'received_qty', qty)) from public.shipment_lines where shipment_id = v_sha));
    select status into v_err4 from public.trips where id = v_trip;
    v_trip2 := (public.create_trip(v_admin, array[v_sb], null) ->> 'trip_id')::uuid;
    v_n2 := (select sum(qty) from public.shipment_lines where shipment_id = pg_temp.te_ship(v_trip2, v_sb));
    raise exception 'ROLLBACK';
  exception when others then
    test := 'E3 remove_shipment: B waits for the next trip';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err = 'Напишете причина'
                and v_err2 like 'П-% е единствената пратка в курс К-%: откажете целия курс'
                and v_err3 like 'Пратка П-% вече е махната от курса'
                and v_txt = 'cancelled|0|0' and v_txt2 = 'не се събра в колата|4'
                and v_txt3 = 'sent|1|6 cancelled|0|0' and v_n = 4
                and v_err4 = 'completed' and v_n2 = 4;
      detail := format('blank=%s | last=%s | again=%s | b=%s event=%s | after send=%s b free=%s | trip=%s | next trip b=%s',
                       v_err, v_err2, v_err3, v_txt, v_txt2, v_txt3, v_n, v_err4, v_n2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- E4 a removed store comes back to the trip with add_to_trip (same shipment number).
  begin
    v_x := pg_temp.te_delivery(v_admin, v_sa, v_sb);
    perform pg_temp.te_label(v_admin, v_x, v_sa, 6);
    perform pg_temp.te_label(v_admin, v_x, v_sb, 4);
    v_trip := (public.create_trip(v_admin, array[v_sa, v_sb], null) ->> 'trip_id')::uuid;
    v_shb := pg_temp.te_ship(v_trip, v_sb);
    perform pg_temp.te_pack(v_admin, v_shb, 3);
    perform public.remove_shipment(v_shb, v_admin, 'по-късно');
    v_j := public.add_to_trip(v_trip, v_admin, array[v_sb]);
    v_txt := pg_temp.te_state(v_shb);
    select coalesce(box_count::text, 'null') || '|' || (packed_by is null) into v_txt2 from public.shipments where id = v_shb;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'E4 a removed shipment comes back';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = 'packing|1|4' and v_txt2 = 'null|true'
                and (v_j -> 'shipments' -> 0 ->> 'shipment_id')::uuid = v_shb;
      detail := format('b=%s packed=%s result=%s', v_txt, v_txt2, v_j);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- E5 reopen_packing: packed → packing, box count and signature cleared, the log keeps
  -- them; only a packed shipment; the trip cannot leave until it is packed again.
  begin
    v_x := pg_temp.te_delivery(v_admin, v_sa, v_sb);
    perform pg_temp.te_label(v_admin, v_x, v_sa, 6);
    v_trip := (public.create_trip(v_admin, array[v_sa], null) ->> 'trip_id')::uuid;
    v_sha := pg_temp.te_ship(v_trip, v_sa);
    begin perform public.reopen_packing(v_sha, v_admin); exception when others then v_err := sqlerrm; end;
    perform pg_temp.te_pack(v_admin, v_sha, 2);
    perform public.reopen_packing(v_sha, v_admin);
    select status || '|' || coalesce(box_count::text, 'null') || '|' || (packed_at is null) into v_txt from public.shipments where id = v_sha;
    select details ->> 'box_count' into v_txt2 from public.delivery_events where shipment_id = v_sha and type = 'unpacked';
    begin perform public.send_trip(v_trip, v_admin); exception when others then v_err2 := sqlerrm; end;
    perform pg_temp.te_pack(v_admin, v_sha, 3);
    perform public.send_trip(v_trip, v_admin);
    begin perform public.reopen_packing(v_sha, v_admin); exception when others then v_err3 := sqlerrm; end;
    select status || '|' || box_count into v_txt3 from public.shipments where id = v_sha;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'E5 reopen_packing';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like 'Пратка П-% не е опакована: тя е в опаковане'
                and v_txt = 'packing|null|true' and v_txt2 = '2'
                and v_err2 like 'Пратка П-% за % още не е опакована'
                and v_err3 like 'Курс К-% не се променя: той е тръгнал'
                and v_txt3 = 'sent|3';
      detail := format('not packed=%s | after=%s logged boxes=%s | send=%s | departed=%s | final=%s',
                       v_err, v_txt, v_txt2, v_err2, v_err3, v_txt3);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- E6 nothing was left behind.
  test := 'E6 nothing left behind';
  passed := not exists (select 1 from public.products where name = 'TEST deliveries');
  detail := '';
  return next;
end $$;

select * from pg_temp.te_tests();
