-- Tests for migration 20261112_supplier_orders (orders to suppliers).
--
-- Run against STAGING only (SQL Editor), after the migration. Synthetic products
-- named 'TEST orders' and a supplier 'TEST orders supplier'; every scenario ends by
-- raising 'ROLLBACK', so nothing stays. Needs an admin and at least one user.
-- Every row should read passed = true.

create or replace function pg_temp.so_product(p_cost numeric default null)
returns uuid language sql as $$
  insert into public.products (name, status, price, cost_price, quantity_on_hand)
  values ('TEST orders', 'inactive', 10, p_cost, 0) returning id $$;

create or replace function pg_temp.so_supplier(p_name text default 'TEST orders supplier')
returns uuid language sql as $$
  insert into public.suppliers (name, order_emails) values (p_name, array['orders@example.invalid']) returning id $$;

create or replace function pg_temp.so_tests()
returns table(test text, passed boolean, detail text) language plpgsql as $$
declare
  v_admin uuid; v_s uuid; v_s2 uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid;
  v_o uuid; v_d uuid; v_j jsonb; v_j2 jsonb; v_ts timestamptz;
  v_txt text; v_txt2 text; v_err text; v_err2 text; v_err3 text; v_n int; v_n2 int;
begin
  select id into v_admin from public.users where role = 'admin' order by created_at limit 1;

  test := 'O0 fixtures: an admin';
  passed := v_admin is not null; detail := format('admin=%s', v_admin); return next;

  -- O1 a new draft: number, lines in order, supplier and notes.
  begin
    v_s := pg_temp.so_supplier(); v_p1 := pg_temp.so_product(); v_p2 := pg_temp.so_product();
    v_j := public.save_supplier_order(null, v_admin, null, jsonb_build_object(
      'supplier_id', v_s, 'notes', ' TEST orders ',
      'items', jsonb_build_array(
        jsonb_build_object('product_id', v_p2, 'quantity', 5, 'note', 'синя'),
        jsonb_build_object('product_id', v_p1, 'quantity', 12))));
    v_o := (v_j ->> 'id')::uuid;
    select status || '|' || notes || '|' || (supplier_id = v_s) || '|' || (number > 0) || '|' || send_count
      into v_txt from public.supplier_orders where id = v_o;
    select string_agg((product_id = v_p2)::text || ':' || quantity || ':' || coalesce(note, '-') || ':' || sort_order, ',' order by sort_order)
      into v_txt2 from public.supplier_order_items where order_id = v_o;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'O1 save_supplier_order creates a draft';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = 'draft|TEST orders|true|true|0' and v_txt2 = 'true:5:синя:1,false:12:-:2'
                and (v_j ->> 'number') is not null;
      detail := format('order=%s items=%s', v_txt, v_txt2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- O2 overwrite replaces the lines; a stale updated_at is refused; bad input is refused.
  begin
    v_s := pg_temp.so_supplier(); v_s2 := pg_temp.so_supplier('TEST orders supplier 2');
    v_p1 := pg_temp.so_product(); v_p2 := pg_temp.so_product(); v_p3 := pg_temp.so_product();
    v_j := public.save_supplier_order(null, v_admin, null, jsonb_build_object('supplier_id', v_s,
      'items', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 1), jsonb_build_object('product_id', v_p2, 'quantity', 2))));
    v_o := (v_j ->> 'id')::uuid;
    v_j2 := public.save_supplier_order(v_o, v_admin, (v_j ->> 'updated_at')::timestamptz, jsonb_build_object('supplier_id', v_s2,
      'items', jsonb_build_array(jsonb_build_object('product_id', v_p3, 'quantity', 7))));
    select (supplier_id = v_s2)::text || '|' || (select string_agg(quantity::text, ',') from public.supplier_order_items where order_id = v_o)
      into v_txt from public.supplier_orders where id = v_o;
    begin
      perform public.save_supplier_order(v_o, v_admin, '2000-01-01'::timestamptz, jsonb_build_object('supplier_id', v_s, 'items', '[]'::jsonb));
      v_err := 'saved';
    exception when others then v_err := sqlerrm; end;
    begin
      perform public.save_supplier_order(null, v_admin, null, jsonb_build_object('supplier_id', v_s,
        'items', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 1), jsonb_build_object('product_id', v_p1, 'quantity', 2))));
      v_err2 := 'saved';
    exception when others then v_err2 := sqlerrm; end;
    begin
      perform public.save_supplier_order(null, v_admin, null, jsonb_build_object('supplier_id', v_s,
        'items', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 1.5))));
      v_err3 := 'saved';
    exception when others then v_err3 := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'O2 overwrite, stale save, duplicate product and fractional quantity';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = 'true|7' and v_err like '%променена от друг%' and v_err2 like '%повече от един ред%'
                and v_err3 like '%цяло количество%';
      detail := format('after=%s stale=%s dup=%s frac=%s', v_txt, v_err, v_err2, v_err3);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- O3 sending: empty order refused; e-mail needs an address; sent can be resent;
  -- a sent order can no longer be edited; a draft cannot become a delivery.
  begin
    v_s := pg_temp.so_supplier(); v_p1 := pg_temp.so_product();
    v_j := public.save_supplier_order(null, v_admin, null, jsonb_build_object('supplier_id', v_s, 'items', '[]'::jsonb));
    v_o := (v_j ->> 'id')::uuid;
    begin perform public.send_supplier_order(v_o, v_admin, 'email', array['a@b.c']); v_err := 'sent';
    exception when others then v_err := sqlerrm; end;
    perform public.save_supplier_order(v_o, v_admin, null, jsonb_build_object('supplier_id', v_s,
      'items', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 3))));
    begin perform public.supplier_order_to_delivery(v_o, v_admin); v_err2 := 'made';
    exception when others then v_err2 := sqlerrm; end;
    begin perform public.send_supplier_order(v_o, v_admin, 'email', '{}'); v_err3 := 'sent';
    exception when others then v_err3 := sqlerrm; end;
    perform public.send_supplier_order(v_o, v_admin, 'email', array['a@b.c']);
    perform public.send_supplier_order(v_o, v_admin, 'manual', null);
    select status || '|' || sent_via || '|' || send_count || '|' || cardinality(sent_to) || '|' || (sent_by = v_admin)
      into v_txt from public.supplier_orders where id = v_o;
    begin
      perform public.save_supplier_order(v_o, v_admin, null, jsonb_build_object('supplier_id', v_s, 'items', '[]'::jsonb));
      v_txt2 := 'saved';
    exception when others then v_txt2 := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'O3 sending rules';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err like '%празна%' and v_err2 like '%още не е изпратена%' and v_err3 like '%Няма имейл%'
                and v_txt = 'sent|manual|2|0|true' and v_txt2 like '%вече е изпратена%';
      detail := format('empty=%s draft_to_delivery=%s no_address=%s after=%s edit_sent=%s', v_err, v_err2, v_err3, v_txt, v_txt2);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- O4 "Пристигна": a draft delivery with the order's lines, supplier, last price of
  -- this supplier first (else catalogue cost, else 0), linked both ways; a second call
  -- returns the same delivery; no stock moves.
  begin
    v_s := pg_temp.so_supplier(); v_s2 := pg_temp.so_supplier('TEST orders supplier 2');
    v_p1 := pg_temp.so_product(1.11); v_p2 := pg_temp.so_product(2.22); v_p3 := pg_temp.so_product(null);
    -- earlier deliveries of p1: from another supplier (newer) and from this one (older)
    v_j := public.save_delivery_draft(null, v_admin, null, jsonb_build_object('notes', 'TEST orders', 'items', jsonb_build_array(
      jsonb_build_object('product_id', v_p1, 'supplier_id', v_s, 'quantity', 1, 'unit_cost', 3.33, 'pack_size', 6))));
    update public.deliveries set status = 'completed' where id = (v_j ->> 'id')::uuid;
    update public.delivery_items set created_at = now() - interval '2 days' where delivery_id = (v_j ->> 'id')::uuid;
    v_j := public.save_delivery_draft(null, v_admin, null, jsonb_build_object('notes', 'TEST orders', 'items', jsonb_build_array(
      jsonb_build_object('product_id', v_p1, 'supplier_id', v_s2, 'quantity', 1, 'unit_cost', 9.99))));
    update public.deliveries set status = 'completed' where id = (v_j ->> 'id')::uuid;

    v_j := public.save_supplier_order(null, v_admin, null, jsonb_build_object('supplier_id', v_s, 'notes', 'TEST orders',
      'items', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 10),
                                 jsonb_build_object('product_id', v_p2, 'quantity', 20),
                                 jsonb_build_object('product_id', v_p3, 'quantity', 30))));
    v_o := (v_j ->> 'id')::uuid;
    perform public.send_supplier_order(v_o, v_admin, 'manual', null);
    v_j := public.supplier_order_to_delivery(v_o, v_admin);
    v_d := (v_j ->> 'delivery_id')::uuid;
    v_j2 := public.supplier_order_to_delivery(v_o, v_admin);
    select d.status || '|' || (d.supplier_order_id = v_o) || '|' || d.order_ref || '|' || (o.delivery_id = v_d) || '|' || o.status || '|' || (o.received_by = v_admin)
      into v_txt
      from public.deliveries d join public.supplier_orders o on o.id = v_o where d.id = v_d;
    select string_agg(i.quantity || ':' || i.unit_cost || ':' || i.pack_size || ':' || (i.supplier_id = v_s), ',' order by i.sort_order)
      into v_txt2 from public.delivery_items i where i.delivery_id = v_d;
    select count(*) into v_n from public.stock_batches where product_id in (v_p1, v_p2, v_p3);
    select number into v_n2 from public.supplier_orders where id = v_o;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'O4 supplier_order_to_delivery makes a linked draft delivery';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = format('draft|true|ПР-%s|true|received|true', lpad(v_n2::text, 6, '0'))
                and v_txt2 = '10:3.3300:6:true,20:2.2200:1:true,30:0.0000:1:true'
                and (v_j ->> 'created')::boolean and not (v_j2 ->> 'created')::boolean
                and (v_j2 ->> 'delivery_id')::uuid = v_d and v_n = 0;
      detail := format('link=%s lines=%s first=%s second=%s batches=%s', v_txt, v_txt2, v_j, v_j2, v_n);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- O5 the delivery made from the order is cancelled: the order makes a new one. Cancel rules.
  begin
    v_s := pg_temp.so_supplier(); v_p1 := pg_temp.so_product(1);
    v_j := public.save_supplier_order(null, v_admin, null, jsonb_build_object('supplier_id', v_s,
      'items', jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 4))));
    v_o := (v_j ->> 'id')::uuid;
    perform public.send_supplier_order(v_o, v_admin, 'manual', null);
    v_d := (public.supplier_order_to_delivery(v_o, v_admin) ->> 'delivery_id')::uuid;
    perform public.cancel_delivery(v_d, v_admin, 'TEST orders');
    v_j := public.supplier_order_to_delivery(v_o, v_admin);
    v_txt := ((v_j ->> 'created')::boolean and (v_j ->> 'delivery_id')::uuid <> v_d)::text;
    begin perform public.cancel_supplier_order(v_o, v_admin, 'няма стока'); v_err := 'cancelled';
    exception when others then v_err := sqlerrm; end;
    v_j := public.save_supplier_order(null, v_admin, null, jsonb_build_object('supplier_id', v_s, 'items', '[]'::jsonb));
    begin perform public.cancel_supplier_order((v_j ->> 'id')::uuid, v_admin, 'x'); v_err2 := 'cancelled';
    exception when others then v_err2 := sqlerrm; end;
    perform public.cancel_supplier_order((v_j ->> 'id')::uuid, v_admin, 'грешка');
    select status || '|' || cancel_reason || '|' || (cancelled_by = v_admin) into v_txt2
      from public.supplier_orders where id = (v_j ->> 'id')::uuid;
    begin perform public.send_supplier_order((v_j ->> 'id')::uuid, v_admin, 'manual', null); v_err3 := 'sent';
    exception when others then v_err3 := sqlerrm; end;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'O5 cancelled delivery is remade; cancel rules';
    if sqlerrm = 'ROLLBACK' then
      passed := v_txt = 'true' and v_err like '%вече е пристигнала%' and v_err2 like '%причина%'
                and v_txt2 = 'cancelled|грешка|true' and v_err3 like '%отказана%';
      detail := format('remade=%s cancel_received=%s short_reason=%s cancelled=%s send_cancelled=%s', v_txt, v_err, v_err2, v_txt2, v_err3);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  test := 'O6 anon and authenticated cannot execute the new functions';
  passed := not has_function_privilege('anon', 'public.save_supplier_order(uuid, uuid, timestamptz, jsonb)', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.save_supplier_order(uuid, uuid, timestamptz, jsonb)', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.send_supplier_order(uuid, uuid, text, text[])', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.supplier_order_to_delivery(uuid, uuid)', 'EXECUTE')
            and not has_function_privilege('authenticated', 'public.cancel_supplier_order(uuid, uuid, text)', 'EXECUTE')
            and not has_function_privilege('anon', 'public.supplier_order_to_delivery(uuid, uuid)', 'EXECUTE')
            and has_function_privilege('service_role', 'public.supplier_order_to_delivery(uuid, uuid)', 'EXECUTE')
            and has_function_privilege('service_role', 'public.send_supplier_order(uuid, uuid, text, text[])', 'EXECUTE');
  detail := 'EXECUTE only for service_role'; return next;

  test := 'O7 row level security is on';
  passed := (select relrowsecurity from pg_class where oid = 'public.supplier_orders'::regclass)
            and (select relrowsecurity from pg_class where oid = 'public.supplier_order_items'::regclass);
  detail := 'supplier_orders, supplier_order_items'; return next;

  test := 'O8 nothing left behind';
  passed := not exists (select 1 from public.products where name = 'TEST orders')
            and not exists (select 1 from public.suppliers where name like 'TEST orders supplier%');
  detail := 'no TEST products or suppliers remain'; return next;
end $$;

select * from pg_temp.so_tests();
