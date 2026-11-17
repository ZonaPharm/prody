-- Tests for migration 20261111_deliveries_draft_receive (save_delivery_draft,
-- receive_delivery_checked), on top of the phase 1 delivery migrations.
--
-- Run against STAGING only (SQL Editor or psql on ruhhsixmqusnpiajkbxe), after the
-- migration. Self-contained like deliveries.test.sql: synthetic products named
-- 'TEST deliveries', every scenario ends by raising 'ROLLBACK', so nothing stays.
-- Uses the real active warehouse (Офис), one other active store and an admin.
-- Every row should read passed = true.

create or replace function pg_temp.p2_product(p_needs_label boolean default true)
returns uuid language sql as $$
  insert into public.products (name, status, price, quantity_on_hand, needs_label)
  values ('TEST deliveries', 'inactive', 1, 0, p_needs_label) returning id $$;

create or replace function pg_temp.p2_tests()
returns table(test text, passed boolean, detail text) language plpgsql as $$
declare
  v_admin uuid; v_wh uuid; v_sa uuid; v_sb uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_d uuid; v_d2 uuid; v_i1 uuid; v_i2 uuid; v_i3 uuid;
  v_j jsonb; v_j2 jsonb; v_ts timestamptz; v_ts2 timestamptz;
  v_n int; v_n2 int; v_n3 int; v_n4 int; v_qoh int;
  v_txt text; v_txt2 text; v_err text; v_err2 text; v_err3 text; v_err4 text; v_err5 text; v_err6 text;
  v_ok boolean; v_ok2 boolean;
