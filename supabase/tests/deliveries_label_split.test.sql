-- Tests for migration 20261111_deliveries_label_split (labelling part of a line with a
-- chosen split inside the plan), on top of the phase 1, 2 and 3 delivery migrations and
-- 20261111_deliveries_label_items.
--
-- Run against STAGING only (SQL Editor or psql on ruhhsixmqusnpiajkbxe), after the
-- migration. Self-contained like the other delivery tests: synthetic products named
-- 'TEST deliveries', every scenario ends by raising 'ROLLBACK', so nothing stays.
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

-- Label p_qty units of a line with a split [{store_id, qty}] (store_id null = Офис).
create or replace function pg_temp.li_split(p_admin uuid, p_item text, p_qty int, p_split jsonb)
returns jsonb language sql as $$
  select public.label_items_checked(p_admin,
    jsonb_build_array(jsonb_build_object('item_id', p_item, 'qty', p_qty, 'split', p_split)), '[]'::jsonb) $$;

create or replace function pg_temp.ls_tests()
returns table(test text, passed boolean, detail text) language plpgsql as $$
declare
  v_admin uuid; v_wh uuid; v_sa uuid; v_sb uuid;
  v_x jsonb; v_j jsonb; v_n int;
  v_txt text; v_txt2 text; v_err text; v_err2 text; v_err3 text; v_err4 text; v_err5 text; v_err6 text;
