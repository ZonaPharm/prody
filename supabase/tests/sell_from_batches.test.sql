-- Tests for public.sell_from_batches (migration 20261109_sell_from_batches_atomically).
--
-- Run against STAGING only (Supabase MCP execute_sql on ruhhsixmqusnpiajkbxe, or
-- psql). Self-contained: every scenario builds its own synthetic product,
-- batches and sale, and rolls them back, so nothing is left behind and the
-- outcome does not depend on what data staging holds. Every row should read
-- passed = true.
--
-- Not covered here: two sales racing for the same batch. That needs two real
-- sessions and was checked on staging on 9 November 2026 with dblink: the
-- second sale waited on Lock/transactionid until the first committed, then
-- left 10 - 3 - 4 = 3. The old read-then-write path, raced the same way, left 6.

create or replace function pg_temp.sell_from_batches_tests()
returns table(test text, passed boolean, detail text) language plpgsql as $$
declare
  v_product uuid; v_store uuid; v_other_store uuid; v_user uuid; v_sale uuid;
  v_touched int; v_qoh int; v_after text; v_movs text; v_cogs numeric; v_other text; v_err text;
begin
  select id into v_user from public.users order by created_at limit 1;
  select id into v_store from public.stores order by name limit 1;
  select id into v_other_store from public.stores where id <> v_store order by name limit 1;

  -- T1 a sale spanning several batches takes the oldest first, each at its own cost.
  begin
    insert into public.products (name, status, price, quantity_on_hand)
      values ('TEST sell_from_batches', 'inactive', 1, 51) returning id into v_product;
    insert into public.stock_batches (product_id, store_id, quantity_remaining, unit_cost, created_at) values
      (v_product, v_store, 5, 5.00, '2026-01-01'), (v_product, v_store, 1, 1.00, '2026-01-02'),
      (v_product, v_store, 1, 0.00, '2026-01-03'), (v_product, v_store, 12, 1.00, '2026-01-04'),
      (v_product, v_store, 12, 5.00, '2026-01-05'), (v_product, v_store, 20, 1.00, '2026-01-06'),
      (v_product, v_other_store, 7, 2.00, '2025-12-31');   -- older, but another store
    insert into public.sales (product_id, store_id, sold_by, quantity, sale_price, sale_group_id)
      values (v_product, v_store, v_user, 8, 1.00, gen_random_uuid()) returning id into v_sale;

    v_touched := public.sell_from_batches(v_product, v_store, 8, 1.00, v_sale, v_user);

    select string_agg(quantity_remaining::text, ',' order by created_at) into v_after
      from public.stock_batches where product_id = v_product and store_id = v_store;
    select string_agg(m.quantity || '@' || m.unit_cost, ',' order by b.created_at), sum(-m.quantity * m.unit_cost)
      into v_movs, v_cogs
      from public.stock_movements m join public.stock_batches b on b.id = m.batch_id
      where m.sale_id = v_sale and m.type = 'sell';
    select quantity_on_hand into v_qoh from public.products where id = v_product;
    select string_agg(quantity_remaining::text, ',') into v_other
      from public.stock_batches where product_id = v_product and store_id = v_other_store;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T1 oldest batches first, own cost each, counter in step';
    if sqlerrm = 'ROLLBACK' then
      passed := v_touched = 4 and v_after = '0,0,0,11,12,20' and v_movs = '-5@5.00,-1@1.00,-1@0.00,-1@1.00'
                and v_cogs = 27 and v_qoh = 43 and v_other = '7';
      detail := format('touched=%s batches=%s movements=%s cogs=%s qoh=%s other_store=%s',
                       v_touched, v_after, v_movs, v_cogs, v_qoh, v_other);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T2 selling exactly what the store holds empties every batch.
  begin
    insert into public.products (name, status, price, quantity_on_hand)
      values ('TEST sell_from_batches', 'inactive', 1, 6) returning id into v_product;
    insert into public.stock_batches (product_id, store_id, quantity_remaining, unit_cost, created_at) values
      (v_product, v_store, 2, 1.00, '2026-01-01'), (v_product, v_store, 4, 1.00, '2026-01-02');
    insert into public.sales (product_id, store_id, sold_by, quantity, sale_price, sale_group_id)
      values (v_product, v_store, v_user, 6, 1.00, gen_random_uuid()) returning id into v_sale;
    v_touched := public.sell_from_batches(v_product, v_store, 6, 1.00, v_sale, v_user);
    select string_agg(quantity_remaining::text, ',' order by created_at) into v_after
      from public.stock_batches where product_id = v_product;
    select quantity_on_hand into v_qoh from public.products where id = v_product;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T2 selling everything empties every batch';
    if sqlerrm = 'ROLLBACK' then
      passed := v_touched = 2 and v_after = '0,0' and v_qoh = 0;
      detail := format('touched=%s batches=%s qoh=%s', v_touched, v_after, v_qoh);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T3 asking for more than the store holds is refused and changes nothing.
  begin
    insert into public.products (name, status, price, quantity_on_hand)
      values ('TEST sell_from_batches', 'inactive', 1, 6) returning id into v_product;
    insert into public.stock_batches (product_id, store_id, quantity_remaining, unit_cost, created_at) values
      (v_product, v_store, 2, 1.00, '2026-01-01'), (v_product, v_store, 4, 1.00, '2026-01-02');
    insert into public.sales (product_id, store_id, sold_by, quantity, sale_price, sale_group_id)
      values (v_product, v_store, v_user, 7, 1.00, gen_random_uuid()) returning id into v_sale;
    begin
      v_touched := public.sell_from_batches(v_product, v_store, 7, 1.00, v_sale, v_user);
      v_err := 'no error raised';
    exception when others then v_err := sqlerrm;
    end;
    select string_agg(quantity_remaining::text, ',' order by created_at) into v_after
      from public.stock_batches where product_id = v_product;
    select count(*)::text into v_movs from public.stock_movements where sale_id = v_sale;
    select quantity_on_hand into v_qoh from public.products where id = v_product;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T3 a shortfall is refused and nothing changes';
    if sqlerrm = 'ROLLBACK' then
      passed := v_err = 'Недостатъчна наличност: липсват 1 бр.' and v_after = '2,4' and v_movs = '0' and v_qoh = 6;
      detail := format('error=%s batches=%s movements=%s qoh=%s', v_err, v_after, v_movs, v_qoh);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T4 zero and negative quantities are refused.
  begin
    perform public.sell_from_batches(gen_random_uuid(), v_store, 0, 1.00, gen_random_uuid(), v_user);
    test := 'T4 quantity 0 refused'; passed := false; detail := 'accepted'; return next;
  exception when others then
    test := 'T4 quantity 0 refused'; passed := sqlerrm like 'quantity must be positive%'; detail := sqlerrm; return next;
  end;
  begin
    perform public.sell_from_batches(gen_random_uuid(), v_store, -3, 1.00, gen_random_uuid(), v_user);
    test := 'T5 negative quantity refused'; passed := false; detail := 'accepted'; return next;
  exception when others then
    test := 'T5 negative quantity refused'; passed := sqlerrm like 'quantity must be positive%'; detail := sqlerrm; return next;
  end;

  -- T6 the counter never goes below zero, as decrement_product_stock never did.
  begin
    insert into public.products (name, status, price, quantity_on_hand)
      values ('TEST sell_from_batches', 'inactive', 1, 1) returning id into v_product;
    insert into public.stock_batches (product_id, store_id, quantity_remaining, unit_cost)
      values (v_product, v_store, 5, 1.00);
    insert into public.sales (product_id, store_id, sold_by, quantity, sale_price, sale_group_id)
      values (v_product, v_store, v_user, 3, 1.00, gen_random_uuid()) returning id into v_sale;
    perform public.sell_from_batches(v_product, v_store, 3, 1.00, v_sale, v_user);
    select quantity_on_hand into v_qoh from public.products where id = v_product;
    raise exception 'ROLLBACK';
  exception when others then
    test := 'T6 counter floors at 0';
    if sqlerrm = 'ROLLBACK' then passed := v_qoh = 0; detail := format('counter 1, sold 3 -> %s', v_qoh);
    else passed := false; detail := 'unexpected: ' || sqlerrm; end if;
    return next;
  end;

  -- T7, T8 only the server may call it.
  begin
    set local role anon;
    perform public.sell_from_batches(gen_random_uuid(), v_store, 1, 1.00, gen_random_uuid(), v_user);
    reset role;
    test := 'T7 anon refused'; passed := false; detail := 'anon could execute'; return next;
  exception when others then
    reset role;
    test := 'T7 anon refused'; passed := sqlstate = '42501'; detail := sqlstate || ' ' || sqlerrm; return next;
  end;
  begin
    set local role authenticated;
    perform public.sell_from_batches(gen_random_uuid(), v_store, 1, 1.00, gen_random_uuid(), v_user);
    reset role;
    test := 'T8 signed-in user refused'; passed := false; detail := 'authenticated could execute'; return next;
  exception when others then
    reset role;
    test := 'T8 signed-in user refused'; passed := sqlstate = '42501'; detail := sqlstate || ' ' || sqlerrm; return next;
  end;

  -- T9 nothing is left behind.
  test := 'T9 nothing left behind';
  passed := not exists (select 1 from public.products where name = 'TEST sell_from_batches');
  detail := 'no TEST products remain'; return next;
end $$;

select * from pg_temp.sell_from_batches_tests();