begin
  select id into v_admin from public.users where role = 'admin'
    order by (email = 'claude.admin@prody.local') desc, created_at limit 1;
  select id into v_wh from public.stores where is_warehouse and is_active;
  select id into v_sa from public.stores where is_active and not coalesce(is_warehouse, false) order by name limit 1;
  select id into v_sb from public.stores where is_active and not coalesce(is_warehouse, false) and id <> v_sa order by name limit 1;

  test := 'P0 fixtures: admin, warehouse, two stores';
  passed := v_admin is not null and v_wh is not null and v_sa is not null and v_sb is not null;
  detail := format('admin=%s wh=%s sa=%s sb=%s', v_admin, v_wh, v_sa, v_sb);
  return next;

  -- P1 a new draft: header, lines in order, plan rows above zero, a 'created'
  -- event, ids returned by key, needs_label remembered on the product.
  begin
    v_p1 := pg_temp.p2_product(true);
    v_p2 := pg_temp.p2_product(true);
    v_j := public.save_delivery_draft(null, v_admin, null, jsonb_build_object(
      'order_ref', ' PO-7 ', 'notes', 'TEST deliveries',
      'items', jsonb_build_array(
        jsonb_build_object('key', 'a', 'product_id', v_p1, 'quantity', 10, 'unit_cost', 2.5, 'doc_number', ' 123 ',
                           'plan', jsonb_build_array(jsonb_build_object('store_id', v_sa, 'planned_qty', 4),
                                                     jsonb_build_object('store_id', v_sb, 'planned_qty', 0))),
        jsonb_build_object('key', 'b', 'product_id', v_p2, 'quantity', 24, 'unit_cost', 1, 'pack_size', 12, 'needs_label', false))));
    v_d := (v_j ->> 'id')::uuid;
    select status || '|' || coalesce(number::text, 'null') || '|' || order_ref || '|' || created_by::text
      into v_txt from public.deliveries where id = v_d;
    select string_agg(p.id::text || ':' || i.quantity || ':' || i.unit_cost || ':' || i.pack_size || ':' || i.sort_order || ':' || coalesce(i.doc_number, '-'), ',' order by i.sort_order)
      into v_txt2 from public.delivery_items i join public.products p on p.id = i.product_id where i.delivery_id = v_d;
    select count(*) into v_n from public.delivery_item_plan pl join public.delivery_items i on i.id = pl.delivery_item_id where i.delivery_id = v_d;
    select count(*) into v_n2 from public.delivery_events where delivery_id = v_d and type = 'created' and created_by = v_admin;
    select count(*) into v_n3 from public.delivery_items i
      where i.delivery_id = v_d and i.id in (select (x ->> 'id')::uuid from jsonb_array_elements(v_j -> 'items') x);
    select needs_label into v_ok from public.products where id = v_p2;
    select count(*) into v_n4 from public.stock_batches where product_id in (v_p1, v_p2);
    raise exception 'ROLLBACK';
  exception when others then
    test := 'P1 save_delivery_draft creates a draft';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = 'draft|null|PO-7|' || v_admin::text
                and v_txt2 = format('%s:10:2.5000:1:1:123,%s:24:1.0000:12:2:-', v_p1, v_p2)
                and v_n = 1 and v_n2 = 1 and v_n3 = 2 and jsonb_array_length(v_j -> 'items') = 2
                and (v_j -> 'items' -> 0 ->> 'key') = 'a' and v_ok = false and v_n4 = 0;
      detail := format('delivery=%s items=%s plan_rows=%s created=%s ids=%s needs_label=%s batches=%s', v_txt, v_txt2, v_n, v_n2, v_n3, v_ok, v_n4);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- P2 overwrite: a listed line is updated in place (same id), a new one is
  -- inserted, an unlisted one is deleted with its plan. (updated_at comes from now(),
  -- which is fixed inside this one test transaction; between real saves it moves.)
  begin
    v_p1 := pg_temp.p2_product(); v_p2 := pg_temp.p2_product(); v_p3 := pg_temp.p2_product();
    v_j := public.save_delivery_draft(null, v_admin, null, jsonb_build_object('notes', 'TEST deliveries', 'items', jsonb_build_array(
      jsonb_build_object('key', 'a', 'product_id', v_p1, 'quantity', 10, 'unit_cost', 1,
                         'plan', jsonb_build_array(jsonb_build_object('store_id', v_sa, 'planned_qty', 4))),
      jsonb_build_object('key', 'b', 'product_id', v_p2, 'quantity', 5, 'unit_cost', 1,
                         'plan', jsonb_build_array(jsonb_build_object('store_id', v_sa, 'planned_qty', 5))))));
    v_d := (v_j ->> 'id')::uuid;
    v_i1 := (v_j -> 'items' -> 0 ->> 'id')::uuid;
    v_i2 := (v_j -> 'items' -> 1 ->> 'id')::uuid;
    v_ts := (v_j ->> 'updated_at')::timestamptz;
    v_j2 := public.save_delivery_draft(v_d, v_admin, v_ts, jsonb_build_object('notes', 'TEST deliveries', 'items', jsonb_build_array(
      jsonb_build_object('key', 'c', 'product_id', v_p3, 'quantity', 3, 'unit_cost', 0),
      jsonb_build_object('id', v_i1, 'key', 'a', 'product_id', v_p1, 'quantity', 12, 'unit_cost', 1.25,
                         'plan', jsonb_build_array(jsonb_build_object('store_id', v_sb, 'planned_qty', 6))))));
    v_ts2 := (v_j2 ->> 'updated_at')::timestamptz;
    select string_agg(i.product_id::text || ':' || i.quantity || ':' || i.sort_order, ',' order by i.sort_order)
      into v_txt from public.delivery_items i where i.delivery_id = v_d;
    select string_agg(pl.store_id::text || ':' || pl.planned_qty, ',') into v_txt2
      from public.delivery_item_plan pl where pl.delivery_item_id = v_i1;
    select count(*) into v_n from public.delivery_items where id = v_i2;
    select count(*) into v_n2 from public.delivery_item_plan pl join public.delivery_items i on i.id = pl.delivery_item_id where i.delivery_id = v_d;
    v_ok := (v_j2 -> 'items' -> 1 ->> 'id')::uuid = v_i1;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'P2 overwrite updates, inserts and deletes lines';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = format('%s:3:1,%s:12:2', v_p3, v_p1) and v_txt2 = v_sb::text || ':6'
                and v_n = 0 and v_n2 = 1 and v_ok and v_ts2 >= v_ts;
      detail := format('items=%s plan_a=%s dropped_left=%s plan_rows=%s same_id=%s ts %s -> %s', v_txt, v_txt2, v_n, v_n2, v_ok, v_ts, v_ts2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- P3 refusals, each leaving the draft as it was: a stale updated_at (someone
  -- else saved), the warehouse in the plan, a store twice in one plan, a line
  -- id of another delivery, a zero quantity, a delivery that is no longer a draft.
  begin
    v_p1 := pg_temp.p2_product();
    v_j := public.save_delivery_draft(null, v_admin, null, jsonb_build_object('notes', 'TEST deliveries', 'items', jsonb_build_array(
      jsonb_build_object('key', 'a', 'product_id', v_p1, 'quantity', 10, 'unit_cost', 1))));
    v_d := (v_j ->> 'id')::uuid;
    v_ts := (v_j ->> 'updated_at')::timestamptz;
    v_j2 := public.save_delivery_draft(null, v_admin, null, jsonb_build_object('notes', 'TEST deliveries', 'items', jsonb_build_array(
      jsonb_build_object('key', 'x', 'product_id', v_p1, 'quantity', 1, 'unit_cost', 1))));
    v_d2 := (v_j2 ->> 'id')::uuid;

    begin perform public.save_delivery_draft(v_d, v_admin, v_ts - interval '1 second', jsonb_build_object('items', '[]'::jsonb)); v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    begin perform public.save_delivery_draft(v_d, v_admin, v_ts, jsonb_build_object('items', jsonb_build_array(
      jsonb_build_object('product_id', v_p1, 'quantity', 10, 'unit_cost', 1, 'plan', jsonb_build_array(jsonb_build_object('store_id', v_wh, 'planned_qty', 2))))));
      v_err2 := 'no error';
    exception when others then v_err2 := sqlerrm; end;
    begin perform public.save_delivery_draft(v_d, v_admin, v_ts, jsonb_build_object('items', jsonb_build_array(
      jsonb_build_object('product_id', v_p1, 'quantity', 10, 'unit_cost', 1, 'plan', jsonb_build_array(
        jsonb_build_object('store_id', v_sa, 'planned_qty', 2), jsonb_build_object('store_id', v_sa, 'planned_qty', 3))))));
      v_err3 := 'no error';
    exception when others then v_err3 := sqlerrm; end;
    begin perform public.save_delivery_draft(v_d, v_admin, v_ts, jsonb_build_object('items', jsonb_build_array(
      jsonb_build_object('id', (v_j2 -> 'items' -> 0 ->> 'id'), 'product_id', v_p1, 'quantity', 10, 'unit_cost', 1))));
      v_err4 := 'no error';
    exception when others then v_err4 := sqlerrm; end;
    begin perform public.save_delivery_draft(v_d, v_admin, v_ts, jsonb_build_object('items', jsonb_build_array(
      jsonb_build_object('product_id', v_p1, 'quantity', 0, 'unit_cost', 1))));
      v_err5 := 'no error';
    exception when others then v_err5 := sqlerrm; end;
    perform public.save_delivery(v_d2, v_admin);
    begin perform public.save_delivery_draft(v_d2, v_admin, null, jsonb_build_object('items', '[]'::jsonb)); v_err6 := 'no error';
    exception when others then v_err6 := sqlerrm; end;

    select count(*), min(quantity) into v_n, v_n2 from public.delivery_items where delivery_id = v_d;
    select updated_at = v_ts into v_ok from public.deliveries where id = v_d;
    select count(*) into v_n3 from public.delivery_items where delivery_id = v_d2;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'P3 draft refusals leave the draft unchanged';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like 'Черновата е променена от друг%'
                and v_err2 like 'Складът%не може да е в плана%'
                and v_err3 like 'Обект се повтаря в плана%'
                and v_err4 = 'Ред от черновата не е от тази доставка'
                and v_err5 like 'Всеки ред трябва да има продукт%'
                and v_err6 like 'Доставката вече не е чернова%'
                and v_n = 1 and v_n2 = 10 and v_ok and v_n3 = 1;
      detail := format('stale=%s | wh=%s | dup=%s | foreign=%s | zero=%s | saved=%s | items=%s qty=%s same_ts=%s other=%s',
                       v_err, v_err2, v_err3, v_err4, v_err5, v_err6, v_n, v_n2, v_ok, v_n3);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- P4 a draft may be over-planned (autosave never loses what was typed);
  -- save_delivery refuses it.
  begin
    v_p1 := pg_temp.p2_product();
    v_j := public.save_delivery_draft(null, v_admin, null, jsonb_build_object('notes', 'TEST deliveries', 'items', jsonb_build_array(
      jsonb_build_object('product_id', v_p1, 'quantity', 5, 'unit_cost', 1, 'plan', jsonb_build_array(jsonb_build_object('store_id', v_sa, 'planned_qty', 9))))));
    v_d := (v_j ->> 'id')::uuid;
    begin perform public.save_delivery(v_d, v_admin); v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'P4 over-planned draft saves, save_delivery refuses it';
    if sqlerrm = 'ROLLBACK' then
      passed := v_d is not null and v_err like 'Разпределени са повече%';
      detail := format('draft=%s save=%s', v_d, v_err);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- P5 one checklist: line 1 fully received, line 2 short (8 of 10, signal),
  -- line 3 missing (signal, nothing in). Stock only for what came; signals open
  -- with the counts; the delivery is in progress.
  begin
    v_p1 := pg_temp.p2_product(); v_p2 := pg_temp.p2_product(); v_p3 := pg_temp.p2_product();
    v_j := public.save_delivery_draft(null, v_admin, null, jsonb_build_object('notes', 'TEST deliveries', 'items', jsonb_build_array(
      jsonb_build_object('key', 1, 'product_id', v_p1, 'quantity', 6, 'unit_cost', 2),
      jsonb_build_object('key', 2, 'product_id', v_p2, 'quantity', 10, 'unit_cost', 3),
      jsonb_build_object('key', 3, 'product_id', v_p3, 'quantity', 4, 'unit_cost', 4))));
    v_d := (v_j ->> 'id')::uuid;
    v_i1 := (v_j -> 'items' -> 0 ->> 'id')::uuid;
    v_i2 := (v_j -> 'items' -> 1 ->> 'id')::uuid;
    v_i3 := (v_j -> 'items' -> 2 ->> 'id')::uuid;
    perform public.save_delivery(v_d, v_admin);
    v_j2 := public.receive_delivery_checked(v_d, v_admin,
      jsonb_build_array(jsonb_build_object('item_id', v_i1, 'qty', 6), jsonb_build_object('item_id', v_i2, 'qty', 8)),
      jsonb_build_array(
        jsonb_build_object('item_id', v_i2, 'reason', 'short', 'qty_expected', 10, 'qty_actual', 8, 'note', 'един кашон'),
        jsonb_build_object('item_id', v_i3, 'reason', 'missing', 'qty_expected', 4, 'qty_actual', 0)));
    select string_agg(i.received_qty::text, ',' order by i.sort_order) into v_txt from public.delivery_items i where i.delivery_id = v_d;
    select coalesce(sum(quantity_remaining), 0) into v_n from public.stock_batches where product_id in (v_p1, v_p2, v_p3) and store_id = v_wh;
    select sum(quantity_on_hand) into v_qoh from public.products where id in (v_p1, v_p2, v_p3);
    select string_agg(reason || ':' || qty_expected || ':' || qty_actual || ':' || status || ':' || step, ',' order by reason) into v_txt2
      from public.delivery_signals where delivery_id = v_d;
    select count(*) into v_n2 from public.delivery_events where delivery_id = v_d and type = 'signal_raised' and created_by = v_admin;
    select count(*) into v_n3 from public.delivery_events where delivery_id = v_d and type = 'received' and created_by = v_admin;
    select status into v_err from public.deliveries where id = v_d;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'P5 receive with signals in one checklist';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = '6,8,0' and v_n = 14 and v_qoh = 14
                and v_txt2 = 'missing:4:0:open:receive,short:10:8:open:receive'
                and v_n2 = 2 and v_n3 = 2 and v_err = 'in_progress'
                and (v_j2 ->> 'received')::int = 14 and (v_j2 ->> 'signals')::int = 2;
      detail := format('received=%s office=%s qoh=%s signals=%s raised_events=%s received_events=%s status=%s result=%s',
                       v_txt, v_n, v_qoh, v_txt2, v_n2, v_n3, v_err, v_j2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- P6 all or nothing: a valid signal with an over-received line raises, and
  -- neither the signal nor any stock stays.
  begin
    v_p1 := pg_temp.p2_product(); v_p2 := pg_temp.p2_product();
    v_j := public.save_delivery_draft(null, v_admin, null, jsonb_build_object('notes', 'TEST deliveries', 'items', jsonb_build_array(
      jsonb_build_object('key', 1, 'product_id', v_p1, 'quantity', 5, 'unit_cost', 1),
      jsonb_build_object('key', 2, 'product_id', v_p2, 'quantity', 5, 'unit_cost', 1))));
    v_d := (v_j ->> 'id')::uuid;
    v_i1 := (v_j -> 'items' -> 0 ->> 'id')::uuid;
    v_i2 := (v_j -> 'items' -> 1 ->> 'id')::uuid;
    perform public.save_delivery(v_d, v_admin);
    begin
      perform public.receive_delivery_checked(v_d, v_admin,
        jsonb_build_array(jsonb_build_object('item_id', v_i1, 'qty', 6)),
        jsonb_build_array(jsonb_build_object('item_id', v_i2, 'reason', 'damaged', 'qty_expected', 5, 'qty_actual', 0)));
      v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    select count(*) into v_n from public.delivery_signals where delivery_id = v_d;
    select count(*) into v_n2 from public.stock_batches where product_id in (v_p1, v_p2);
    select status into v_txt from public.deliveries where id = v_d;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'P6 receive_delivery_checked is all or nothing';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like 'Приемане над доставеното%' and v_n = 0 and v_n2 = 0 and v_txt = 'expected';
      detail := format('error=%s signals=%s batches=%s status=%s', v_err, v_n, v_n2, v_txt);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- P7 refusals: nothing ticked, "Друго" without a note, an unknown reason, a
  -- line of another delivery, a draft.
  begin
    v_p1 := pg_temp.p2_product();
    v_j := public.save_delivery_draft(null, v_admin, null, jsonb_build_object('notes', 'TEST deliveries', 'items', jsonb_build_array(
      jsonb_build_object('key', 1, 'product_id', v_p1, 'quantity', 5, 'unit_cost', 1))));
    v_d := (v_j ->> 'id')::uuid;
    v_i1 := (v_j -> 'items' -> 0 ->> 'id')::uuid;
    begin perform public.receive_delivery_checked(v_d, v_admin, jsonb_build_array(jsonb_build_object('item_id', v_i1, 'qty', 1)), null); v_err6 := 'no error';
    exception when others then v_err6 := sqlerrm; end;
    v_j2 := public.save_delivery_draft(null, v_admin, null, jsonb_build_object('notes', 'TEST deliveries', 'items', jsonb_build_array(
      jsonb_build_object('key', 1, 'product_id', v_p1, 'quantity', 5, 'unit_cost', 1))));
    v_d2 := (v_j2 ->> 'id')::uuid;
    perform public.save_delivery(v_d, v_admin);
    perform public.save_delivery(v_d2, v_admin);
    begin perform public.receive_delivery_checked(v_d, v_admin, '[]'::jsonb, '[]'::jsonb); v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    begin perform public.receive_delivery_checked(v_d, v_admin, null,
      jsonb_build_array(jsonb_build_object('item_id', v_i1, 'reason', 'other', 'note', ' '))); v_err2 := 'no error';
    exception when others then v_err2 := sqlerrm; end;
    begin perform public.receive_delivery_checked(v_d, v_admin, null,
      jsonb_build_array(jsonb_build_object('item_id', v_i1, 'reason', 'partial'))); v_err3 := 'no error';
    exception when others then v_err3 := sqlerrm; end;
    begin perform public.receive_delivery_checked(v_d2, v_admin, null,
      jsonb_build_array(jsonb_build_object('item_id', v_i1, 'reason', 'missing'))); v_err4 := 'no error';
    exception when others then v_err4 := sqlerrm; end;
    select count(*) into v_n from public.delivery_signals where delivery_id in (v_d, v_d2);
    raise exception 'ROLLBACK';
  exception when others then
    test := 'P7 receive_delivery_checked refusals';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like 'Нищо не е отметнато%' and v_err2 like 'За причина „Друго“%'
                and v_err3 = 'Непозната причина в „Не е наред“' and v_err4 = 'Сигнал за ред, който не е от тази доставка'
                and v_err6 like 'Доставката не може да се приема: тя е чернова%' and v_n = 0;
      detail := format('empty=%s | other=%s | partial=%s | foreign=%s | draft=%s | signals=%s', v_err, v_err2, v_err3, v_err4, v_err6, v_n);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- P8 needs_label=false: a received line becomes ready for its plan at once
  -- (through receive_delivery), and a signal-only checklist leaves the
  -- delivery expected with no stock.
  begin
    v_p1 := pg_temp.p2_product(false); v_p2 := pg_temp.p2_product();
    v_j := public.save_delivery_draft(null, v_admin, null, jsonb_build_object('notes', 'TEST deliveries', 'items', jsonb_build_array(
      jsonb_build_object('key', 1, 'product_id', v_p1, 'quantity', 6, 'unit_cost', 1,
                         'plan', jsonb_build_array(jsonb_build_object('store_id', v_sa, 'planned_qty', 4))))));
    v_d := (v_j ->> 'id')::uuid;
    v_i1 := (v_j -> 'items' -> 0 ->> 'id')::uuid;
    perform public.save_delivery(v_d, v_admin);
    v_j2 := public.receive_delivery_checked(v_d, v_admin, jsonb_build_array(jsonb_build_object('item_id', v_i1, 'qty', 6)), '[]'::jsonb);
    select ready_qty into v_n from public.delivery_item_plan where delivery_item_id = v_i1;

    v_j := public.save_delivery_draft(null, v_admin, null, jsonb_build_object('notes', 'TEST deliveries', 'items', jsonb_build_array(
      jsonb_build_object('key', 1, 'product_id', v_p2, 'quantity', 3, 'unit_cost', 1))));
    v_d2 := (v_j ->> 'id')::uuid;
    v_i2 := (v_j -> 'items' -> 0 ->> 'id')::uuid;
    perform public.save_delivery(v_d2, v_admin);
    perform public.receive_delivery_checked(v_d2, v_admin, '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('item_id', v_i2, 'reason', 'wrong_product', 'qty_expected', 3, 'qty_actual', 0)));
    select status into v_txt from public.deliveries where id = v_d2;
    select count(*) into v_n2 from public.stock_batches where product_id = v_p2;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'P8 auto-ready without label; a signal-only checklist moves no stock';
    if sqlerrm = 'ROLLBACK' then
      passed := v_n = 4 and (v_j2 ->> 'auto_ready')::int = 4 and v_txt = 'expected' and v_n2 = 0;
      detail := format('ready=%s result=%s second_status=%s batches=%s', v_n, v_j2, v_txt, v_n2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- P9 only the service role may call the new functions.
  test := 'P9 anon and authenticated cannot execute the new functions';
  passed := not has_function_privilege('anon', 'public.save_delivery_draft(uuid, uuid, timestamptz, jsonb)', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.save_delivery_draft(uuid, uuid, timestamptz, jsonb)', 'EXECUTE')
            and not has_function_privilege('anon', 'public.receive_delivery_checked(uuid, uuid, jsonb, jsonb)', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.receive_delivery_checked(uuid, uuid, jsonb, jsonb)', 'EXECUTE')
            and has_function_privilege('service_role', 'public.save_delivery_draft(uuid, uuid, timestamptz, jsonb)', 'EXECUTE')
            and has_function_privilege('service_role', 'public.receive_delivery_checked(uuid, uuid, jsonb, jsonb)', 'EXECUTE');
  detail := 'EXECUTE only for service_role'; return next;

  test := 'P10 nothing left behind';
  passed := not exists (select 1 from public.products where name = 'TEST deliveries')
            and not exists (select 1 from public.deliveries where notes = 'TEST deliveries');
  detail := 'no TEST products or deliveries remain'; return next;
end $$;

select * from pg_temp.p2_tests();
