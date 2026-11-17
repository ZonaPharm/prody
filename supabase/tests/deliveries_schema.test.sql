-- Tests for the deliveries schema (migration 20261110_deliveries_schema).
--
-- Run against STAGING only (Supabase MCP execute_sql on ruhhsixmqusnpiajkbxe, or
-- psql). Every scenario that writes rows does so inside a block that ends by
-- raising an exception, so nothing is left behind. Needs one admin and one
-- seller with a store (the staging accounts claude.admin@prody.local and
-- claude.seller@prody.local when they exist). Every row should read
-- passed = true.

create or replace function pg_temp.deliveries_schema_tests()
returns table(test text, passed boolean, detail text) language plpgsql as $$
declare
  v_tables constant text[] := array['suppliers', 'deliveries', 'delivery_items', 'delivery_item_plan', 'trips',
                                    'shipments', 'shipment_lines', 'delivery_signals', 'delivery_events'];
  v_admin uuid; v_seller uuid; v_seller_store uuid; v_other_store uuid; v_product uuid;
  v_delivery uuid; v_item uuid; v_plan uuid; v_trip uuid; v_ship_own uuid; v_ship_other uuid; v_event uuid;
  v_n int; v_txt text; v_err text; v_err2 text; v_ok boolean;
  v_seller_ships text; v_seller_lines text; v_seller_deliveries text; v_admin_ships text; v_anon text;
  v_before timestamptz; v_after timestamptz;
