-- Tests for migration 20261111_deliveries_label_items (labelling per delivery line, also
-- for the units that stay in Офис), on top of the phase 1, 2 and 3 delivery migrations.
--
-- Run against STAGING only (SQL Editor or psql on ruhhsixmqusnpiajkbxe), after the
-- migration. Self-contained like the other delivery tests: synthetic products named
-- 'TEST deliveries', every scenario ends by raising 'ROLLBACK', so nothing stays.
-- Uses the real active warehouse (Офис), two other active stores and an admin.
-- Every row should read passed = true.

-- A saved delivery of one new product: p_qty units, plan p_a for store A and p_b for
-- store B, p_received of them received into Офис. Returns {delivery, item, plan_a, plan_b}.
create or replace function pg_temp.li_delivery(p_admin uuid, p_sa uuid, p_sb uuid, p_qty int, p_a int, p_b int,
                                               p_received int, p_needs_label boolean default true)
returns jsonb language plpgsql as $$
declare v_p uuid; v_j jsonb; v_d uuid; v_i uuid; v_pa uuid; v_pb uuid;
begin
  insert into public.products (name, status, price, quantity_on_hand, needs_label)
  values ('TEST deliveries', 'inactive', 1, 0, p_needs_label) returning id into v_p;
  v_j := public.save_delivery_draft(null, p_admin, null, jsonb_build_object('notes', 'TEST deliveries', 'items', jsonb_build_array(
    jsonb_build_object('key', 1, 'product_id', v_p, 'quantity', p_qty, 'unit_cost', 2, 'needs_label', p_needs_label,
                       'plan', jsonb_build_array(jsonb_build_object('store_id', p_sa, 'planned_qty', p_a),
                                                 jsonb_build_object('store_id', p_sb, 'planned_qty', p_b))))));
  v_d := (v_j ->> 'id')::uuid;
  v_i := (v_j -> 'items' -> 0 ->> 'id')::uuid;
  perform public.save_delivery(v_d, p_admin);
  if p_received > 0 then
    perform public.receive_delivery_checked(v_d, p_admin, jsonb_build_array(jsonb_build_object('item_id', v_i, 'qty', p_received)), '[]'::jsonb);
  end if;
  select id into v_pa from public.delivery_item_plan where delivery_item_id = v_i and store_id = p_sa;
  select id into v_pb from public.delivery_item_plan where delivery_item_id = v_i and store_id = p_sb;
  return jsonb_build_object('delivery', v_d, 'item', v_i, 'plan_a', v_pa, 'plan_b', v_pb);
end $$;

create or replace function pg_temp.li_label(p_admin uuid, p_item text, p_qty int)
returns jsonb language sql as $$
  select public.label_items_checked(p_admin, jsonb_build_array(jsonb_build_object('item_id', p_item, 'qty', p_qty)), '[]'::jsonb) $$;

-- "ready A,ready B|labelled|unlabelled" of one delivery line.
create or replace function pg_temp.li_state(p_x jsonb)
returns text language sql as $$
  select (select ready_qty from public.delivery_item_plan where id = (p_x ->> 'plan_a')::uuid) || ','
      || (select ready_qty from public.delivery_item_plan where id = (p_x ->> 'plan_b')::uuid) || '|'
      || i.labelled_qty || '|' || i.unlabelled_qty
  from public.delivery_items i where i.id = (p_x ->> 'item')::uuid $$;

create or replace function pg_temp.li_tests()
returns table(test text, passed boolean, detail text) language plpgsql as $$
declare
  v_admin uuid; v_wh uuid; v_sa uuid; v_sb uuid;
  v_x jsonb; v_j jsonb; v_j2 jsonb; v_trip uuid; v_shb uuid; v_lb uuid;
  v_n int; v_n2 int;
  v_txt text; v_txt2 text; v_txt3 text; v_err text; v_err2 text; v_err3 text; v_err4 text;
