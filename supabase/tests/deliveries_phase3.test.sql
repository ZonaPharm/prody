-- Tests for migration 20261111_deliveries_label_pack_trip (mark_ready_checked,
-- pack_shipment_checked, cancel_trip), on top of the phase 1 and 2 delivery migrations.
--
-- Run against STAGING only (SQL Editor or psql on ruhhsixmqusnpiajkbxe), after the
-- migration. Self-contained like deliveries_phase2.test.sql: synthetic products named
-- 'TEST deliveries', every scenario ends by raising 'ROLLBACK', so nothing stays.
-- Uses the real active warehouse (Офис), two other active stores and an admin.
-- Every row should read passed = true.

create or replace function pg_temp.p3_product()
returns uuid language sql as $$
  insert into public.products (name, status, price, quantity_on_hand, needs_label)
  values ('TEST deliveries', 'inactive', 1, 0, true) returning id $$;

-- A saved delivery of one product: 10 units, plan 6 for store A and 4 for store B,
-- p_received of them received into Офис. Returns {delivery, item, plan_a, plan_b, product}.
create or replace function pg_temp.p3_delivery(p_admin uuid, p_sa uuid, p_sb uuid, p_received int)
returns jsonb language plpgsql as $$
declare v_p uuid; v_j jsonb; v_d uuid; v_i uuid; v_pa uuid; v_pb uuid;
begin
  v_p := pg_temp.p3_product();
  v_j := public.save_delivery_draft(null, p_admin, null, jsonb_build_object('notes', 'TEST deliveries', 'items', jsonb_build_array(
    jsonb_build_object('key', 1, 'product_id', v_p, 'quantity', 10, 'unit_cost', 2,
                       'plan', jsonb_build_array(jsonb_build_object('store_id', p_sa, 'planned_qty', 6),
                                                 jsonb_build_object('store_id', p_sb, 'planned_qty', 4))))));
  v_d := (v_j ->> 'id')::uuid;
  v_i := (v_j -> 'items' -> 0 ->> 'id')::uuid;
  perform public.save_delivery(v_d, p_admin);
  if p_received > 0 then
    perform public.receive_delivery_checked(v_d, p_admin, jsonb_build_array(jsonb_build_object('item_id', v_i, 'qty', p_received)), '[]'::jsonb);
  end if;
  select id into v_pa from public.delivery_item_plan where delivery_item_id = v_i and store_id = p_sa;
  select id into v_pb from public.delivery_item_plan where delivery_item_id = v_i and store_id = p_sb;
  return jsonb_build_object('delivery', v_d, 'item', v_i, 'plan_a', v_pa, 'plan_b', v_pb, 'product', v_p);
end $$;

create or replace function pg_temp.p3_tests()
returns table(test text, passed boolean, detail text) language plpgsql as $$
declare
  v_admin uuid; v_wh uuid; v_sa uuid; v_sb uuid;
  v_x jsonb; v_j jsonb; v_j2 jsonb; v_trip uuid; v_trip2 uuid; v_sha uuid; v_shb uuid; v_la uuid; v_lb uuid;
  v_n int; v_n2 int; v_n3 int; v_n4 int; v_n5 int;
  v_txt text; v_txt2 text; v_err text; v_err2 text; v_err3 text; v_err4 text; v_err5 text;