begin
  select id into v_admin from public.users where role = 'admin'
    order by (email = 'claude.admin@prody.local') desc, created_at limit 1;
  select u.id, u.store_id into v_seller, v_seller_store from public.users u join public.stores s on s.id = u.store_id
    where u.role = 'seller' and not coalesce(s.is_warehouse, false)
    order by (u.email = 'claude.seller@prody.local') desc, u.created_at limit 1;
  select id into v_other_store from public.stores
    where id <> v_seller_store and not coalesce(is_warehouse, false) order by name limit 1;

  -- T1 the nine tables exist, with RLS on.
  select count(*), string_agg(c.relname || '=' || c.relrowsecurity, ',' order by c.relname)
    into v_n, v_txt
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname = any(v_tables);
  test := 'T1 nine tables exist';
  passed := v_n = 9; detail := v_txt; return next;
  test := 'T2 RLS enabled on every new table';
  passed := v_n = 9 and v_txt not like '%=false%'; detail := v_txt; return next;

  -- T3 the three sequences exist.
  select count(*) into v_n from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'S'
      and relname in ('delivery_number_seq', 'shipment_number_seq', 'trip_number_seq');
  test := 'T3 sequences exist'; passed := v_n = 3; detail := v_n || ' of 3'; return next;

  -- T4 new columns on existing tables: needs_label not null default true, the
  -- three nullable links with their foreign keys.
  select string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':'
                    || coalesce(column_default, '-'), ',' order by table_name, column_name)
    into v_txt
    from information_schema.columns
    where table_schema = 'public'
      and (table_name, column_name) in (('products', 'needs_label'), ('stock_batches', 'delivery_item_id'),
                                        ('stock_movements', 'delivery_id'), ('stock_movements', 'shipment_id'));
  select count(*) into v_n from pg_constraint
    where contype = 'f' and conrelid in ('public.stock_batches'::regclass, 'public.stock_movements'::regclass)
      and confrelid in ('public.delivery_items'::regclass, 'public.deliveries'::regclass, 'public.shipments'::regclass);
  test := 'T4 columns on existing tables';
  passed := v_txt = 'products.needs_label:boolean:NO:true,stock_batches.delivery_item_id:uuid:YES:-,'
                    || 'stock_movements.delivery_id:uuid:YES:-,stock_movements.shipment_id:uuid:YES:-'
            and v_n = 3;
  detail := v_txt || ' fks=' || v_n; return next;

  -- T5 every named check and unique constraint of the contract is there.
  select count(*), string_agg(x.name, ',') filter (where c.oid is null)
    into v_n, v_txt
    from unnest(array[
      'deliveries_status_check', 'deliveries_number_key',
      'delivery_items_pack_size_check', 'delivery_items_quantity_check', 'delivery_items_unit_cost_check',
      'delivery_items_received_qty_check',
      'delivery_item_plan_planned_qty_check', 'delivery_item_plan_qty_order_check', 'delivery_item_plan_item_store_key',
      'trips_status_check', 'trips_number_key',
      'shipments_status_check', 'shipments_box_count_check', 'shipments_trip_store_key', 'shipments_number_key',
      'shipment_lines_qty_check', 'shipment_lines_received_qty_check', 'shipment_lines_shipment_plan_key',
      'delivery_signals_step_check', 'delivery_signals_reason_check', 'delivery_signals_status_check',
      'delivery_signals_resolution_check', 'delivery_signals_resolved_check',
      'delivery_events_type_check', 'stock_movements_type_check']) as x(name)
    left join pg_constraint c on c.conname = x.name and c.connamespace = 'public'::regnamespace;
  test := 'T5 constraints exist';
  passed := v_txt is null; detail := coalesce('missing: ' || v_txt, v_n || ' present'); return next;

  -- T6 indexes the contract names, plus the supplier name key.
  select string_agg(x.name, ',') filter (where i.oid is null)
    into v_txt
    from unnest(array['suppliers_name_key', 'delivery_items_delivery_id_idx', 'delivery_items_product_id_idx',
                      'delivery_signals_open_idx', 'delivery_events_delivery_id_idx',
                      'delivery_events_created_by_idx', 'delivery_events_created_at_idx']) as x(name)
    left join pg_class i on i.relname = x.name and i.relnamespace = 'public'::regnamespace and i.relkind = 'i';
  test := 'T6 indexes exist'; passed := v_txt is null; detail := coalesce('missing: ' || v_txt, 'all present'); return next;

  -- T7 policies: read-only, signed-in only. Admin read on all nine, seller
  -- read on shipments and shipment_lines, and no write policy anywhere.
  select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || array_to_string(roles, '+'), ', '
                    order by tablename, policyname),
         count(*) filter (where cmd = 'SELECT' and roles = '{authenticated}'::name[]),
         count(*) = 11
           and count(*) filter (where policyname like 'Admins read%' and qual = 'is_admin()') = 9
           and count(*) filter (where policyname like 'Sellers read own store%'
                                  and tablename in ('shipments', 'shipment_lines')) = 2
    into v_txt, v_n, v_ok
    from pg_policies where schemaname = 'public' and tablename = any(v_tables);
  test := 'T7 eleven SELECT policies for authenticated, nothing else';
  passed := v_ok and v_n = 11;
  detail := v_txt; return next;

  -- T8 anon holds no privilege on the new tables and sequences; authenticated
  -- holds only SELECT on the tables (rows filtered by RLS) and nothing on the sequences.
  select string_agg(t || ':' || p, ',') into v_txt
    from unnest(v_tables) t,
         unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    , unnest(array['anon', 'authenticated']) r
    where has_table_privilege(r, 'public.' || t, p)
      and not (r = 'authenticated' and p = 'SELECT');
  select string_agg(s || ':' || p, ',') into v_err from
    unnest(array['delivery_number_seq', 'shipment_number_seq', 'trip_number_seq']) s,
    unnest(array['USAGE', 'SELECT', 'UPDATE']) p,
    unnest(array['anon', 'authenticated']) r
    where has_sequence_privilege(r, 'public.' || s, p);
  test := 'T8 anon has no privileges; authenticated only SELECT on tables, nothing on sequences';
  passed := v_txt is null and v_err is null;
  detail := coalesce('tables: ' || v_txt, 'tables none') || '; ' || coalesce('sequences: ' || v_err, 'sequences none');
  return next;

  -- T9 the movement type check takes delivery_cancel, is validated, and every
  -- existing movement satisfies it.
  select pg_get_constraintdef(oid), convalidated into v_txt, v_ok from pg_constraint
    where conname = 'stock_movements_type_check' and conrelid = 'public.stock_movements'::regclass;
  select count(*) into v_n from public.stock_movements
    where type not in ('restock', 'sell', 'transfer_in', 'transfer_out', 'void', 'correction', 'delivery_cancel');
  test := 'T9 stock_movements type check';
  passed := v_ok and v_n = 0 and v_txt like '%delivery_cancel%'
            and (select count(*) from unnest(array['restock', 'sell', 'transfer_in', 'transfer_out', 'void', 'correction']) t
                 where v_txt like '%''' || t || '''%') = 6;
  detail := format('validated=%s violating_rows=%s %s', v_ok, v_n, v_txt); return next;

  -- T10 supplier seed: one supplier per distinct trimmed non-empty source,
  -- Temu and Панацея merged, every source covered, and products.source
  -- untouched (still holds the merged spellings).
  with mapped as (
    select case when btrim(source) in ('Temu', 'Тему', 'тему', 'ТЕМУ') then 'Temu'
                when btrim(source) in ('Панацея', 'Панацея 2001') then 'Панацея 2001'
                else btrim(source) end as name
    from public.products where source is not null and btrim(source) <> ''
  ), per_supplier as (
    select s.name, count(m.name) as n
    from public.suppliers s left join mapped m on lower(m.name) = lower(btrim(s.name))
    group by s.name
  )
  select string_agg(name || '=' || n, ', ' order by n desc, name) into v_txt from per_supplier;
  test := 'T10 supplier seed with approved merges';
  passed := (select count(*) from public.suppliers)
              = (select count(distinct lower(case when btrim(source) in ('Temu', 'Тему', 'тему', 'ТЕМУ') then 'Temu'
                                                  when btrim(source) in ('Панацея', 'Панацея 2001') then 'Панацея 2001'
                                                  else btrim(source) end))
                 from public.products where source is not null and btrim(source) <> '')
            and exists (select 1 from public.suppliers where name = 'Temu')
            and not exists (select 1 from public.suppliers where lower(name) = 'тему')
            and exists (select 1 from public.suppliers where name = 'Панацея 2001')
            and not exists (select 1 from public.suppliers where name = 'Панацея')
            and not exists (select 1 from public.products p where p.source is not null and btrim(p.source) <> ''
                              and not exists (select 1 from public.suppliers s where lower(btrim(s.name)) = lower(
                                case when btrim(p.source) in ('Temu', 'Тему', 'тему', 'ТЕМУ') then 'Temu'
                                     when btrim(p.source) in ('Панацея', 'Панацея 2001') then 'Панацея 2001'
                                     else btrim(p.source) end)))
            and exists (select 1 from public.products where btrim(source) in ('Тему', 'тему', 'ТЕМУ', 'Панацея'));
  detail := v_txt; return next;

  -- T11 delivery_events refuses UPDATE and DELETE, even for the owner.
  begin
    insert into public.delivery_events (type, created_by) values ('trip_created', v_admin) returning id into v_event;
    begin
      update public.delivery_events set qty = 1 where id = v_event;
      v_err := 'no error raised';
    exception when others then v_err := sqlerrm;
    end;
    begin
      delete from public.delivery_events where id = v_event;
      v_err2 := 'no error raised';
    exception when others then v_err2 := sqlerrm;
    end;
    select count(*) into v_n from public.delivery_events where id = v_event and qty is null;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T11 delivery_events is append-only';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err = 'delivery_events is append-only' and v_err2 = 'delivery_events is append-only' and v_n = 1;
      detail := format('update: %s / delete: %s / row intact: %s', v_err, v_err2, v_n = 1);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T12 a seller sees only own-store shipments and their lines, and no
  -- deliveries; an admin sees both shipments; anon is refused.
  begin
    insert into public.products (name, status, price, quantity_on_hand)
      values ('TEST deliveries_schema', 'inactive', 1, 0) returning id into v_product;
    insert into public.deliveries (created_by) values (v_admin) returning id into v_delivery;
    insert into public.delivery_items (delivery_id, product_id, quantity, unit_cost)
      values (v_delivery, v_product, 10, 1.5) returning id into v_item;
    insert into public.delivery_item_plan (delivery_item_id, store_id, planned_qty)
      values (v_item, v_seller_store, 5) returning id into v_plan;
    insert into public.delivery_item_plan (delivery_item_id, store_id, planned_qty)
      values (v_item, v_other_store, 5);
    -- Explicit negative numbers: nextval is not rolled back, so the defaults
    -- would burn real trip and shipment numbers.
    insert into public.trips (number, created_by) values (-1, v_admin) returning id into v_trip;
    insert into public.shipments (number, trip_id, store_id, created_by) values (-1, v_trip, v_seller_store, v_admin)
      returning id into v_ship_own;
    insert into public.shipments (number, trip_id, store_id, created_by) values (-2, v_trip, v_other_store, v_admin)
      returning id into v_ship_other;
    insert into public.shipment_lines (shipment_id, plan_id, delivery_item_id, product_id, qty)
      values (v_ship_own, v_plan, v_item, v_product, 2);
    insert into public.shipment_lines (shipment_id, plan_id, delivery_item_id, product_id, qty)
      select v_ship_other, p.id, v_item, v_product, 3 from public.delivery_item_plan p
      where p.delivery_item_id = v_item and p.store_id = v_other_store;

    perform set_config('request.jwt.claims', json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select string_agg(case when id = v_ship_own then 'own' else 'OTHER' end, ',') into v_seller_ships
      from public.shipments where trip_id = v_trip;
    select string_agg(qty::text, ',') into v_seller_lines
      from public.shipment_lines where shipment_id in (v_ship_own, v_ship_other);
    select count(*)::text into v_seller_deliveries from public.deliveries where id = v_delivery;
    reset role;

    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*)::text into v_admin_ships from public.shipments where trip_id = v_trip;
    reset role;

    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    begin
      set local role anon;
      select count(*)::text into v_anon from public.shipments;
      reset role;
    exception when others then reset role; v_anon := 'error ' || sqlstate;
    end;
    raise exception 'ROLLBACK';
  exception when others then
    reset role;
    test := 'T12 seller sees own-store shipments only';
    if sqlerrm = 'ROLLBACK' then
      passed := v_seller_ships = 'own' and v_seller_lines = '2' and v_seller_deliveries = '0'
                and v_admin_ships = '2' and v_anon = 'error 42501';
      detail := format('seller shipments=%s lines=%s deliveries=%s / admin shipments=%s / anon=%s',
                       v_seller_ships, v_seller_lines, v_seller_deliveries, v_admin_ships, v_anon);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T13 signed-in users cannot write, even an admin (no write policies).
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.suppliers (name) values ('TEST deliveries_schema');
    reset role;
    test := 'T13 admin cannot insert directly'; passed := false; detail := 'insert accepted'; return next;
  exception when others then
    reset role;
    test := 'T13 admin cannot insert directly'; passed := sqlstate = '42501'; detail := sqlstate || ' ' || sqlerrm;
    return next;
  end;

  -- T14 the quantity rules hold: shipped above ready, received above quantity
  -- and a half-resolved signal are refused; deliveries.updated_at moves.
  begin
    insert into public.products (name, status, price, quantity_on_hand)
      values ('TEST deliveries_schema', 'inactive', 1, 0) returning id into v_product;
    insert into public.deliveries (created_by, updated_at) values (v_admin, now() - interval '1 day')
      returning id, updated_at into v_delivery, v_before;
    update public.deliveries set notes = 'x' where id = v_delivery returning updated_at into v_after;
    insert into public.delivery_items (delivery_id, product_id, quantity, unit_cost)
      values (v_delivery, v_product, 10, 1) returning id into v_item;
    v_txt := '';
    begin
      update public.delivery_items set received_qty = 11 where id = v_item;
      v_txt := v_txt || 'received>quantity accepted;';
    exception when check_violation then null;
    end;
    begin
      insert into public.delivery_item_plan (delivery_item_id, store_id, planned_qty, ready_qty, shipped_qty)
        values (v_item, v_seller_store, 5, 2, 3);
      v_txt := v_txt || 'shipped>ready accepted;';
    exception when check_violation then null;
    end;
    begin
      insert into public.delivery_item_plan (delivery_item_id, store_id, planned_qty, ready_qty)
        values (v_item, v_seller_store, 5, 6);
      v_txt := v_txt || 'ready>planned accepted;';
    exception when check_violation then null;
    end;
    begin
      insert into public.delivery_signals (delivery_id, step, reason, status, created_by)
        values (v_delivery, 'receive', 'short', 'resolved', v_admin);
      v_txt := v_txt || 'resolved without resolution accepted;';
    exception when check_violation then null;
    end;
    begin
      insert into public.stock_movements (product_id, store_id, type, quantity, created_by)
        values (v_product, v_seller_store, 'delivery_cancel', -1, v_admin);
    exception when others then v_txt := v_txt || 'delivery_cancel refused: ' || sqlerrm || ';';
    end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T14 quantity rules and updated_at';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = '' and v_after > v_before;
      detail := coalesce(nullif(v_txt, ''), 'all refused as expected') || format(' updated_at moved=%s', v_after > v_before);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T16 the append-only trigger function: no EXECUTE for anon or
  -- authenticated, SECURITY INVOKER, empty search_path.
  select has_function_privilege('anon', p.oid, 'EXECUTE') || '/' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
         || '/' || has_function_privilege('service_role', p.oid, 'EXECUTE') || '/' || p.prosecdef
         || '/' || coalesce(p.proconfig @> array['search_path=""'], false)
    into v_txt
    from pg_proc p where p.oid = 'public.delivery_events_append_only()'::regprocedure;
  test := 'T16 append-only trigger function: service_role only, invoker, empty search_path';
  passed := v_txt = 'false/false/true/false/true';
  detail := 'anon/authenticated/service_role/secdef/search_path: ' || coalesce(v_txt, 'missing'); return next;

  -- T15 nothing is left behind.
  test := 'T15 nothing left behind';
  passed := not exists (select 1 from public.products where name = 'TEST deliveries_schema')
            and not exists (select 1 from public.suppliers where name = 'TEST deliveries_schema')
            and not exists (select 1 from public.trips where number < 0)
            and not exists (select 1 from public.shipments where number < 0);
  detail := 'no TEST rows remain'; return next;
end $$;

select * from pg_temp.deliveries_schema_tests();
