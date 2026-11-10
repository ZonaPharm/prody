-- Tests for the delivery functions (migration 20261110_deliveries_functions, on top of
-- 20261110_deliveries_schema).
--
-- Run against STAGING only (Supabase MCP execute_sql on ruhhsixmqusnpiajkbxe, or
-- psql). Self-contained: every scenario builds its own synthetic products
-- ('TEST deliveries'), batches, deliveries, trips and shipments inside a block
-- that ends by raising 'ROLLBACK', so nothing is left behind and the outcome
-- does not depend on what stock staging holds. It uses the real stores (the one
-- active warehouse, Офис, and two other stores) and existing users: an admin,
-- a seller with a store (the destination in most scenarios) and a seller of
-- another store. Every row should read passed = true.
--
-- Rolled-back blocks still advance delivery_number_seq, trip_number_seq and
-- shipment_number_seq (sequences are not transactional); that is harmless.
--
-- Not covered here: send_trip racing a sale for the same Офис product. That
-- needs two real sessions (dblink); see the concurrency note in the PR.

-- Fixtures -------------------------------------------------------------------

create or replace function pg_temp.dt_product(p_needs_label boolean default true)
returns uuid language sql as $$
  insert into public.products (name, status, price, quantity_on_hand, needs_label)
  values ('TEST deliveries', 'inactive', 1, 0, p_needs_label) returning id $$;

-- A batch that was there before the delivery, with the counter kept in step.
create or replace function pg_temp.dt_batch(p_product uuid, p_store uuid, p_qty int, p_cost numeric, p_at timestamptz)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.stock_batches (product_id, store_id, quantity_remaining, unit_cost, created_at)
    values (p_product, p_store, p_qty, p_cost, p_at) returning id into v;
  update public.products set quantity_on_hand = quantity_on_hand + p_qty where id = p_product;
  return v;
end $$;

create or replace function pg_temp.dt_delivery(p_user uuid)
returns uuid language sql as $$
  insert into public.deliveries (created_by, notes) values (p_user, 'TEST deliveries') returning id $$;

create or replace function pg_temp.dt_item(p_delivery uuid, p_product uuid, p_qty int, p_cost numeric)
returns uuid language sql as $$
  insert into public.delivery_items (delivery_id, product_id, quantity, unit_cost)
  values (p_delivery, p_product, p_qty, p_cost) returning id $$;

create or replace function pg_temp.dt_plan(p_item uuid, p_store uuid, p_planned int)
returns uuid language sql as $$
  insert into public.delivery_item_plan (delivery_item_id, store_id, planned_qty)
  values (p_item, p_store, p_planned) returning id $$;

-- A saved delivery of one item with one plan row, received and marked ready.
-- Returns the plan row.
create or replace function pg_temp.dt_ready(p_admin uuid, p_product uuid, p_qty int, p_cost numeric,
                                            p_store uuid, p_planned int, p_receive int, p_ready int)
returns uuid language plpgsql as $$
declare v_d uuid; v_i uuid; v_pl uuid;
begin
  v_d := pg_temp.dt_delivery(p_admin);
  v_i := pg_temp.dt_item(v_d, p_product, p_qty, p_cost);
  v_pl := pg_temp.dt_plan(v_i, p_store, p_planned);
  perform public.save_delivery(v_d, p_admin);
  if p_receive > 0 then
    perform public.receive_delivery(v_d, p_admin, jsonb_build_array(jsonb_build_object('item_id', v_i, 'qty', p_receive)));
  end if;
  if p_ready > 0 then
    perform public.mark_ready(p_admin, jsonb_build_array(jsonb_build_object('plan_id', v_pl, 'qty', p_ready)));
  end if;
  return v_pl;
end $$;

create or replace function pg_temp.dt_pack_all(p_trip uuid, p_user uuid)
returns void language plpgsql as $$
declare v uuid;
begin
  for v in select id from public.shipments where trip_id = p_trip order by id loop
    perform public.pack_shipment(v, p_user, '[]'::jsonb, 1);
  end loop;
end $$;

-- Tests ----------------------------------------------------------------------

create or replace function pg_temp.deliveries_tests()
returns table(test text, passed boolean, detail text) language plpgsql as $$
declare
  v_fns constant text[] := array['transfer_stock', 'save_delivery', 'receive_delivery', 'update_plan', 'mark_ready',
                                 'create_trip', 'pack_shipment', 'send_trip', 'confirm_shipment', 'raise_signal',
                                 'resolve_signal', 'cancel_delivery', '_complete_delivery_if_done'];
  v_admin uuid; v_seller uuid; v_other_seller uuid; v_wh uuid; v_sa uuid; v_sb uuid; v_first uuid; v_second uuid;
  v_p1 uuid; v_p2 uuid; v_d1 uuid; v_d2 uuid; v_i1 uuid; v_i2 uuid; v_pl1 uuid; v_pl2 uuid; v_pl3 uuid;
  v_trip uuid; v_ship uuid; v_ship2 uuid; v_line uuid; v_line2 uuid; v_sig uuid; v_sale uuid;
  v_n int; v_n2 int; v_n3 int; v_n4 int; v_qoh int; v_qoh2 int;
  v_j jsonb; v_j2 jsonb; v_txt text; v_txt2 text; v_txt3 text; v_txt4 text; v_txt5 text;
  v_err text; v_err2 text; v_err3 text; v_err4 text; v_ok boolean; v_ok2 boolean; v_ok3 boolean;