begin
  select id into v_admin from public.users where role = 'admin'
    order by (email = 'claude.admin@prody.local') desc, created_at limit 1;
  select id into v_wh from public.stores where is_warehouse and is_active;
  select id into v_sa from public.stores where is_active and not coalesce(is_warehouse, false) order by name limit 1;
  select id into v_sb from public.stores where is_active and not coalesce(is_warehouse, false) and id <> v_sa order by name limit 1;

  test := 'S0 fixtures: admin, warehouse, two stores';
  passed := v_admin is not null and v_wh is not null and v_sa is not null and v_sb is not null;
  detail := format('admin=%s wh=%s sa=%s sb=%s', v_admin, v_wh, v_sa, v_sb);
  return next;

  -- S1 20 received, plan A 6, B 4, Офис 10. 5 labelled now: 3 for B, 2 stay in Офис.
  -- A gets nothing yet, though it comes first by name.
  begin
    v_x := pg_temp.li_delivery(v_admin, v_sa, v_sb, 20, 6, 4, 20);
    v_j := pg_temp.li_split(v_admin, v_x ->> 'item', 5,
      jsonb_build_array(jsonb_build_object('store_id', v_sb, 'qty', 3), jsonb_build_object('store_id', null, 'qty', 2)));
    v_txt := pg_temp.li_state(v_x);
    select count(*) into v_n from public.delivery_events
    where delivery_id = (v_x ->> 'delivery')::uuid and type = 'ready' and details ? 'split';
    raise exception 'ROLLBACK';
  exception when others then
    test := 'S1 part of a line goes where the person says';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = '0,3|5|15' and v_n = 1 and v_j = jsonb_build_object('labelled', 5, 'ready', 3, 'signals', 0);
      detail := format('state=%s result=%s split ready events=%s', v_txt, v_j, v_n);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- S2 the split stays inside the plan: a store above what it still needs, Офис above its
  -- share, a store not in the plan, a sum that is not the qty, a store twice. Nothing changes.
  begin
    v_x := pg_temp.li_delivery(v_admin, v_sa, v_sb, 20, 6, 4, 20);
    perform pg_temp.li_split(v_admin, v_x ->> 'item', 2, jsonb_build_array(jsonb_build_object('store_id', null, 'qty', 2)));
    v_txt := pg_temp.li_state(v_x);
    begin perform pg_temp.li_split(v_admin, v_x ->> 'item', 5, jsonb_build_array(jsonb_build_object('store_id', v_sb, 'qty', 5)));
    exception when others then v_err := sqlerrm; end;
    begin perform pg_temp.li_split(v_admin, v_x ->> 'item', 9, jsonb_build_array(jsonb_build_object('store_id', null, 'qty', 9)));
    exception when others then v_err2 := sqlerrm; end;
    begin perform pg_temp.li_split(v_admin, v_x ->> 'item', 1, jsonb_build_array(jsonb_build_object('store_id', v_wh, 'qty', 1)));
    exception when others then v_err3 := sqlerrm; end;
    begin perform pg_temp.li_split(v_admin, v_x ->> 'item', 4, jsonb_build_array(jsonb_build_object('store_id', v_sa, 'qty', 3)));
    exception when others then v_err4 := sqlerrm; end;
    begin perform pg_temp.li_split(v_admin, v_x ->> 'item', 2,
      jsonb_build_array(jsonb_build_object('store_id', v_sa, 'qty', 1), jsonb_build_object('store_id', v_sa, 'qty', 1)));
    exception when others then v_err5 := sqlerrm; end;
    begin perform pg_temp.li_split(v_admin, v_x ->> 'item', 1, jsonb_build_array(jsonb_build_object('store_id', v_sa, 'qty', 0)));
    exception when others then v_err6 := sqlerrm; end;
    v_txt2 := pg_temp.li_state(v_x);
    raise exception 'ROLLBACK';
  exception when others then
    test := 'S2 a split outside the plan is refused';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = '0,0|2|18' and v_txt2 = v_txt
                and v_err like '%остават по план 4 бр., а са дадени 5 бр.%'
                and v_err2 like '%в Офис остават по план 8 бр., а са дадени 9 бр.%'
                and v_err3 like '%няма план към този обект%'
                and v_err4 like '%точно колкото етикетираните%'
                and v_err5 like '%повтаря в разпределението%'
                and v_err6 like '%над 0 бр.%';
      detail := format('state=%s/%s | %s | %s | %s | %s | %s | %s', v_txt, v_txt2, v_err, v_err2, v_err3, v_err4, v_err5, v_err6);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- S3 after a part with an Офис share, the rest labelled at once (no split) fills the
  -- stores and ends exactly on the plan: A 6, B 4, Офис 10.
  begin
    v_x := pg_temp.li_delivery(v_admin, v_sa, v_sb, 20, 6, 4, 20);
    perform pg_temp.li_split(v_admin, v_x ->> 'item', 7,
      jsonb_build_array(jsonb_build_object('store_id', v_sb, 'qty', 1), jsonb_build_object('store_id', null, 'qty', 6)));
    v_txt := pg_temp.li_state(v_x);
    perform pg_temp.li_label(v_admin, v_x ->> 'item', 13);
    v_txt2 := pg_temp.li_state(v_x);
    raise exception 'ROLLBACK';
  exception when others then
    test := 'S3 the rest without a split ends on the plan';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = '0,1|7|13' and v_txt2 = '6,4|20|0';
      detail := format('after part=%s after rest=%s', v_txt, v_txt2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- S4 a split with all of it for the stores, nothing for Офис, and an empty split
  -- (same as none).
  begin
    v_x := pg_temp.li_delivery(v_admin, v_sa, v_sb, 20, 6, 4, 20);
    perform pg_temp.li_split(v_admin, v_x ->> 'item', 10,
      jsonb_build_array(jsonb_build_object('store_id', v_sa, 'qty', 6), jsonb_build_object('store_id', v_sb, 'qty', 4)));
    v_txt := pg_temp.li_state(v_x);
    perform pg_temp.li_split(v_admin, v_x ->> 'item', 3, '[]'::jsonb);
    v_txt2 := pg_temp.li_state(v_x);
    raise exception 'ROLLBACK';
  exception when others then
    test := 'S4 all to the stores; an empty split is no split';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = '6,4|10|10' and v_txt2 = '6,4|13|7';
      detail := format('after 10=%s after 3 more=%s', v_txt, v_txt2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- S5 nothing was left behind.
  test := 'S5 nothing left behind';
  passed := not exists (select 1 from public.products where name = 'TEST deliveries');
  detail := '';
  return next;
end $$;

select * from pg_temp.ls_tests();