begin
  select id into v_admin from public.users where role = 'admin'
    order by (email = 'claude.admin@prody.local') desc, created_at limit 1;
  select id into v_wh from public.stores where is_warehouse and is_active;
  select id into v_sa from public.stores where is_active and not coalesce(is_warehouse, false) order by name limit 1;
  select id into v_sb from public.stores where is_active and not coalesce(is_warehouse, false) and id <> v_sa order by name limit 1;

  test := 'L0 fixtures: admin, warehouse, two stores';
  passed := v_admin is not null and v_wh is not null and v_sa is not null and v_sb is not null;
  detail := format('admin=%s wh=%s sa=%s sb=%s', v_admin, v_wh, v_sa, v_sb);
  return next;

  -- L1 all 20 received units wait for a label, though only 10 go to stores; labelling
  -- all 20 makes the 10 ready for the stores and leaves 10 labelled in Офис.
  begin
    v_x := pg_temp.li_delivery(v_admin, v_sa, v_sb, 20, 6, 4, 20);
    v_txt := pg_temp.li_state(v_x);
    v_j := pg_temp.li_label(v_admin, v_x ->> 'item', 20);
    v_txt2 := pg_temp.li_state(v_x);
    select count(*) filter (where type = 'labelled' and qty = 20), count(*) filter (where type = 'ready')
      into v_n, v_n2 from public.delivery_events where delivery_id = (v_x ->> 'delivery')::uuid;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'L1 label every received unit, the stores get theirs';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = '0,0|0|20' and v_txt2 = '6,4|20|0' and v_n = 1 and v_n2 = 2
                and v_j = jsonb_build_object('labelled', 20, 'ready', 10, 'signals', 0);
      detail := format('before=%s after=%s result=%s events labelled=%s ready=%s', v_txt, v_txt2, v_j, v_n, v_n2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- L2 labelling in parts: the stores fill in store-name order, then Офис.
  begin
    v_x := pg_temp.li_delivery(v_admin, v_sa, v_sb, 20, 6, 4, 20);
    perform pg_temp.li_label(v_admin, v_x ->> 'item', 8);
    v_txt := pg_temp.li_state(v_x);
    perform pg_temp.li_label(v_admin, v_x ->> 'item', 5);
    v_txt2 := pg_temp.li_state(v_x);
    raise exception 'ROLLBACK';
  exception when others then
    test := 'L2 labelling in parts';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = '6,2|8|12' and v_txt2 = '6,4|13|7';
      detail := format('after 8=%s after 13=%s', v_txt, v_txt2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- L3 refusals, nothing left behind: empty, more than waits, "Друго" without a note,
  -- an unknown line.
  begin
    v_x := pg_temp.li_delivery(v_admin, v_sa, v_sb, 20, 6, 4, 20);
    begin perform public.label_items_checked(v_admin, '[]'::jsonb, '[]'::jsonb);
    exception when others then v_err := sqlerrm; end;
    begin perform pg_temp.li_label(v_admin, v_x ->> 'item', 21);
    exception when others then v_err2 := sqlerrm; end;
    begin perform public.label_items_checked(v_admin, '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('item_id', v_x ->> 'item', 'reason', 'other', 'qty_expected', 20, 'qty_actual', 0)));
    exception when others then v_err3 := sqlerrm; end;
    begin perform pg_temp.li_label(v_admin, gen_random_uuid()::text, 1);
    exception when others then v_err4 := sqlerrm; end;
    v_txt := pg_temp.li_state(v_x);
    select count(*) into v_n from public.delivery_signals where delivery_id = (v_x ->> 'delivery')::uuid;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'L3 label_items_checked refusals';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like 'Нищо не е отметнато%' and v_err2 = 'За „TEST deliveries“ чакат етикет 20 бр., а отметнатите са 21 бр.'
                and v_err3 like 'За причина „Друго“%' and v_err4 = 'Редът от доставката не е намерен'
                and v_txt = '0,0|0|20' and v_n = 0;
      detail := format('empty=%s | over=%s | other=%s | unknown=%s | state=%s signals=%s', v_err, v_err2, v_err3, v_err4, v_txt, v_n);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- L4 "Не е наред": 15 good labelled, a label signal for the line; 5 stay in the list.
  begin
    v_x := pg_temp.li_delivery(v_admin, v_sa, v_sb, 20, 6, 4, 20);
    v_j := public.label_items_checked(v_admin,
      jsonb_build_array(jsonb_build_object('item_id', v_x ->> 'item', 'qty', 15)),
      jsonb_build_array(jsonb_build_object('item_id', v_x ->> 'item', 'reason', 'damaged', 'qty_expected', 20, 'qty_actual', 15, 'note', 'смачкани')));
    v_txt := pg_temp.li_state(v_x);
    select step || '|' || reason || '|' || qty_expected || '|' || qty_actual || '|' || note || '|' || (delivery_item_id = (v_x ->> 'item')::uuid)
      into v_txt2 from public.delivery_signals where delivery_id = (v_x ->> 'delivery')::uuid;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'L4 a label signal keeps the rest in the list';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = '6,4|15|5' and v_txt2 = 'label|damaged|20|15|смачкани|true' and (v_j ->> 'signals')::int = 1;
      detail := format('state=%s signal=%s result=%s', v_txt, v_txt2, v_j);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- L5 the plan changes after labelling: store A lowered from 6 to 2 (its ready units
  -- follow), store B raised from 4 to 10 and filled at once from the labelled units in Офис.
  begin
    v_x := pg_temp.li_delivery(v_admin, v_sa, v_sb, 20, 6, 4, 20);
    perform pg_temp.li_label(v_admin, v_x ->> 'item', 20);
    perform public.update_plan((v_x ->> 'item')::uuid, v_admin, jsonb_build_array(jsonb_build_object('store_id', v_sa, 'planned_qty', 2)));
    v_txt := pg_temp.li_state(v_x);
    perform public.update_plan((v_x ->> 'item')::uuid, v_admin, jsonb_build_array(jsonb_build_object('store_id', v_sb, 'planned_qty', 10)));
    v_txt2 := pg_temp.li_state(v_x);
    select count(*) into v_n from public.delivery_events
      where delivery_id = (v_x ->> 'delivery')::uuid and type = 'ready' and qty = -4 and (details ->> 'plan')::boolean;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'L5 plan change after labelling moves labelled units';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = '2,4|20|0' and v_txt2 = '2,10|20|0' and v_n = 1;
      detail := format('A to 2=%s B to 10=%s lowered events=%s', v_txt, v_txt2, v_n);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- L6 a plan row cannot go below what sits on a trip that has not left.
  begin
    v_x := pg_temp.li_delivery(v_admin, v_sa, v_sb, 20, 6, 4, 20);
    perform pg_temp.li_label(v_admin, v_x ->> 'item', 20);
    perform public.create_trip(v_admin, array[v_sa], 'TEST deliveries');
    begin perform public.update_plan((v_x ->> 'item')::uuid, v_admin, jsonb_build_array(jsonb_build_object('store_id', v_sa, 'planned_qty', 3)));
    v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    v_txt := pg_temp.li_state(v_x);
    raise exception 'ROLLBACK';
  exception when others then
    test := 'L6 plan not below what is on a trip';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like 'Планът за „TEST deliveries“ към % не може да е под изпратените и сложените в курс: 6 бр., нов план 3 бр.'
                and v_txt = '6,4|20|0';
      detail := format('error=%s state=%s', v_err, v_txt);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- L7 a product without labels: labelled when received, nothing in the list, and a plan
  -- raised later is ready at once.
  begin
    v_x := pg_temp.li_delivery(v_admin, v_sa, v_sb, 20, 6, 4, 20, false);
    v_txt := pg_temp.li_state(v_x);
    perform public.update_plan((v_x ->> 'item')::uuid, v_admin, jsonb_build_array(jsonb_build_object('store_id', v_sb, 'planned_qty', 8)));
    v_txt2 := pg_temp.li_state(v_x);
    raise exception 'ROLLBACK';
  exception when others then
    test := 'L7 no-label product is labelled on receipt';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = '6,4|20|0' and v_txt2 = '6,8|20|0';
      detail := format('received=%s B to 8=%s', v_txt, v_txt2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- L8 packing store B finds 1 of 4 ("Липсва"): the 3 are no longer ready nor labelled,
  -- so they are back in "Етикетиране".
  begin
    v_x := pg_temp.li_delivery(v_admin, v_sa, v_sb, 20, 6, 4, 20);
    perform pg_temp.li_label(v_admin, v_x ->> 'item', 20);
    v_j := public.create_trip(v_admin, array[v_sb], 'TEST deliveries');
    v_trip := (v_j ->> 'trip_id')::uuid;
    select id into v_shb from public.shipments where trip_id = v_trip and store_id = v_sb;
    select id into v_lb from public.shipment_lines where shipment_id = v_shb and delivery_item_id = (v_x ->> 'item')::uuid;
    select jsonb_agg(jsonb_build_object('line_id', id, 'qty', case when id = v_lb then 1 else qty end)) into v_j2
      from public.shipment_lines where shipment_id = v_shb;
    perform public.pack_shipment_checked(v_shb, v_admin, v_j2, 1,
      jsonb_build_array(jsonb_build_object('line_id', v_lb, 'reason', 'missing', 'qty_expected', 4, 'qty_actual', 1)));
    v_txt := pg_temp.li_state(v_x);
    raise exception 'ROLLBACK';
  exception when others then
    test := 'L8 missing at packing goes back to labelling';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = '6,1|17|3';
      detail := format('state=%s', v_txt);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- L9 the older mark_ready keeps labelled >= ready, and still refuses more than received
  -- with its own message.
  begin
    v_x := pg_temp.li_delivery(v_admin, v_sa, v_sb, 20, 6, 4, 5);
    perform public.mark_ready(v_admin, jsonb_build_array(jsonb_build_object('plan_id', v_x ->> 'plan_a', 'qty', 3)));
    v_txt := pg_temp.li_state(v_x);
    begin perform public.mark_ready(v_admin, jsonb_build_array(jsonb_build_object('plan_id', v_x ->> 'plan_a', 'qty', 3)));
    exception when others then v_err := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'L9 mark_ready labels too';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = '3,0|3|2' and v_err = 'Готови 6 бр. от „TEST deliveries“, а са приети само 5 бр.';
      detail := format('state=%s over=%s', v_txt, v_err);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- L10 only the service role may call the new functions.
  test := 'L10 anon and authenticated cannot execute the new functions';
  passed := not has_function_privilege('anon', 'public.label_items_checked(uuid, jsonb, jsonb)', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.label_items_checked(uuid, jsonb, jsonb)', 'EXECUTE')
            and not has_function_privilege('anon', 'public._auto_ready_item(uuid, uuid)', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public._auto_ready_item(uuid, uuid)', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.update_plan(uuid, uuid, jsonb)', 'EXECUTE')
            and has_function_privilege('service_role', 'public.label_items_checked(uuid, jsonb, jsonb)', 'EXECUTE');
  detail := 'EXECUTE only for service_role'; return next;

  test := 'L11 nothing left behind';
  passed := not exists (select 1 from public.products where name = 'TEST deliveries')
            and not exists (select 1 from public.deliveries where notes = 'TEST deliveries')
            and not exists (select 1 from public.trips where notes = 'TEST deliveries');
  detail := 'no TEST products, deliveries or trips remain'; return next;
end $$;

select * from pg_temp.li_tests();