begin
  select id into v_admin from public.users where role = 'admin'
    order by (email = 'claude.admin@prody.local') desc, created_at limit 1;
  select id into v_wh from public.stores where is_warehouse and is_active;
  select id into v_sa from public.stores where is_active and not coalesce(is_warehouse, false) order by name limit 1;
  select id into v_sb from public.stores where is_active and not coalesce(is_warehouse, false) and id <> v_sa order by name limit 1;

  test := 'Q0 fixtures: admin, warehouse, two stores';
  passed := v_admin is not null and v_wh is not null and v_sa is not null and v_sb is not null;
  detail := format('admin=%s wh=%s sa=%s sb=%s', v_admin, v_wh, v_sa, v_sb);
  return next;

  -- Q1 the labelling checklist: a ticked row, a damaged row with its good units,
  -- a label signal that names the store, one 'ready' event per row.
  begin
    v_x := pg_temp.p3_delivery(v_admin, v_sa, v_sb, 10);
    v_j := public.mark_ready_checked(v_admin,
      jsonb_build_array(jsonb_build_object('plan_id', v_x ->> 'plan_a', 'qty', 6),
                        jsonb_build_object('plan_id', v_x ->> 'plan_b', 'qty', 1)),
      jsonb_build_array(jsonb_build_object('plan_id', v_x ->> 'plan_b', 'reason', 'damaged',
                                           'qty_expected', 4, 'qty_actual', 1, 'note', 'смачкани')));
    select ready_qty into v_n from public.delivery_item_plan where id = (v_x ->> 'plan_a')::uuid;
    select ready_qty into v_n2 from public.delivery_item_plan where id = (v_x ->> 'plan_b')::uuid;
    select step || '|' || reason || '|' || qty_expected || '|' || qty_actual || '|' || note into v_txt
      from public.delivery_signals where delivery_id = (v_x ->> 'delivery')::uuid;
    select count(*) into v_n3 from public.delivery_events where delivery_id = (v_x ->> 'delivery')::uuid and type = 'ready';
    select name into v_txt2 from public.stores where id = v_sb;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'Q1 mark_ready_checked: ready rows and a label signal';
    if sqlerrm = 'ROLLBACK' then
      passed := v_n = 6 and v_n2 = 1 and v_n3 = 2 and (v_j ->> 'ready')::int = 7 and (v_j ->> 'signals')::int = 1
                and v_txt = format('label|damaged|4|1|За %s: смачкани', v_txt2);
      detail := format('ready a=%s b=%s events=%s result=%s signal=%s', v_n, v_n2, v_n3, v_j, v_txt);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- Q2 refusals, each leaving nothing behind: an empty checklist, "Друго" without a
  -- note, over the plan, over what was received (only 5 of 10 in Офис), an unknown
  -- reason. A refused call also drops the signals it raised.
  begin
    v_x := pg_temp.p3_delivery(v_admin, v_sa, v_sb, 5);
    begin perform public.mark_ready_checked(v_admin, '[]'::jsonb, '[]'::jsonb);
    exception when others then v_err := sqlerrm; end;
    begin perform public.mark_ready_checked(v_admin, '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('plan_id', v_x ->> 'plan_a', 'reason', 'other', 'qty_expected', 6, 'qty_actual', 0)));
    exception when others then v_err2 := sqlerrm; end;
    begin perform public.mark_ready_checked(v_admin,
      jsonb_build_array(jsonb_build_object('plan_id', v_x ->> 'plan_a', 'qty', 7)), '[]'::jsonb);
    exception when others then v_err3 := sqlerrm; end;
    begin perform public.mark_ready_checked(v_admin,
      jsonb_build_array(jsonb_build_object('plan_id', v_x ->> 'plan_a', 'qty', 5),
                        jsonb_build_object('plan_id', v_x ->> 'plan_b', 'qty', 1)),
      jsonb_build_array(jsonb_build_object('plan_id', v_x ->> 'plan_b', 'reason', 'missing', 'qty_expected', 4, 'qty_actual', 1)));
    exception when others then v_err4 := sqlerrm; end;
    begin perform public.mark_ready_checked(v_admin, '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('plan_id', v_x ->> 'plan_a', 'reason', 'short', 'qty_expected', 6, 'qty_actual', 0)));
    exception when others then v_err5 := sqlerrm; end;
    select coalesce(sum(ready_qty), 0) into v_n from public.delivery_item_plan where delivery_item_id = (v_x ->> 'item')::uuid;
    select count(*) into v_n2 from public.delivery_signals where delivery_id = (v_x ->> 'delivery')::uuid;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'Q2 mark_ready_checked refusals';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like 'Нищо не е отметнато%' and v_err2 like 'За причина „Друго“%'
                and v_err3 like 'Готовите за%надхвърлят плана%' and v_err4 like 'Готови 6 бр.%а са приети само 5 бр.'
                and v_err5 = 'Непозната причина в „Не е наред“' and v_n = 0 and v_n2 = 0;
      detail := format('empty=%s | other=%s | plan=%s | received=%s | reason=%s | ready=%s signals=%s',
                       v_err, v_err2, v_err3, v_err4, v_err5, v_n, v_n2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- Q3 the packing checklist: store A ticked whole (2 boxes); store B packs 1 of 4 with
  -- "Липсва": a pack signal on the shipment, the line lowered to 1, and the 3 missing
  -- units are no longer ready (back to "Етикетиране").
  begin
    v_x := pg_temp.p3_delivery(v_admin, v_sa, v_sb, 10);
    perform public.mark_ready_checked(v_admin,
      jsonb_build_array(jsonb_build_object('plan_id', v_x ->> 'plan_a', 'qty', 6),
                        jsonb_build_object('plan_id', v_x ->> 'plan_b', 'qty', 4)), '[]'::jsonb);
    v_j := public.create_trip(v_admin, array[v_sa, v_sb], 'TEST deliveries');
    v_trip := (v_j ->> 'trip_id')::uuid;
    select id into v_sha from public.shipments where trip_id = v_trip and store_id = v_sa;
    select id into v_shb from public.shipments where trip_id = v_trip and store_id = v_sb;
    select id into v_la from public.shipment_lines where shipment_id = v_sha;
    select id into v_lb from public.shipment_lines where shipment_id = v_shb;
    v_j := public.pack_shipment_checked(v_sha, v_admin, jsonb_build_array(jsonb_build_object('line_id', v_la, 'qty', 6)), 2, '[]'::jsonb);
    v_j2 := public.pack_shipment_checked(v_shb, v_admin, jsonb_build_array(jsonb_build_object('line_id', v_lb, 'qty', 1)), 1,
      jsonb_build_array(jsonb_build_object('line_id', v_lb, 'reason', 'missing', 'qty_expected', 4, 'qty_actual', 1)));
    select string_agg(sh.status || ':' || sh.box_count || ':' || sl.qty, ',' order by s.name) into v_txt
      from public.shipments sh join public.stores s on s.id = sh.store_id join public.shipment_lines sl on sl.shipment_id = sh.id
      where sh.trip_id = v_trip;
    select ready_qty into v_n from public.delivery_item_plan where id = (v_x ->> 'plan_b')::uuid;
    select step || '|' || reason || '|' || (shipment_id = v_shb)::text || '|' || (shipment_line_id = v_lb)::text into v_txt2
      from public.delivery_signals where delivery_id = (v_x ->> 'delivery')::uuid;
    select count(*) into v_n2 from public.delivery_events where trip_id = v_trip and type = 'packed';
    raise exception 'ROLLBACK';
  exception when others then
    test := 'Q3 pack_shipment_checked: ticked, missing un-readies';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = 'packed:2:6,packed:1:1' and v_n = 1 and v_txt2 = 'pack|missing|true|true' and v_n2 = 2
                and (v_j ->> 'units')::int = 6 and (v_j2 ->> 'unready')::int = 3 and (v_j2 ->> 'signals')::int = 1;
      detail := format('shipments=%s ready_b=%s signal=%s packed_events=%s a=%s b=%s', v_txt, v_n, v_txt2, v_n2, v_j, v_j2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- Q4 packing refusals: a line not ticked, a signal on a line packed whole, no boxes,
  -- a shipment already packed. The shipment stays 'packing' with its line.
  begin
    v_x := pg_temp.p3_delivery(v_admin, v_sa, v_sb, 10);
    perform public.mark_ready_checked(v_admin, jsonb_build_array(jsonb_build_object('plan_id', v_x ->> 'plan_a', 'qty', 6)), '[]'::jsonb);
    v_j := public.create_trip(v_admin, array[v_sa], 'TEST deliveries');
    v_trip := (v_j ->> 'trip_id')::uuid;
    select id into v_sha from public.shipments where trip_id = v_trip;
    select id into v_la from public.shipment_lines where shipment_id = v_sha;
    begin perform public.pack_shipment_checked(v_sha, v_admin, '[]'::jsonb, 1, '[]'::jsonb);
    exception when others then v_err := sqlerrm; end;
    begin perform public.pack_shipment_checked(v_sha, v_admin, jsonb_build_array(jsonb_build_object('line_id', v_la, 'qty', 6)), 1,
      jsonb_build_array(jsonb_build_object('line_id', v_la, 'reason', 'damaged', 'qty_expected', 6, 'qty_actual', 6)));
    exception when others then v_err2 := sqlerrm; end;
    begin perform public.pack_shipment_checked(v_sha, v_admin, jsonb_build_array(jsonb_build_object('line_id', v_la, 'qty', 6)), 0, '[]'::jsonb);
    exception when others then v_err3 := sqlerrm; end;
    select status into v_txt from public.shipments where id = v_sha;
    select count(*) into v_n from public.delivery_signals where delivery_id = (v_x ->> 'delivery')::uuid;
    perform public.pack_shipment_checked(v_sha, v_admin, jsonb_build_array(jsonb_build_object('line_id', v_la, 'qty', 6)), 1, '[]'::jsonb);
    begin perform public.pack_shipment_checked(v_sha, v_admin, jsonb_build_array(jsonb_build_object('line_id', v_la, 'qty', 6)), 1, '[]'::jsonb);
    exception when others then v_err4 := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'Q4 pack_shipment_checked refusals';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like 'Отметнете всеки ред на пратката%' and v_err2 like 'При „Не е наред“%'
                and v_err3 = 'Броят кашони трябва да е поне 1' and v_err4 like 'Пратка П-% вече е опакована'
                and v_txt = 'packing' and v_n = 0;
      detail := format('unticked=%s | whole=%s | boxes=%s | again=%s | status=%s signals=%s', v_err, v_err2, v_err3, v_err4, v_txt, v_n);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- Q5 cancel_trip: an open trip with one packed shipment is taken back. Shipments
  -- cancelled, lines gone, a 'cancelled' event with what they held; a new trip takes the
  -- same ready units; packing the cancelled shipment and sending the cancelled trip refuse.
  begin
    v_x := pg_temp.p3_delivery(v_admin, v_sa, v_sb, 10);
    perform public.mark_ready_checked(v_admin,
      jsonb_build_array(jsonb_build_object('plan_id', v_x ->> 'plan_a', 'qty', 6),
                        jsonb_build_object('plan_id', v_x ->> 'plan_b', 'qty', 4)), '[]'::jsonb);
    v_j := public.create_trip(v_admin, array[v_sa, v_sb], 'TEST deliveries');
    v_trip := (v_j ->> 'trip_id')::uuid;
    select id into v_sha from public.shipments where trip_id = v_trip and store_id = v_sa;
    select id into v_la from public.shipment_lines where shipment_id = v_sha;
    perform public.pack_shipment_checked(v_sha, v_admin, jsonb_build_array(jsonb_build_object('line_id', v_la, 'qty', 6)), 1, '[]'::jsonb);
    begin perform public.cancel_trip(v_trip, v_admin, '  ');
    exception when others then v_err := sqlerrm; end;
    perform public.cancel_trip(v_trip, v_admin, 'грешен курс');
    select string_agg(status, ',' order by status) into v_txt from public.shipments where trip_id = v_trip;
    select status || '|' || cancel_reason || '|' || (cancelled_by = v_admin)::text into v_txt2 from public.trips where id = v_trip;
    select count(*) into v_n from public.shipment_lines sl join public.shipments sh on sh.id = sl.shipment_id where sh.trip_id = v_trip;
    select jsonb_array_length(details -> 'shipments') into v_n2 from public.delivery_events where trip_id = v_trip and type = 'cancelled';
    begin perform public.pack_shipment_checked(v_sha, v_admin, '[]'::jsonb, 1, '[]'::jsonb);
    exception when others then v_err2 := sqlerrm; end;
    begin perform public.send_trip(v_trip, v_admin);
    exception when others then v_err3 := sqlerrm; end;
    begin perform public.cancel_trip(v_trip, v_admin, 'пак');
    exception when others then v_err4 := sqlerrm; end;
    v_j2 := public.create_trip(v_admin, array[v_sa, v_sb], 'TEST deliveries');
    v_trip2 := (v_j2 ->> 'trip_id')::uuid;
    select coalesce(sum(sl.qty), 0) into v_n3 from public.shipment_lines sl join public.shipments sh on sh.id = sl.shipment_id where sh.trip_id = v_trip2;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'Q5 cancel_trip frees the ready units';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err = 'Напишете причина' and v_txt = 'cancelled,cancelled' and v_txt2 = 'cancelled|грешен курс|true'
                and v_n = 0 and v_n2 = 2 and v_err2 like 'Курс К-% е отказан%' and v_err3 like 'Курс К-% вече е тръгнал'
                and v_err4 like 'Курс К-% не може да се откаже: той е отказан' and v_n3 = 10;
      detail := format('blank=%s | shipments=%s trip=%s lines=%s event_shipments=%s | pack=%s | send=%s | again=%s | new_trip_units=%s',
                       v_err, v_txt, v_txt2, v_n, v_n2, v_err2, v_err3, v_err4, v_n3);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- Q6 the whole path for one delivery: labelled, packed, sent, both stores confirm.
  -- Store A has its 6, store B its 4, Офис is back to 0, the counter is unchanged at 10,
  -- the trip completes and so does the delivery (everything planned shipped and received).
  begin
    v_x := pg_temp.p3_delivery(v_admin, v_sa, v_sb, 10);
    perform public.mark_ready_checked(v_admin,
      jsonb_build_array(jsonb_build_object('plan_id', v_x ->> 'plan_a', 'qty', 6),
                        jsonb_build_object('plan_id', v_x ->> 'plan_b', 'qty', 4)), '[]'::jsonb);
    v_j := public.create_trip(v_admin, array[v_sa, v_sb], 'TEST deliveries');
    v_trip := (v_j ->> 'trip_id')::uuid;
    select id into v_sha from public.shipments where trip_id = v_trip and store_id = v_sa;
    select id into v_shb from public.shipments where trip_id = v_trip and store_id = v_sb;
    select id into v_la from public.shipment_lines where shipment_id = v_sha;
    select id into v_lb from public.shipment_lines where shipment_id = v_shb;
    perform public.pack_shipment_checked(v_sha, v_admin, jsonb_build_array(jsonb_build_object('line_id', v_la, 'qty', 6)), 1, '[]'::jsonb);
    perform public.pack_shipment_checked(v_shb, v_admin, jsonb_build_array(jsonb_build_object('line_id', v_lb, 'qty', 4)), 1, '[]'::jsonb);
    perform public.send_trip(v_trip, v_admin);
    perform public.confirm_shipment(v_sha, v_admin, jsonb_build_array(jsonb_build_object('line_id', v_la, 'received_qty', 6)));
    perform public.confirm_shipment(v_shb, v_admin, jsonb_build_array(jsonb_build_object('line_id', v_lb, 'received_qty', 4)));
    select coalesce(sum(quantity_remaining) filter (where store_id = v_sa), 0),
           coalesce(sum(quantity_remaining) filter (where store_id = v_sb), 0),
           coalesce(sum(quantity_remaining) filter (where store_id = v_wh), 0)
      into v_n, v_n2, v_n3
      from public.stock_batches where product_id = (v_x ->> 'product')::uuid;
    select quantity_on_hand into v_n4 from public.products where id = (v_x ->> 'product')::uuid;
    select status into v_txt from public.trips where id = v_trip;
    select status into v_txt2 from public.deliveries where id = (v_x ->> 'delivery')::uuid;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'Q6 label -> trip -> pack -> send -> confirm';
    if sqlerrm = 'ROLLBACK' then
      passed := v_n = 6 and v_n2 = 4 and v_n3 = 0 and v_n4 = 10 and v_txt = 'completed' and v_txt2 = 'completed';
      detail := format('store_a=%s store_b=%s office=%s qoh=%s trip=%s delivery=%s', v_n, v_n2, v_n3, v_n4, v_txt, v_txt2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- Q7 only the service role may call the new functions.
  test := 'Q7 anon and authenticated cannot execute the new functions';
  passed := not has_function_privilege('anon', 'public.mark_ready_checked(uuid, jsonb, jsonb)', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.mark_ready_checked(uuid, jsonb, jsonb)', 'EXECUTE')
            and not has_function_privilege('anon', 'public.pack_shipment_checked(uuid, uuid, jsonb, integer, jsonb)', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.pack_shipment_checked(uuid, uuid, jsonb, integer, jsonb)', 'EXECUTE')
            and not has_function_privilege('anon', 'public.cancel_trip(uuid, uuid, text)', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.cancel_trip(uuid, uuid, text)', 'EXECUTE')
            and has_function_privilege('service_role', 'public.mark_ready_checked(uuid, jsonb, jsonb)', 'EXECUTE')
            and has_function_privilege('service_role', 'public.pack_shipment_checked(uuid, uuid, jsonb, integer, jsonb)', 'EXECUTE')
            and has_function_privilege('service_role', 'public.cancel_trip(uuid, uuid, text)', 'EXECUTE');
  detail := 'EXECUTE only for service_role'; return next;

  test := 'Q8 nothing left behind';
  passed := not exists (select 1 from public.products where name = 'TEST deliveries')
            and not exists (select 1 from public.deliveries where notes = 'TEST deliveries')
            and not exists (select 1 from public.trips where notes = 'TEST deliveries');
  detail := 'no TEST products, deliveries or trips remain'; return next;
end $$;

select * from pg_temp.p3_tests();