begin
  select id into v_admin from public.users where role = 'admin'
    order by (email = 'claude.admin@prody.local') desc, created_at limit 1;
  select id into v_wh from public.stores where is_warehouse and is_active;
  select u.id, u.store_id into v_seller, v_sa from public.users u join public.stores s on s.id = u.store_id
    where u.role = 'seller' and s.is_active and not coalesce(s.is_warehouse, false)
    order by (u.email = 'claude.seller@prody.local') desc, u.created_at limit 1;
  select id into v_sb from public.stores
    where id <> v_sa and is_active and not coalesce(is_warehouse, false) order by name limit 1;
  select id into v_other_seller from public.users
    where role = 'seller' and store_id is distinct from v_sa order by created_at limit 1;
  select id into v_first from public.stores where id in (v_sa, v_sb) order by name, id limit 1;
  v_second := case when v_first = v_sa then v_sb else v_sa end;

  test := 'T0 fixtures: admin, warehouse, two stores, two sellers';
  passed := v_admin is not null and v_wh is not null and v_sa is not null and v_sb is not null
            and v_seller is not null and v_other_seller is not null;
  detail := format('admin=%s wh=%s sa=%s sb=%s seller=%s other_seller=%s', v_admin, v_wh, v_sa, v_sb, v_seller, v_other_seller);
  return next;

  -- T1 save_delivery numbers a draft: expected, a number from the sequence, a
  -- 'saved' event; saving it again is refused.
  begin
    v_p1 := pg_temp.dt_product();
    v_d1 := pg_temp.dt_delivery(v_admin);
    v_i1 := pg_temp.dt_item(v_d1, v_p1, 10, 2.5);
    perform pg_temp.dt_plan(v_i1, v_sa, 6);
    perform pg_temp.dt_plan(v_i1, v_sb, 4);
    v_n := public.save_delivery(v_d1, v_admin);
    select status, number into v_txt, v_n2 from public.deliveries where id = v_d1;
    select count(*) into v_n3 from public.delivery_events
      where delivery_id = v_d1 and type = 'saved' and created_by = v_admin and (details ->> 'number')::int = v_n;
    begin perform public.save_delivery(v_d1, v_admin); v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T1 save numbers a draft';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = 'expected' and v_n = v_n2 and v_n > 0 and v_n3 = 1 and v_err like 'Доставката вече е записана%';
      detail := format('status=%s number=%s/%s saved_events=%s again=%s', v_txt, v_n, v_n2, v_n3, v_err);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T2 save_delivery refuses over-planning, a plan row for the warehouse and an
  -- empty delivery; the draft stays a draft with no number.
  begin
    v_p1 := pg_temp.dt_product();
    v_d1 := pg_temp.dt_delivery(v_admin);
    v_i1 := pg_temp.dt_item(v_d1, v_p1, 10, 2.5);
    v_pl1 := pg_temp.dt_plan(v_i1, v_sa, 7);
    perform pg_temp.dt_plan(v_i1, v_sb, 4);
    begin perform public.save_delivery(v_d1, v_admin); v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    select status || '/' || coalesce(number::text, 'null') into v_txt from public.deliveries where id = v_d1;
    update public.delivery_item_plan set planned_qty = 6 where id = v_pl1;
    perform pg_temp.dt_plan(v_i1, v_wh, 0);
    begin perform public.save_delivery(v_d1, v_admin); v_err2 := 'no error';
    exception when others then v_err2 := sqlerrm; end;
    v_d2 := pg_temp.dt_delivery(v_admin);
    begin perform public.save_delivery(v_d2, v_admin); v_err3 := 'no error';
    exception when others then v_err3 := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T2 save refuses over-planning, the warehouse in the plan, no items';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like 'Разпределени са повече%„TEST deliveries“%план 11 бр., доставка 10 бр.%'
                and v_txt = 'draft/null'
                and v_err2 like 'Складът%не може да е в плана%'
                and v_err3 = 'Доставката няма редове';
      detail := format('over=%s | state=%s | warehouse=%s | empty=%s', v_err, v_txt, v_err2, v_err3);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T3 receiving puts stock into the warehouse: a batch at the item's cost tied
  -- to the item, a restock movement with delivery_id, the counter up, the
  -- product's cost_price set, received_qty up, status in_progress.
  begin
    v_p1 := pg_temp.dt_product();
    perform pg_temp.dt_batch(v_p1, v_wh, 3, 1.00, '2026-01-01');
    v_d1 := pg_temp.dt_delivery(v_admin);
    v_i1 := pg_temp.dt_item(v_d1, v_p1, 10, 2.5);
    perform pg_temp.dt_plan(v_i1, v_sa, 4);
    perform public.save_delivery(v_d1, v_admin);
    v_j := public.receive_delivery(v_d1, v_admin, jsonb_build_array(jsonb_build_object('item_id', v_i1, 'qty', 6)));
    select string_agg(quantity_remaining || '@' || unit_cost::numeric(12,2) || ':' || (delivery_item_id is not distinct from v_i1),
                      ',' order by created_at, id)
      into v_txt from public.stock_batches where product_id = v_p1 and store_id = v_wh;
    select string_agg(type || ':' || quantity || ':' || (delivery_id = v_d1) || ':' || (batch_id is not null), ',')
      into v_txt2 from public.stock_movements where product_id = v_p1;
    select quantity_on_hand, cost_price::numeric(12,2)::text into v_qoh, v_txt3 from public.products where id = v_p1;
    select received_qty into v_n from public.delivery_items where id = v_i1;
    select status into v_txt4 from public.deliveries where id = v_d1;
    select count(*) into v_n2 from public.delivery_events where delivery_id = v_d1 and type = 'received' and qty = 6 and store_id = v_wh;
    perform public.receive_delivery(v_d1, v_admin, jsonb_build_array(jsonb_build_object('item_id', v_i1, 'qty', 4)));
    select received_qty into v_n3 from public.delivery_items where id = v_i1;
    select quantity_on_hand into v_qoh2 from public.products where id = v_p1;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T3 receive into the warehouse moves counter and cost';
    if sqlerrm = 'ROLLBACK' then
      passed := v_j = '{"received": 6, "auto_ready": 0}'::jsonb
                and v_txt = '3@1.00:false,6@2.50:true' and v_txt2 = 'restock:6:true:true'
                and v_qoh = 9 and v_txt3 = '2.50' and v_n = 6 and v_txt4 = 'in_progress' and v_n2 = 1
                and v_n3 = 10 and v_qoh2 = 13;
      detail := format('ret=%s batches=%s movements=%s qoh=%s cost=%s received=%s status=%s events=%s then received=%s qoh=%s',
                       v_j, v_txt, v_txt2, v_qoh, v_txt3, v_n, v_txt4, v_n2, v_n3, v_qoh2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T4 receiving more than ordered is refused and changes nothing; so are a
  -- zero quantity, a line from another delivery and a draft.
  begin
    v_p1 := pg_temp.dt_product();
    v_d1 := pg_temp.dt_delivery(v_admin);
    v_i1 := pg_temp.dt_item(v_d1, v_p1, 10, 2.5);
    perform public.save_delivery(v_d1, v_admin);
    perform public.receive_delivery(v_d1, v_admin, jsonb_build_array(jsonb_build_object('item_id', v_i1, 'qty', 6)));
    begin
      perform public.receive_delivery(v_d1, v_admin, jsonb_build_array(jsonb_build_object('item_id', v_i1, 'qty', 5)));
      v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    select received_qty into v_n from public.delivery_items where id = v_i1;
    select quantity_on_hand into v_qoh from public.products where id = v_p1;
    select count(*) into v_n2 from public.stock_batches where product_id = v_p1;
    begin
      perform public.receive_delivery(v_d1, v_admin, jsonb_build_array(jsonb_build_object('item_id', v_i1, 'qty', 0)));
      v_err2 := 'no error';
    exception when others then v_err2 := sqlerrm; end;
    v_d2 := pg_temp.dt_delivery(v_admin);
    v_i2 := pg_temp.dt_item(v_d2, v_p1, 5, 1);
    begin
      perform public.receive_delivery(v_d1, v_admin, jsonb_build_array(jsonb_build_object('item_id', v_i2, 'qty', 1)));
      v_err3 := 'no error';
    exception when others then v_err3 := sqlerrm; end;
    begin
      perform public.receive_delivery(v_d2, v_admin, jsonb_build_array(jsonb_build_object('item_id', v_i2, 'qty', 1)));
      v_err4 := 'no error';
    exception when others then v_err4 := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T4 receive over quantity raises and changes nothing';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like 'Приемане над доставеното за „TEST deliveries“: в доставката 10 бр., приети 6 бр., сега 5 бр.%'
                and v_n = 6 and v_qoh = 6 and v_n2 = 1
                and v_err2 like '%положително количество%'
                and v_err3 like '%не е от тази доставка%'
                and v_err4 like '%не може да се приема%';
      detail := format('over=%s | received=%s qoh=%s batches=%s | zero=%s | other=%s | draft=%s',
                       v_err, v_n, v_qoh, v_n2, v_err2, v_err3, v_err4);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T5 a product with needs_label = false is ready on receipt: plan rows in
  -- store-name order, each up to its plan, bounded by what was received.
  begin
    v_p1 := pg_temp.dt_product(false);
    v_d1 := pg_temp.dt_delivery(v_admin);
    v_i1 := pg_temp.dt_item(v_d1, v_p1, 10, 2.5);
    v_pl1 := pg_temp.dt_plan(v_i1, v_first, 3);
    v_pl2 := pg_temp.dt_plan(v_i1, v_second, 3);
    perform public.save_delivery(v_d1, v_admin);
    v_j := public.receive_delivery(v_d1, v_admin, jsonb_build_array(jsonb_build_object('item_id', v_i1, 'qty', 4)));
    select string_agg(ready_qty::text, ',' order by (id = v_pl1) desc) into v_txt
      from public.delivery_item_plan where delivery_item_id = v_i1;
    v_j2 := public.receive_delivery(v_d1, v_admin, jsonb_build_array(jsonb_build_object('item_id', v_i1, 'qty', 6)));
    select string_agg(ready_qty::text, ',' order by (id = v_pl1) desc) into v_txt2
      from public.delivery_item_plan where delivery_item_id = v_i1;
    select count(*), sum(qty) into v_n, v_n2 from public.delivery_events where delivery_id = v_d1 and type = 'ready';
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T5 needs_label = false is ready on receipt';
    if sqlerrm = 'ROLLBACK' then
      passed := v_j = '{"received": 4, "auto_ready": 4}'::jsonb and v_txt = '3,1'
                and v_j2 = '{"received": 6, "auto_ready": 2}'::jsonb and v_txt2 = '3,3'
                and v_n = 3 and v_n2 = 6;
      detail := format('first=%s ready=%s | second=%s ready=%s | ready events=%s units=%s', v_j, v_txt, v_j2, v_txt2, v_n, v_n2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T6 mark_ready: not more than received, not below shipped, not above plan;
  -- negative quantities correct.
  begin
    v_p1 := pg_temp.dt_product();
    v_pl1 := pg_temp.dt_ready(v_admin, v_p1, 10, 1, v_sa, 5, 3, 0);
    begin perform public.mark_ready(v_admin, jsonb_build_array(jsonb_build_object('plan_id', v_pl1, 'qty', 4))); v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    perform public.mark_ready(v_admin, jsonb_build_array(jsonb_build_object('plan_id', v_pl1, 'qty', 3)));
    perform public.mark_ready(v_admin, jsonb_build_array(jsonb_build_object('plan_id', v_pl1, 'qty', -1)));
    select ready_qty into v_n from public.delivery_item_plan where id = v_pl1;
    update public.delivery_item_plan set shipped_qty = 2 where id = v_pl1;
    begin perform public.mark_ready(v_admin, jsonb_build_array(jsonb_build_object('plan_id', v_pl1, 'qty', -1))); v_err2 := 'no error';
    exception when others then v_err2 := sqlerrm; end;
    perform public.receive_delivery((select delivery_id from public.delivery_items i join public.delivery_item_plan p on p.delivery_item_id = i.id where p.id = v_pl1),
                                    v_admin, jsonb_build_array(jsonb_build_object('item_id', (select delivery_item_id from public.delivery_item_plan where id = v_pl1), 'qty', 7)));
    begin perform public.mark_ready(v_admin, jsonb_build_array(jsonb_build_object('plan_id', v_pl1, 'qty', 4))); v_err3 := 'no error';
    exception when others then v_err3 := sqlerrm; end;
    select ready_qty into v_n2 from public.delivery_item_plan where id = v_pl1;
    select count(*) into v_n3 from public.delivery_events where plan_id = v_pl1 and type = 'ready';
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T6 mark_ready over received raises, corrections work';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err = 'Готови 4 бр. от „TEST deliveries“, а са приети само 3 бр.' and v_n = 2
                and v_err2 like 'Готовите за „TEST deliveries“ към % не могат да паднат под изпратените: изпратени 2 бр.%'
                and v_err3 like 'Готовите за „TEST deliveries“ към % надхвърлят плана: план 5 бр.%'
                and v_n2 = 2 and v_n3 = 2;
      detail := format('over received=%s | ready=%s | below shipped=%s | over plan=%s | ready=%s events=%s',
                       v_err, v_n, v_err2, v_err3, v_n2, v_n3);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T7 update_plan: below ready raises; a store not in the plan is added from
  -- the unallocated remainder; beyond it raises; the warehouse raises; a
  -- 'plan_changed' event keeps before and after; closed deliveries raise.
  begin
    v_p1 := pg_temp.dt_product();
    v_pl1 := pg_temp.dt_ready(v_admin, v_p1, 10, 1, v_sa, 5, 5, 3);
    select delivery_item_id into v_i1 from public.delivery_item_plan where id = v_pl1;
    select delivery_id into v_d1 from public.delivery_items where id = v_i1;
    begin perform public.update_plan(v_i1, v_admin, jsonb_build_array(jsonb_build_object('store_id', v_sa, 'planned_qty', 2))); v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    perform public.update_plan(v_i1, v_admin, jsonb_build_array(jsonb_build_object('store_id', v_sb, 'planned_qty', 4)));
    select string_agg(planned_qty::text, ',' order by (store_id = v_sa) desc) into v_txt
      from public.delivery_item_plan where delivery_item_id = v_i1;
    begin perform public.update_plan(v_i1, v_admin, jsonb_build_array(jsonb_build_object('store_id', v_sb, 'planned_qty', 6))); v_err2 := 'no error';
    exception when others then v_err2 := sqlerrm; end;
    begin perform public.update_plan(v_i1, v_admin, jsonb_build_array(jsonb_build_object('store_id', v_wh, 'planned_qty', 1))); v_err3 := 'no error';
    exception when others then v_err3 := sqlerrm; end;
    select details into v_j from public.delivery_events where delivery_item_id = v_i1 and type = 'plan_changed';
    update public.deliveries set status = 'completed' where id = v_d1;
    begin perform public.update_plan(v_i1, v_admin, jsonb_build_array(jsonb_build_object('store_id', v_sb, 'planned_qty', 1))); v_err4 := 'no error';
    exception when others then v_err4 := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T7 update_plan below ready raises, off-plan store from remainder works';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like 'Планът за „TEST deliveries“ към % не може да е под готовите: готови 3 бр., нов план 2 бр.'
                and v_txt = '5,4'
                and v_err2 like 'Планът за „TEST deliveries“ става 11 бр., а в доставката има 10 бр.%'
                and v_err3 like 'Складът%не може да е в плана%'
                and v_j -> 'before' = jsonb_build_object(v_sa::text, 5)
                and v_j -> 'after' = jsonb_build_object(v_sa::text, 5, v_sb::text, 4)
                and v_err4 like 'Планът не може да се променя%приключена%';
      detail := format('below ready=%s | plan=%s | over=%s | warehouse=%s | event=%s | closed=%s',
                       v_err, v_txt, v_err2, v_err3, v_j, v_err4);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T8 create_trip collects ready rows for one store from two deliveries
  -- (partially ready counts), skips a store with nothing ready, and a second
  -- trip finds nothing left (already on an unsent shipment).
  begin
    v_p1 := pg_temp.dt_product();
    v_p2 := pg_temp.dt_product();
    v_pl1 := pg_temp.dt_ready(v_admin, v_p1, 10, 1, v_sa, 5, 5, 3);   -- 3 of 5 ready
    v_pl2 := pg_temp.dt_ready(v_admin, v_p2, 10, 1, v_sa, 4, 4, 4);
    v_pl3 := pg_temp.dt_ready(v_admin, v_p2, 10, 1, v_sb, 4, 4, 0);   -- nothing ready for sb
    v_j := public.create_trip(v_admin, array[v_sa, v_sb], 'TEST deliveries');
    v_trip := (v_j ->> 'trip_id')::uuid;
    select count(*) into v_n from public.shipments where trip_id = v_trip;
    select string_agg(sl.qty::text, ',' order by sl.qty) into v_txt
      from public.shipment_lines sl join public.shipments sh on sh.id = sl.shipment_id
      where sh.trip_id = v_trip and sh.store_id = v_sa and sh.status = 'packing';
    select count(distinct i.delivery_id) into v_n2
      from public.shipment_lines sl join public.shipments sh on sh.id = sl.shipment_id
      join public.delivery_items i on i.id = sl.delivery_item_id where sh.trip_id = v_trip;
    select count(*) into v_n3 from public.delivery_events where trip_id = v_trip and type = 'trip_created';
    begin perform public.create_trip(v_admin, array[v_sa], null); v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    begin perform public.create_trip(v_admin, array[v_wh], null); v_err2 := 'no error';
    exception when others then v_err2 := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T8 create_trip collects rows from two deliveries for one store, skips stores with nothing';
    if sqlerrm = 'ROLLBACK' then
      passed := jsonb_array_length(v_j -> 'shipments') = 1 and (v_j -> 'shipments' -> 0 ->> 'store_id')::uuid = v_sa
                and (v_j -> 'shipments' -> 0 ->> 'lines')::int = 2 and (v_j ->> 'number')::int > 0
                and v_n = 1 and v_txt = '3,4' and v_n2 = 2 and v_n3 = 1
                and v_err = 'Няма готови стоки за избраните обекти'
                and v_err2 like 'Складът%не получава пратки%';
      detail := format('ret=%s shipments=%s lines=%s deliveries=%s events=%s | again=%s | warehouse=%s',
                       v_j, v_n, v_txt, v_n2, v_n3, v_err, v_err2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T9 pack_shipment lowers a line, removes a line packed as 0, records boxes
  -- and who packed; over the line or a second time is refused.
  begin
    v_p1 := pg_temp.dt_product();
    v_p2 := pg_temp.dt_product();
    v_pl1 := pg_temp.dt_ready(v_admin, v_p1, 10, 1, v_sa, 5, 5, 3);
    v_pl2 := pg_temp.dt_ready(v_admin, v_p2, 10, 1, v_sa, 4, 4, 4);
    v_j := public.create_trip(v_admin, array[v_sa], null);
    v_ship := (v_j -> 'shipments' -> 0 ->> 'shipment_id')::uuid;
    select id into v_line from public.shipment_lines where shipment_id = v_ship and plan_id = v_pl1;
    select id into v_line2 from public.shipment_lines where shipment_id = v_ship and plan_id = v_pl2;
    begin
      perform public.pack_shipment(v_ship, v_admin, jsonb_build_array(jsonb_build_object('line_id', v_line, 'qty', 4)), 1);
      v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    v_sig := public.raise_signal(v_admin, 'pack', 'missing', null, v_line2, 4, 0, 'TEST deliveries');
    perform public.pack_shipment(v_ship, v_admin,
      jsonb_build_array(jsonb_build_object('line_id', v_line, 'qty', 2), jsonb_build_object('line_id', v_line2, 'qty', 0)), 2);
    select string_agg(qty::text, ',') into v_txt from public.shipment_lines where shipment_id = v_ship;
    select status || ':' || box_count || ':' || (packed_by = v_admin) || ':' || (packed_at is not null)
      into v_txt2 from public.shipments where id = v_ship;
    select (shipment_line_id is null) || ':' || (shipment_id = v_ship) into v_txt3 from public.delivery_signals where id = v_sig;
    select count(*) into v_n from public.delivery_events where shipment_id = v_ship and type = 'packed' and qty = 2;
    begin perform public.pack_shipment(v_ship, v_admin, '[]'::jsonb, 1); v_err2 := 'no error';
    exception when others then v_err2 := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T9 pack_shipment lowers and removes lines, records boxes';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err = 'Опаковани 4 бр. от „TEST deliveries“, а в пратката са 3 бр.'
                and v_txt = '2' and v_txt2 = 'packed:2:true:true' and v_txt3 = 'true:true' and v_n = 1
                and v_err2 like 'Пратка П-% не може да се опакова: тя е опакована';
      detail := format('over=%s | lines=%s shipment=%s signal kept=%s events=%s | again=%s', v_err, v_txt, v_txt2, v_txt3, v_n, v_err2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T10 send_trip moves stock FIFO out of the warehouse (an older batch first,
  -- whatever delivery it came from), each at its own cost, into new store
  -- batches tied to the delivery item; the counter does not move; plan,
  -- shipment and trip counters and statuses are set; 'sent' event.
  begin
    v_p1 := pg_temp.dt_product();
    perform pg_temp.dt_batch(v_p1, v_wh, 2, 1.00, '2026-01-01');
    v_pl1 := pg_temp.dt_ready(v_admin, v_p1, 5, 3.00, v_sa, 5, 5, 5);
    select delivery_item_id into v_i1 from public.delivery_item_plan where id = v_pl1;
    select delivery_id into v_d1 from public.delivery_items where id = v_i1;
    v_j := public.create_trip(v_admin, array[v_sa], null);
    v_trip := (v_j ->> 'trip_id')::uuid;
    v_ship := (v_j -> 'shipments' -> 0 ->> 'shipment_id')::uuid;
    perform pg_temp.dt_pack_all(v_trip, v_admin);
    v_j2 := public.send_trip(v_trip, v_seller);
    select string_agg(quantity_remaining || '@' || unit_cost::numeric(12,2), ',' order by created_at, id)
      into v_txt from public.stock_batches where product_id = v_p1 and store_id = v_wh;
    select string_agg(quantity_remaining || '@' || unit_cost::numeric(12,2) || ':' || (delivery_item_id is not distinct from v_i1), ',' order by created_at, id)
      into v_txt2 from public.stock_batches where product_id = v_p1 and store_id = v_sa;
    select string_agg(type || ':' || quantity || '@' || unit_cost::numeric(12,2), ',' order by type, quantity)
      into v_txt3 from public.stock_movements
      where product_id = v_p1 and shipment_id = v_ship and delivery_id = v_d1
        and ((type = 'transfer_out' and store_id = v_wh and source_store_id = v_sa)
          or (type = 'transfer_in' and store_id = v_sa and source_store_id = v_wh));
    select quantity_on_hand into v_qoh from public.products where id = v_p1;
    select shipped_qty into v_n from public.delivery_item_plan where id = v_pl1;
    select status || ':' || (sent_by = v_seller) || ':' || (sent_at is not null) into v_txt4 from public.shipments where id = v_ship;
    select status || ':' || (driver_id = v_seller) || ':' || (departed_at is not null) into v_txt5 from public.trips where id = v_trip;
    select count(*) into v_n2 from public.delivery_events where shipment_id = v_ship and type = 'sent' and qty = 5 and created_by = v_seller;
    begin perform public.send_trip(v_trip, v_seller); v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T10 send_trip moves stock FIFO from the warehouse, keeps the counter, sets counters';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = '0@1.00,2@3.00' and v_txt2 = '2@1.00:true,3@3.00:true'
                and v_txt3 = 'transfer_in:2@1.00,transfer_in:3@3.00,transfer_out:-3@3.00,transfer_out:-2@1.00'
                and v_qoh = 7 and v_n = 5 and v_txt4 = 'sent:true:true' and v_txt5 = 'departed:true:true' and v_n2 = 1
                and (v_j2 ->> 'units')::int = 5
                and v_err like 'Курс К-% вече е тръгнал%';
      detail := format('ret=%s wh=%s store=%s movements=%s qoh=%s shipped=%s shipment=%s trip=%s events=%s again=%s',
                       v_j2, v_txt, v_txt2, v_txt3, v_qoh, v_n, v_txt4, v_txt5, v_n2, v_err);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T11 the warehouse sold the units between packing and sending: send_trip
  -- names the product, needed and available, and nothing changes.
  begin
    v_p1 := pg_temp.dt_product();
    v_pl1 := pg_temp.dt_ready(v_admin, v_p1, 5, 3.00, v_sa, 5, 5, 5);
    v_j := public.create_trip(v_admin, array[v_sa], null);
    v_trip := (v_j ->> 'trip_id')::uuid;
    v_ship := (v_j -> 'shipments' -> 0 ->> 'shipment_id')::uuid;
    perform pg_temp.dt_pack_all(v_trip, v_admin);
    insert into public.sales (product_id, store_id, sold_by, quantity, sale_price, sale_group_id)
      values (v_p1, v_wh, v_admin, 4, 1.00, gen_random_uuid()) returning id into v_sale;
    perform public.sell_from_batches(v_p1, v_wh, 4, 1.00, v_sale, v_admin);
    begin perform public.send_trip(v_trip, v_admin); v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    select string_agg(quantity_remaining::text, ',') into v_txt from public.stock_batches where product_id = v_p1 and store_id = v_wh;
    select count(*) into v_n from public.stock_batches where product_id = v_p1 and store_id <> v_wh;
    select count(*) into v_n2 from public.stock_movements where product_id = v_p1 and type like 'transfer%';
    select shipped_qty into v_n3 from public.delivery_item_plan where id = v_pl1;
    select (select status from public.shipments where id = v_ship) || ':' || status into v_txt2 from public.trips where id = v_trip;
    select quantity_on_hand into v_qoh from public.products where id = v_p1;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T11 send_trip raises when the warehouse sold out in between and changes nothing';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like 'Недостатъчна наличност в % за „TEST deliveries“: нужни 5 бр., налични 1 бр.'
                and v_txt = '1' and v_n = 0 and v_n2 = 0 and v_n3 = 0 and v_txt2 = 'packed:open' and v_qoh = 1;
      detail := format('error=%s wh=%s other batches=%s transfers=%s shipped=%s state=%s qoh=%s',
                       v_err, v_txt, v_n, v_n2, v_n3, v_txt2, v_qoh);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T12-T15 the store confirms a short line: a store_receive signal, the
  -- missing units leave the store (FIFO, correction movements, counter down),
  -- received_with_issues, trip completed, delivery not completed while the
  -- signal is open. A seller cannot resolve; an admin resolving 'found' puts
  -- the units back at the item's cost, and the delivery completes.
  begin
    v_p1 := pg_temp.dt_product();
    v_pl1 := pg_temp.dt_ready(v_admin, v_p1, 5, 3.00, v_sa, 5, 5, 5);
    select delivery_item_id into v_i1 from public.delivery_item_plan where id = v_pl1;
    select delivery_id into v_d1 from public.delivery_items where id = v_i1;
    v_j := public.create_trip(v_admin, array[v_sa], null);
    v_trip := (v_j ->> 'trip_id')::uuid;
    v_ship := (v_j -> 'shipments' -> 0 ->> 'shipment_id')::uuid;
    perform pg_temp.dt_pack_all(v_trip, v_admin);
    perform public.send_trip(v_trip, v_admin);
    select id into v_line from public.shipment_lines where shipment_id = v_ship;
    begin
      perform public.confirm_shipment(v_ship, v_other_seller, jsonb_build_array(jsonb_build_object('line_id', v_line, 'received_qty', 5)));
      v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    begin
      perform public.confirm_shipment(v_ship, v_seller, '[]'::jsonb);
      v_err2 := 'no error';
    exception when others then v_err2 := sqlerrm; end;
    v_j := public.confirm_shipment(v_ship, v_seller,
      jsonb_build_array(jsonb_build_object('line_id', v_line, 'received_qty', 3, 'note', 'TEST deliveries')));
    select id, step || ':' || reason || ':' || qty_expected || ':' || qty_actual || ':' || status || ':' || (delivery_id = v_d1)
              || ':' || (shipment_line_id = v_line) || ':' || coalesce(note, '')
      into v_sig, v_txt from public.delivery_signals where shipment_id = v_ship;
    select coalesce(sum(quantity_remaining), 0) into v_n from public.stock_batches where product_id = v_p1 and store_id = v_sa;
    select string_agg(quantity::text, ',') into v_txt2 from public.stock_movements
      where product_id = v_p1 and store_id = v_sa and type = 'correction' and shipment_id = v_ship;
    select quantity_on_hand into v_qoh from public.products where id = v_p1;
    select sh.status || ':' || (sh.received_by = v_seller) || ':' || t.status || ':' || (t.completed_at is not null)
      into v_txt3 from public.shipments sh join public.trips t on t.id = sh.trip_id where sh.id = v_ship;
    select status into v_txt4 from public.deliveries where id = v_d1;
    select received_qty into v_n2 from public.shipment_lines where id = v_line;
    select count(*) into v_n3 from public.delivery_events where shipment_id = v_ship and type = 'store_received';
    begin perform public.resolve_signal(v_sig, v_seller, 'found', null); v_err3 := 'no error';
    exception when others then v_err3 := sqlerrm; end;
    perform public.resolve_signal(v_sig, v_admin, 'found', 'TEST deliveries');
    select coalesce(sum(quantity_remaining), 0) into v_n4 from public.stock_batches where product_id = v_p1 and store_id = v_sa;
    select string_agg(quantity || '@' || unit_cost::numeric(12,2), ',') into v_txt5 from public.stock_movements
      where product_id = v_p1 and store_id = v_sa and type = 'correction' and quantity > 0 and shipment_id = v_ship and delivery_id = v_d1;
    select quantity_on_hand into v_qoh2 from public.products where id = v_p1;
    select status = 'resolved' and resolution = 'found' and resolved_by = v_admin and resolved_at is not null
      into v_ok from public.delivery_signals where id = v_sig;
    select status = 'completed' and completed_at is not null into v_ok2 from public.deliveries where id = v_d1;
    select count(*) = 1 into v_ok3 from public.delivery_events where delivery_id = v_d1 and type = 'completed';
    begin perform public.resolve_signal(v_sig, v_admin, 'found', null); v_err4 := 'no error';
    exception when others then v_err4 := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    if sqlerrm = 'ROLLBACK' then
      test := 'T12 confirm_shipment: only the store or an admin, every line listed';
      passed := v_err like 'Само обект % или администратор може да потвърди пратка П-%'
                and v_err2 like 'Липсват редове от пратката%';
      detail := format('other store=%s | missing lines=%s', v_err, v_err2); return next;
      test := 'T13 confirm_shipment short line creates a signal and removes the units from the store';
      passed := v_txt = 'store_receive:short:5:3:open:true:true:TEST deliveries' and v_n = 3 and v_txt2 = '-2' and v_qoh = 3
                and v_txt3 = 'received_with_issues:true:completed:true' and v_txt4 = 'in_progress' and v_n2 = 3 and v_n3 = 1
                and (v_j ->> 'status') = 'received_with_issues';
      detail := format('ret=%s signal=%s store=%s corrections=%s qoh=%s shipment/trip=%s delivery=%s line received=%s events=%s',
                       v_j, v_txt, v_n, v_txt2, v_qoh, v_txt3, v_txt4, v_n2, v_n3); return next;
      test := 'T14 resolve found puts the units back; only an admin resolves';
      passed := v_err3 = 'Само администратор може да решава сигнали' and v_n4 = 5 and v_txt5 = '2@3.00' and v_qoh2 = 5 and v_ok
                and v_err4 = 'Сигналът вече е решен';
      detail := format('seller=%s store=%s back=%s qoh=%s resolved=%s again=%s', v_err3, v_n4, v_txt5, v_qoh2, v_ok, v_err4); return next;
      test := 'T15 completion after the last signal is resolved';
      passed := v_ok2 and v_ok3; detail := format('completed=%s event=%s', v_ok2, v_ok3); return next;
    else
      test := 'T12-T15 confirm, signal, resolve, completion'; passed := false; detail := 'unexpected: ' || sqlerrm; return next;
    end if;
  end;

  -- T16 completion needs everything: an item not fully received keeps the
  -- delivery open after a clean confirmation; a full one completes at once.
  begin
    v_p1 := pg_temp.dt_product();
    v_p2 := pg_temp.dt_product();
    v_pl1 := pg_temp.dt_ready(v_admin, v_p1, 10, 1, v_sa, 4, 4, 4);    -- 4 of 10 received
    v_pl2 := pg_temp.dt_ready(v_admin, v_p2, 4, 1, v_sa, 4, 4, 4);     -- complete
    v_j := public.create_trip(v_admin, array[v_sa], null);
    v_trip := (v_j ->> 'trip_id')::uuid;
    v_ship := (v_j -> 'shipments' -> 0 ->> 'shipment_id')::uuid;
    perform pg_temp.dt_pack_all(v_trip, v_admin);
    perform public.send_trip(v_trip, v_admin);
    select jsonb_agg(jsonb_build_object('line_id', id, 'received_qty', qty)) into v_j2 from public.shipment_lines where shipment_id = v_ship;
    v_j := public.confirm_shipment(v_ship, v_admin, v_j2);
    select d.status into v_txt from public.deliveries d join public.delivery_items i on i.delivery_id = d.id
      join public.delivery_item_plan p on p.delivery_item_id = i.id where p.id = v_pl1;
    select d.status into v_txt2 from public.deliveries d join public.delivery_items i on i.delivery_id = d.id
      join public.delivery_item_plan p on p.delivery_item_id = i.id where p.id = v_pl2;
    select status into v_txt3 from public.shipments where id = v_ship;
    select count(*) into v_n from public.delivery_signals where shipment_id = v_ship;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T16 completion only when fully received, shipped and confirmed';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = 'in_progress' and v_txt2 = 'completed' and v_txt3 = 'received' and v_n = 0;
      detail := format('partial=%s full=%s shipment=%s signals=%s', v_txt, v_txt2, v_txt3, v_n);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T17 cancel: a draft is simply cancelled; a received delivery takes its
  -- stock back out of the warehouse with delivery_cancel movements; after a
  -- sale from its batch, or after shipping, it is refused.
  begin
    v_d1 := pg_temp.dt_delivery(v_admin);
    perform public.cancel_delivery(v_d1, v_admin, 'TEST deliveries');
    select status || ':' || (cancelled_by = v_admin) || ':' || cancel_reason into v_txt from public.deliveries where id = v_d1;

    v_p1 := pg_temp.dt_product();
    perform pg_temp.dt_batch(v_p1, v_wh, 2, 1.00, '2026-01-01');
    v_pl1 := pg_temp.dt_ready(v_admin, v_p1, 10, 3.00, v_sa, 5, 6, 0);
    select i.delivery_id into v_d2 from public.delivery_items i join public.delivery_item_plan p on p.delivery_item_id = i.id where p.id = v_pl1;
    begin perform public.cancel_delivery(v_d2, v_admin, ' '); v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    perform public.cancel_delivery(v_d2, v_admin, 'TEST deliveries');
    select string_agg(quantity_remaining::text, ',' order by created_at, id) into v_txt2 from public.stock_batches where product_id = v_p1;
    select string_agg(quantity || ':' || (delivery_id = v_d2), ',') into v_txt3 from public.stock_movements
      where product_id = v_p1 and type = 'delivery_cancel';
    select quantity_on_hand into v_qoh from public.products where id = v_p1;
    select status into v_txt4 from public.deliveries where id = v_d2;
    select count(*) into v_n from public.delivery_events where delivery_id = v_d2 and type = 'cancelled' and qty = 6;
    begin perform public.cancel_delivery(v_d2, v_admin, 'again'); v_err2 := 'no error';
    exception when others then v_err2 := sqlerrm; end;

    -- one unit of the delivery's batch sold from the warehouse
    v_p2 := pg_temp.dt_product();
    v_pl2 := pg_temp.dt_ready(v_admin, v_p2, 10, 3.00, v_sa, 5, 6, 0);
    select i.delivery_id into v_d1 from public.delivery_items i join public.delivery_item_plan p on p.delivery_item_id = i.id where p.id = v_pl2;
    insert into public.sales (product_id, store_id, sold_by, quantity, sale_price, sale_group_id)
      values (v_p2, v_wh, v_admin, 1, 1.00, gen_random_uuid()) returning id into v_sale;
    perform public.sell_from_batches(v_p2, v_wh, 1, 1.00, v_sale, v_admin);
    begin perform public.cancel_delivery(v_d1, v_admin, 'TEST deliveries'); v_err3 := 'no error';
    exception when others then v_err3 := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T17 cancel a draft and a received delivery; refused after a sale from its batch';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = 'cancelled:true:TEST deliveries'
                and v_err = 'Посочете причина за отказа'
                and v_txt2 = '2,0' and v_txt3 = '-6:true' and v_qoh = 2 and v_txt4 = 'cancelled' and v_n = 1
                and v_err2 like 'Доставка Д-% е отказана и не може да се откаже'
                and v_err3 like 'Доставката не може да се откаже: от „TEST deliveries“ са приети 6 бр., а в % от тази доставка са останали 5 бр.%';
      detail := format('draft=%s | no reason=%s | batches=%s cancel movements=%s qoh=%s status=%s events=%s | again=%s | after sale=%s',
                       v_txt, v_err, v_txt2, v_txt3, v_qoh, v_txt4, v_n, v_err2, v_err3);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  begin
    v_p1 := pg_temp.dt_product();
    v_pl1 := pg_temp.dt_ready(v_admin, v_p1, 5, 3.00, v_sa, 5, 5, 5);
    select i.delivery_id into v_d1 from public.delivery_items i join public.delivery_item_plan p on p.delivery_item_id = i.id where p.id = v_pl1;
    v_j := public.create_trip(v_admin, array[v_sa], null);
    v_trip := (v_j ->> 'trip_id')::uuid;
    begin perform public.cancel_delivery(v_d1, v_admin, 'TEST deliveries'); v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    perform pg_temp.dt_pack_all(v_trip, v_admin);
    perform public.send_trip(v_trip, v_admin);
    begin perform public.cancel_delivery(v_d1, v_admin, 'TEST deliveries'); v_err2 := 'no error';
    exception when others then v_err2 := sqlerrm; end;
    select status into v_txt from public.deliveries where id = v_d1;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T18 cancel refused while on an unsent trip and after shipping';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like 'Доставката е в курс К-%, който още не е тръгнал%'
                and v_err2 like 'Доставката не може да се откаже: „TEST deliveries“ вече е изпратена към обектите (5 бр.)'
                and v_txt = 'in_progress';
      detail := format('unsent=%s | shipped=%s | status=%s', v_err, v_err2, v_txt);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T19 transfer_stock: FIFO from the source store, each part at its own cost
  -- into a new batch at the target, transfer_out / transfer_in with
  -- source_store_id as before, the counter unchanged; same store, too much
  -- and zero are refused.
  begin
    v_p1 := pg_temp.dt_product();
    perform pg_temp.dt_batch(v_p1, v_sa, 2, 1.00, '2026-01-01');
    perform pg_temp.dt_batch(v_p1, v_sa, 5, 3.00, '2026-01-02');
    perform pg_temp.dt_batch(v_p1, v_sb, 1, 9.00, '2025-01-01');
    v_n := public.transfer_stock(v_p1, v_sa, v_sb, 4, v_admin, 'TEST deliveries');
    select string_agg(quantity_remaining || '@' || unit_cost::numeric(12,2), ',' order by created_at, id)
      into v_txt from public.stock_batches where product_id = v_p1 and store_id = v_sa;
    select string_agg(quantity_remaining || '@' || unit_cost::numeric(12,2), ',' order by created_at, id)
      into v_txt2 from public.stock_batches where product_id = v_p1 and store_id = v_sb;
    select string_agg(type || ':' || quantity || '@' || unit_cost::numeric(12,2) || ':' || coalesce(notes, ''), ',' order by type, abs(quantity), unit_cost)
      into v_txt3 from public.stock_movements
      where product_id = v_p1 and created_by = v_admin and batch_id is not null
        and ((type = 'transfer_out' and store_id = v_sa and source_store_id = v_sb)
          or (type = 'transfer_in' and store_id = v_sb and source_store_id = v_sa));
    select quantity_on_hand into v_qoh from public.products where id = v_p1;
    begin perform public.transfer_stock(v_p1, v_sa, v_sa, 1, v_admin); v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    begin perform public.transfer_stock(v_p1, v_sa, v_sb, 4, v_admin); v_err2 := 'no error';
    exception when others then v_err2 := sqlerrm; end;
    select string_agg(quantity_remaining::text, ',' order by created_at, id) into v_txt4 from public.stock_batches where product_id = v_p1 and store_id = v_sa;
    begin perform public.transfer_stock(v_p1, v_sa, v_sb, 0, v_admin); v_err3 := 'no error';
    exception when others then v_err3 := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T19 transfer_stock FIFO, same-store and shortfall errors';
    if sqlerrm = 'ROLLBACK' then
      passed := v_n = 2 and v_txt = '0@1.00,3@3.00' and v_txt2 = '1@9.00,2@1.00,2@3.00'
                and v_txt3 = 'transfer_in:2@1.00:TEST deliveries,transfer_in:2@3.00:TEST deliveries,'
                             || 'transfer_out:-2@1.00:TEST deliveries,transfer_out:-2@3.00:TEST deliveries'
                and v_qoh = 8
                and v_err like 'Същият обект%'
                and v_err2 like 'Недостатъчна наличност на „TEST deliveries“ в %: налични 3 бр., поискани 4 бр.'
                and v_txt4 = '0,3'
                and v_err3 like 'Количеството трябва да е положително%';
      detail := format('touched=%s from=%s to=%s movements=%s qoh=%s | same=%s | short=%s from after=%s | zero=%s',
                       v_n, v_txt, v_txt2, v_txt3, v_qoh, v_err, v_err2, v_txt4, v_err3);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T20 raise_signal for receive/label/pack (no stock change), refused for
  -- store_receive; resolve with anything but 'found' changes no stock.
  begin
    v_p1 := pg_temp.dt_product();
    v_pl1 := pg_temp.dt_ready(v_admin, v_p1, 10, 1, v_sa, 5, 5, 0);
    select delivery_item_id into v_i1 from public.delivery_item_plan where id = v_pl1;
    select delivery_id into v_d1 from public.delivery_items where id = v_i1;
    select quantity_on_hand into v_qoh from public.products where id = v_p1;
    v_sig := public.raise_signal(v_admin, 'label', 'wrong_label', v_i1, null, 5, 4, 'TEST deliveries');
    select step || ':' || reason || ':' || status || ':' || (delivery_id = v_d1) into v_txt from public.delivery_signals where id = v_sig;
    select count(*) into v_n from public.delivery_events where signal_id = v_sig and type = 'signal_raised';
    begin perform public.raise_signal(v_admin, 'store_receive', 'short', v_i1, null, 1, 0, null); v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    begin perform public.raise_signal(v_admin, 'label', 'nope', v_i1, null, 1, 0, null); v_err2 := 'no error';
    exception when others then v_err2 := sqlerrm; end;
    perform public.resolve_signal(v_sig, v_admin, 'corrected', 'TEST deliveries');
    select quantity_on_hand into v_qoh2 from public.products where id = v_p1;
    select status || ':' || resolution into v_txt2 from public.delivery_signals where id = v_sig;
    select count(*) into v_n2 from public.delivery_events where signal_id = v_sig and type = 'signal_resolved';
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T20 raise_signal and a non-found resolution change no stock';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = 'label:wrong_label:open:true' and v_n = 1
                and v_err like 'Сигнал от обекта се подава при потвърждаване на пратката%'
                and v_err2 like 'Непозната причина%'
                and v_qoh = 5 and v_qoh2 = 5 and v_txt2 = 'resolved:corrected' and v_n2 = 1;
      detail := format('signal=%s events=%s | store_receive=%s | bad reason=%s | qoh %s -> %s resolved=%s events=%s',
                       v_txt, v_n, v_err, v_err2, v_qoh, v_qoh2, v_txt2, v_n2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T21 delivery_events is append-only, also for rows the functions wrote.
  begin
    v_d1 := pg_temp.dt_delivery(v_admin);
    perform public.cancel_delivery(v_d1, v_admin, 'TEST deliveries');
    begin update public.delivery_events set qty = 1 where delivery_id = v_d1; v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    begin delete from public.delivery_events where delivery_id = v_d1; v_err2 := 'no error';
    exception when others then v_err2 := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T21 delivery_events update and delete raise';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err = 'delivery_events is append-only' and v_err2 = 'delivery_events is append-only';
      detail := format('update=%s delete=%s', v_err, v_err2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T22 the thirteen functions: one overload each, SECURITY INVOKER,
  -- search_path '', EXECUTE for service_role only.
  select count(*),
         string_agg(p.proname, ',') filter (where has_function_privilege('anon', p.oid, 'EXECUTE')
                                               or has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                               or not has_function_privilege('service_role', p.oid, 'EXECUTE')
                                               or p.prosecdef
                                               or not coalesce(p.proconfig @> array['search_path=""'], false)),
         count(distinct p.proname)
    into v_n, v_txt, v_n2
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(v_fns);
  test := 'T22 thirteen functions, service_role only, invoker, empty search_path';
  passed := v_n = 13 and v_n2 = 13 and v_txt is null;
  detail := format('functions=%s distinct=%s offenders=%s', v_n, v_n2, coalesce(v_txt, 'none')); return next;

  begin
    set local role anon;
    perform public.save_delivery(gen_random_uuid(), v_admin);
    reset role;
    test := 'T23 anon cannot execute'; passed := false; detail := 'anon could execute'; return next;
  exception when others then
    reset role;
    test := 'T23 anon cannot execute'; passed := sqlstate = '42501'; detail := sqlstate || ' ' || sqlerrm; return next;
  end;
  begin
    set local role authenticated;
    perform public.transfer_stock(gen_random_uuid(), v_sa, v_sb, 1, v_admin);
    reset role;
    test := 'T24 authenticated cannot execute'; passed := false; detail := 'authenticated could execute'; return next;
  exception when others then
    reset role;
    test := 'T24 authenticated cannot execute'; passed := sqlstate = '42501'; detail := sqlstate || ' ' || sqlerrm; return next;
  end;

  -- T25 a seller sees only own-store shipments and their lines, and nothing of
  -- deliveries, plans, signals or events; an admin sees both shipments.
  begin
    v_p1 := pg_temp.dt_product();
    v_pl1 := pg_temp.dt_ready(v_admin, v_p1, 10, 1, v_sa, 4, 8, 4);
    v_pl2 := pg_temp.dt_plan((select delivery_item_id from public.delivery_item_plan where id = v_pl1), v_sb, 4);
    perform public.mark_ready(v_admin, jsonb_build_array(jsonb_build_object('plan_id', v_pl2, 'qty', 4)));
    perform public.raise_signal(v_admin, 'label', 'other', (select delivery_item_id from public.delivery_item_plan where id = v_pl1), null, null, null, null);
    v_j := public.create_trip(v_admin, array[v_sa, v_sb], null);
    v_trip := (v_j ->> 'trip_id')::uuid;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
    select count(*), count(*) filter (where store_id = v_sa) into v_n, v_n2 from public.shipments where trip_id = v_trip;
    select count(*) into v_n3 from public.shipment_lines sl where sl.plan_id in (v_pl1, v_pl2);
    select (select count(*) from public.deliveries) + (select count(*) from public.delivery_items)
           + (select count(*) from public.delivery_item_plan) + (select count(*) from public.delivery_signals)
           + (select count(*) from public.delivery_events) + (select count(*) from public.trips)
      into v_n4;
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    select count(*) into v_qoh from public.shipments where trip_id = v_trip;
    reset role;
    raise exception 'ROLLBACK';
  exception when others then
    reset role;
    test := 'T25 a seller sees only own-store shipments';
    if sqlerrm = 'ROLLBACK' then
      passed := v_n = 1 and v_n2 = 1 and v_n3 = 1 and v_n4 = 0 and v_qoh = 2;
      detail := format('seller shipments=%s own=%s lines=%s other rows=%s | admin shipments=%s', v_n, v_n2, v_n3, v_n4, v_qoh);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T27 mark_ready cannot lower a row below what sits on a shipment that has
  -- not left, whether it is still packing or already packed (packed lines can
  -- no longer be lowered, so send_trip would refuse the whole trip). Lowering
  -- the line in pack_shipment first makes room; the trip then leaves.
  begin
    v_p1 := pg_temp.dt_product();
    v_p2 := pg_temp.dt_product();
    v_pl1 := pg_temp.dt_ready(v_admin, v_p1, 5, 1, v_sa, 5, 5, 5);
    v_pl2 := pg_temp.dt_ready(v_admin, v_p2, 5, 1, v_sa, 5, 5, 5);
    v_j := public.create_trip(v_admin, array[v_sa], null);
    v_trip := (v_j ->> 'trip_id')::uuid;
    v_ship := (v_j -> 'shipments' -> 0 ->> 'shipment_id')::uuid;
    select id into v_line2 from public.shipment_lines where shipment_id = v_ship and plan_id = v_pl2;
    begin perform public.mark_ready(v_admin, jsonb_build_array(jsonb_build_object('plan_id', v_pl1, 'qty', -2))); v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    perform public.pack_shipment(v_ship, v_admin, jsonb_build_array(jsonb_build_object('line_id', v_line2, 'qty', 3)), 1);
    begin perform public.mark_ready(v_admin, jsonb_build_array(jsonb_build_object('plan_id', v_pl1, 'qty', -2))); v_err2 := 'no error';
    exception when others then v_err2 := sqlerrm; end;
    perform public.mark_ready(v_admin, jsonb_build_array(jsonb_build_object('plan_id', v_pl2, 'qty', -2)));
    begin perform public.mark_ready(v_admin, jsonb_build_array(jsonb_build_object('plan_id', v_pl2, 'qty', -1))); v_err3 := 'no error';
    exception when others then v_err3 := sqlerrm; end;
    select string_agg(ready_qty::text, ',' order by (id = v_pl1) desc) into v_txt
      from public.delivery_item_plan where id in (v_pl1, v_pl2);
    v_j2 := public.send_trip(v_trip, v_admin);
    select string_agg(shipped_qty::text, ',' order by (id = v_pl1) desc) into v_txt2
      from public.delivery_item_plan where id in (v_pl1, v_pl2);
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T27 mark_ready cannot lower ready below units on an unsent shipment';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like 'Готовите за „TEST deliveries“ към % не могат да паднат под сложените в курс К-%, който още не е тръгнал: в курса 5 бр., изпратени 0 бр., готови биха станали 3 бр.%'
                and v_err2 like 'Готовите за „TEST deliveries“ към % не могат да паднат под сложените в курс К-%: в курса 5 бр.%'
                and v_err3 like 'Готовите за „TEST deliveries“ към % не могат да паднат под сложените в курс К-%: в курса 3 бр., изпратени 0 бр., готови биха станали 2 бр.%'
                and v_txt = '5,3' and (v_j2 ->> 'units')::int = 8 and v_txt2 = '5,3';
      detail := format('packing=%s | packed=%s | below line=%s | ready=%s | sent=%s shipped=%s',
                       v_err, v_err2, v_err3, v_txt, v_j2, v_txt2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T28 the last receipt completes a delivery: everything planned was shipped
  -- and confirmed before the unallocated rest arrived.
  begin
    v_p1 := pg_temp.dt_product();
    v_pl1 := pg_temp.dt_ready(v_admin, v_p1, 12, 1, v_sa, 10, 10, 10);
    select delivery_item_id into v_i1 from public.delivery_item_plan where id = v_pl1;
    select delivery_id into v_d1 from public.delivery_items where id = v_i1;
    v_j := public.create_trip(v_admin, array[v_sa], null);
    v_trip := (v_j ->> 'trip_id')::uuid;
    v_ship := (v_j -> 'shipments' -> 0 ->> 'shipment_id')::uuid;
    perform pg_temp.dt_pack_all(v_trip, v_admin);
    perform public.send_trip(v_trip, v_admin);
    select jsonb_agg(jsonb_build_object('line_id', id, 'received_qty', qty)) into v_j2 from public.shipment_lines where shipment_id = v_ship;
    perform public.confirm_shipment(v_ship, v_admin, v_j2);
    select status into v_txt from public.deliveries where id = v_d1;
    perform public.receive_delivery(v_d1, v_admin, jsonb_build_array(jsonb_build_object('item_id', v_i1, 'qty', 2)));
    select status || ':' || (completed_at is not null) into v_txt2 from public.deliveries where id = v_d1;
    select count(*) into v_n from public.delivery_events where delivery_id = v_d1 and type = 'completed' and created_by = v_admin;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T28 completion after the last receipt';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = 'in_progress' and v_txt2 = 'completed:true' and v_n = 1;
      detail := format('after confirm=%s after last receipt=%s events=%s', v_txt, v_txt2, v_n);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T29 lowering a plan row to what was shipped completes the delivery.
  begin
    v_p1 := pg_temp.dt_product();
    v_pl1 := pg_temp.dt_ready(v_admin, v_p1, 10, 1, v_sa, 10, 10, 8);
    select delivery_item_id into v_i1 from public.delivery_item_plan where id = v_pl1;
    select delivery_id into v_d1 from public.delivery_items where id = v_i1;
    v_j := public.create_trip(v_admin, array[v_sa], null);
    v_trip := (v_j ->> 'trip_id')::uuid;
    v_ship := (v_j -> 'shipments' -> 0 ->> 'shipment_id')::uuid;
    perform pg_temp.dt_pack_all(v_trip, v_admin);
    perform public.send_trip(v_trip, v_admin);
    select jsonb_agg(jsonb_build_object('line_id', id, 'received_qty', qty)) into v_j2 from public.shipment_lines where shipment_id = v_ship;
    perform public.confirm_shipment(v_ship, v_admin, v_j2);
    select status into v_txt from public.deliveries where id = v_d1;
    perform public.update_plan(v_i1, v_admin, jsonb_build_array(jsonb_build_object('store_id', v_sa, 'planned_qty', 8)));
    select status || ':' || (completed_at is not null) into v_txt2 from public.deliveries where id = v_d1;
    select count(*) into v_n from public.delivery_events where delivery_id = v_d1 and type = 'completed';
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T29 completion after the plan is lowered to what was shipped';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = 'in_progress' and v_txt2 = 'completed:true' and v_n = 1;
      detail := format('after confirm=%s after plan change=%s events=%s', v_txt, v_txt2, v_n);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T30 a delivery received in full before it has a plan (or with only zero
  -- plan rows) does not complete: update_plan can still distribute it, and
  -- cancel_delivery can still take it back, since nothing left the warehouse.
  begin
    v_p2 := pg_temp.dt_product();
    v_d2 := pg_temp.dt_delivery(v_admin);
    v_i2 := pg_temp.dt_item(v_d2, v_p2, 10, 1);
    perform public.save_delivery(v_d2, v_admin);
    perform public.receive_delivery(v_d2, v_admin, jsonb_build_array(jsonb_build_object('item_id', v_i2, 'qty', 10)));
    select status into v_txt from public.deliveries where id = v_d2;
    select count(*) into v_n from public.delivery_events where delivery_id = v_d2 and type = 'completed';
    begin
      perform public.update_plan(v_i2, v_admin, jsonb_build_array(jsonb_build_object('store_id', v_sa, 'planned_qty', 6)));
      v_err := 'no error';
    exception when others then v_err := sqlerrm; end;
    select string_agg(planned_qty::text, ',') into v_txt2 from public.delivery_item_plan where delivery_item_id = v_i2;
    select status into v_txt3 from public.deliveries where id = v_d2;
    begin perform public.cancel_delivery(v_d2, v_admin, 'TEST deliveries'); v_err2 := 'no error';
    exception when others then v_err2 := sqlerrm; end;
    select status into v_txt4 from public.deliveries where id = v_d2;
    select quantity_on_hand into v_qoh from public.products where id = v_p2;

    -- only zero plan rows
    v_p1 := pg_temp.dt_product();
    v_pl1 := pg_temp.dt_ready(v_admin, v_p1, 4, 1, v_sa, 0, 4, 0);
    select i.delivery_id into v_d1 from public.delivery_items i join public.delivery_item_plan p on p.delivery_item_id = i.id where p.id = v_pl1;
    select status into v_txt5 from public.deliveries where id = v_d1;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T30 received in full with no plan: stays open, update_plan and cancel_delivery work';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = 'in_progress' and v_n = 0 and v_err = 'no error' and v_txt2 = '6' and v_txt3 = 'in_progress'
                and v_err2 = 'no error' and v_txt4 = 'cancelled' and v_qoh = 0 and v_txt5 = 'in_progress';
      detail := format('after receipt=%s completed events=%s | update_plan=%s plan=%s status=%s | cancel=%s status=%s qoh=%s | zero plan=%s',
                       v_txt, v_n, v_err, v_txt2, v_txt3, v_err2, v_txt4, v_qoh, v_txt5);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T31 a supplier short-delivery completes once an admin resolves the
  -- 'receive' signal as returned_to_supplier: ordered 10, plan 8, 8 arrive and
  -- are shipped and confirmed. A 'corrected' resolution (more may still come)
  -- keeps it open; returned_to_supplier closes the shortfall, the event records
  -- it, and the ordered quantity stays as it was.
  begin
    v_p1 := pg_temp.dt_product();
    v_pl1 := pg_temp.dt_ready(v_admin, v_p1, 10, 1, v_sa, 8, 8, 8);
    select delivery_item_id into v_i1 from public.delivery_item_plan where id = v_pl1;
    select delivery_id into v_d1 from public.delivery_items where id = v_i1;
    v_sig := public.raise_signal(v_admin, 'receive', 'short', v_i1, null, 10, 8, 'TEST deliveries');
    v_j := public.create_trip(v_admin, array[v_sa], null);
    v_trip := (v_j ->> 'trip_id')::uuid;
    v_ship := (v_j -> 'shipments' -> 0 ->> 'shipment_id')::uuid;
    perform pg_temp.dt_pack_all(v_trip, v_admin);
    perform public.send_trip(v_trip, v_admin);
    select jsonb_agg(jsonb_build_object('line_id', id, 'received_qty', qty)) into v_j2 from public.shipment_lines where shipment_id = v_ship;
    perform public.confirm_shipment(v_ship, v_admin, v_j2);
    select status into v_txt from public.deliveries where id = v_d1;
    perform public.resolve_signal(v_sig, v_admin, 'corrected', 'TEST deliveries');
    select status into v_txt2 from public.deliveries where id = v_d1;
    v_sig := public.raise_signal(v_admin, 'receive', 'short', v_i1, null, 10, 8, 'TEST deliveries');
    perform public.resolve_signal(v_sig, v_admin, 'returned_to_supplier', 'TEST deliveries');
    select status || ':' || (completed_at is not null) into v_txt3 from public.deliveries where id = v_d1;
    select details into v_j from public.delivery_events where signal_id = v_sig and type = 'signal_resolved';
    select count(*) into v_n from public.delivery_events where delivery_id = v_d1 and type = 'completed';
    select quantity || '/' || received_qty into v_txt4 from public.delivery_items where id = v_i1;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T31 a short delivery completes when the receive signal is resolved as returned_to_supplier';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = 'in_progress' and v_txt2 = 'in_progress' and v_txt3 = 'completed:true'
                and (v_j ->> 'shortfall_closed')::int = 2 and v_n = 1 and v_txt4 = '10/8';
      detail := format('after confirm=%s after corrected=%s after returned=%s event=%s completed events=%s item=%s',
                       v_txt, v_txt2, v_txt3, v_j, v_n, v_txt4);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T26 nothing is left behind.
  test := 'T26 nothing left behind';
  passed := not exists (select 1 from public.products where name = 'TEST deliveries')
            and not exists (select 1 from public.deliveries where notes = 'TEST deliveries')
            and not exists (select 1 from public.trips where notes = 'TEST deliveries');
  detail := 'no TEST products, deliveries or trips remain'; return next;
end $$;

select * from pg_temp.deliveries_tests();
