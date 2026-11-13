-- Deliveries, phase 1: the functions (contract: docs/superpowers/specs/2026-11-10-deliveries-phase1-db.md,
-- "Migration B"). Needs 20261110_deliveries_schema.sql.
--
-- Every write to the delivery tables and every stock change that comes with
-- it goes through one of these functions, in one transaction: if any rule is
-- broken the function raises (in Bulgarian, naming the product and the
-- numbers, for the screen) and nothing of the call stays. Nothing calls them
-- yet except transfer_stock, which replaces the read-compute-write in
-- /api/inventory/transfer.
--
-- Stock rules, as in 20261109_sell_from_batches_atomically:
-- * batches are the source of truth; they are taken FIFO by (created_at, id)
--   and locked FOR UPDATE in that order, so two writers of the same product
--   in the same store queue rather than lose a deduction;
-- * products.quantity_on_hand moves as quantity_on_hand +/- n in the same
--   transaction, never recomputed (a recount would read a snapshot from before
--   a concurrent sale committed and undo it). Moving stock between stores
--   leaves it unchanged;
-- * a function that touches several products works through them in
--   product_id order. Per product it locks the batches first and the product
--   row last, the same order as sell_from_batches, so a sale and a delivery
--   step on the same product queue instead of deadlocking. (Locking the
--   product rows up front would do the opposite: we would hold the product
--   and wait for a batch while the sale holds the batch and waits for the
--   product.)
--
-- New batches made by moving stock (transfer_stock, send_trip) take
-- clock_timestamp() rather than now(), so that the batches one call creates
-- keep their FIFO order in the target store instead of sharing one timestamp
-- and falling back to random ids.
--
-- Every function takes the signed-in user (p_user; p_driver for send_trip)
-- from the API and signs its delivery_events rows with it. transfer_stock
-- writes no event: it is not a delivery step, and its movements carry the
-- user as before.
--
-- The warehouse is the one active store with is_warehouse = true (Офис);
-- with none or several, the delivery functions raise.
--
-- Access: SECURITY INVOKER, search_path '', callable by service_role only.
-- EXECUTE is revoked from anon and authenticated explicitly: Supabase grants
-- it to them directly on new functions, and revoking from PUBLIC alone leaves
-- those grants in place.

-- ---------------------------------------------------------------------------
-- 1. transfer_stock: move stock between two stores.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.transfer_stock(
  p_product_id uuid,
  p_from_store uuid,
  p_to_store   uuid,
  p_quantity   integer,
  p_user       uuid,
  p_notes      text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_remaining integer := p_quantity;
  v_take      integer;
  v_batch     record;
  v_new       uuid;
  v_touched   integer := 0;
  v_product   text;
  v_from      text;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Количеството трябва да е положително, получено %', coalesce(p_quantity::text, 'нищо');
  END IF;
  IF p_from_store = p_to_store THEN
    RAISE EXCEPTION 'Същият обект: изберете друг обект, към който да се премести стоката';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  SELECT name INTO v_product FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Продуктът не е намерен';
  END IF;
  SELECT name INTO v_from FROM public.stores WHERE id = p_from_store;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Обектът, от който се мести, не е намерен';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_to_store) THEN
    RAISE EXCEPTION 'Обектът, към който се мести, не е намерен';
  END IF;

  FOR v_batch IN
    SELECT id, quantity_remaining, unit_cost
    FROM public.stock_batches
    WHERE product_id = p_product_id
      AND store_id = p_from_store
      AND quantity_remaining > 0
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining = 0;
    v_take := LEAST(v_remaining, v_batch.quantity_remaining);

    UPDATE public.stock_batches
    SET quantity_remaining = quantity_remaining - v_take
    WHERE id = v_batch.id;

    -- source_store_id as the old route wrote it: the other end of the move.
    INSERT INTO public.stock_movements
      (product_id, store_id, batch_id, type, quantity, unit_cost, source_store_id, notes, created_by)
    VALUES
      (p_product_id, p_from_store, v_batch.id, 'transfer_out', -v_take, v_batch.unit_cost, p_to_store, p_notes, p_user);

    INSERT INTO public.stock_batches (product_id, store_id, quantity_remaining, unit_cost, created_at)
    VALUES (p_product_id, p_to_store, v_take, v_batch.unit_cost, clock_timestamp())
    RETURNING id INTO v_new;

    INSERT INTO public.stock_movements
      (product_id, store_id, batch_id, type, quantity, unit_cost, source_store_id, notes, created_by)
    VALUES
      (p_product_id, p_to_store, v_new, 'transfer_in', v_take, v_batch.unit_cost, p_from_store, p_notes, p_user);

    v_remaining := v_remaining - v_take;
    v_touched := v_touched + 1;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Недостатъчна наличност на „%“ в %: налични % бр., поискани % бр.',
      v_product, v_from, p_quantity - v_remaining, p_quantity;
  END IF;

  RETURN v_touched;
END;
$$;

-- ---------------------------------------------------------------------------
-- 13. _complete_delivery_if_done (defined early: receive_delivery,
-- update_plan, confirm_shipment and resolve_signal call it, after their own
-- changes, because any of them can be the step that satisfies the last
-- condition). A delivery is completed when every item is fully received,
-- every plan row is fully shipped, every shipment carrying its items has been
-- received, and it has no open signal. Units received but not planned for
-- any store stay in the warehouse and do not hold completion back. Returns
-- whether it completed the delivery now.
--
-- Two refinements of the contract's rule (docs/superpowers/specs/
-- 2026-11-10-deliveries-phase1-db.md, item 13), both pending Владимир's
-- confirmation:
-- * Something must have been shipped: at least one plan row with
--   planned_qty > 0 (all of them are fully shipped by then). A delivery with
--   no plan yet, or only zero rows, stays in_progress after its last receipt,
--   so update_plan can still distribute it and cancel_delivery can still
--   take it back; both refuse a completed delivery.
-- * "Fully received" also counts an item the supplier sent short, once an
--   admin has resolved a 'receive' signal on it as 'returned_to_supplier':
--   the missing units are not coming. Without this, nothing lowers
--   received_qty < quantity, and after the first shipment cancel_delivery
--   refuses too, so a short delivery could never close. delivery_items.quantity
--   stays as ordered; the signal records the shortfall.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._complete_delivery_if_done(p_delivery_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND OR v_status NOT IN ('expected', 'in_progress') THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.delivery_items WHERE delivery_id = p_delivery_id) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.delivery_items i
             WHERE i.delivery_id = p_delivery_id AND i.received_qty < i.quantity
               AND NOT EXISTS (SELECT 1 FROM public.delivery_signals sg
                               WHERE sg.delivery_item_id = i.id AND sg.step = 'receive'
                                 AND sg.status = 'resolved' AND sg.resolution = 'returned_to_supplier')) THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.delivery_item_plan pl
                 JOIN public.delivery_items i ON i.id = pl.delivery_item_id
                 WHERE i.delivery_id = p_delivery_id AND pl.planned_qty > 0) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.delivery_item_plan pl
             JOIN public.delivery_items i ON i.id = pl.delivery_item_id
             WHERE i.delivery_id = p_delivery_id AND pl.shipped_qty <> pl.planned_qty) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.shipment_lines sl
             JOIN public.delivery_items i ON i.id = sl.delivery_item_id
             JOIN public.shipments sh ON sh.id = sl.shipment_id
             WHERE i.delivery_id = p_delivery_id
               AND sh.status NOT IN ('received', 'received_with_issues')) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.delivery_signals
             WHERE delivery_id = p_delivery_id AND status = 'open') THEN
    RETURN false;
  END IF;

  UPDATE public.deliveries
  SET status = 'completed', completed_at = now()
  WHERE id = p_delivery_id;

  INSERT INTO public.delivery_events (delivery_id, type, created_by)
  VALUES (p_delivery_id, 'completed', p_user);

  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. save_delivery: draft -> expected, with a number.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_delivery(p_delivery_id uuid, p_user uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_status text;
  v_items  integer;
  v_number integer;
  v_bad    record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;

  SELECT status INTO v_status FROM public.deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Доставката не е намерена';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Доставката вече е записана: тя е %',
      CASE v_status WHEN 'expected' THEN 'очаквана' WHEN 'in_progress' THEN 'в приемане'
                    WHEN 'completed' THEN 'приключена' WHEN 'cancelled' THEN 'отказана' ELSE v_status END;
  END IF;

  PERFORM 1 FROM public.delivery_items WHERE delivery_id = p_delivery_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.delivery_item_plan pl
    JOIN public.delivery_items i ON i.id = pl.delivery_item_id
    WHERE i.delivery_id = p_delivery_id ORDER BY pl.id FOR UPDATE OF pl;

  SELECT count(*) INTO v_items FROM public.delivery_items WHERE delivery_id = p_delivery_id;
  IF v_items = 0 THEN
    RAISE EXCEPTION 'Доставката няма редове';
  END IF;

  SELECT p.name AS product, s.name AS store INTO v_bad
  FROM public.delivery_item_plan pl
  JOIN public.delivery_items i ON i.id = pl.delivery_item_id
  JOIN public.products p ON p.id = i.product_id
  JOIN public.stores s ON s.id = pl.store_id
  WHERE i.delivery_id = p_delivery_id AND s.is_warehouse
  ORDER BY i.sort_order, i.id
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Складът % не може да е в плана (ред „%“): неразпределеното остава там', v_bad.store, v_bad.product;
  END IF;

  SELECT p.name AS product, i.quantity, sum(pl.planned_qty)::integer AS planned INTO v_bad
  FROM public.delivery_items i
  JOIN public.products p ON p.id = i.product_id
  JOIN public.delivery_item_plan pl ON pl.delivery_item_id = i.id
  WHERE i.delivery_id = p_delivery_id
  GROUP BY i.id, i.sort_order, p.name, i.quantity
  HAVING sum(pl.planned_qty) > i.quantity
  ORDER BY i.sort_order, i.id
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Разпределени са повече бройки, отколкото има в доставката: „%“ — план % бр., доставка % бр.',
      v_bad.product, v_bad.planned, v_bad.quantity;
  END IF;

  v_number := nextval('public.delivery_number_seq');

  UPDATE public.deliveries
  SET status = 'expected', number = v_number
  WHERE id = p_delivery_id;

  INSERT INTO public.delivery_events (delivery_id, type, details, created_by)
  VALUES (p_delivery_id, 'saved', jsonb_build_object('number', v_number, 'items', v_items), p_user);

  RETURN v_number;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. receive_delivery: parcels into the warehouse.
-- p_lines = [{item_id, qty}], qty > 0. Returns {received: units, auto_ready: units}.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.receive_delivery(p_delivery_id uuid, p_user uuid, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_delivery record;
  v_wh       uuid;
  v_wh_count integer;
  v_line     record;
  v_plan     record;
  v_batch    uuid;
  v_avail    integer;
  v_add      integer;
  v_received integer := 0;
  v_auto     integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Няма редове за приемане';
  END IF;

  SELECT id, status, number INTO v_delivery FROM public.deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Доставката не е намерена';
  END IF;
  IF v_delivery.status NOT IN ('expected', 'in_progress') THEN
    RAISE EXCEPTION 'Доставката не може да се приема: тя е %',
      CASE v_delivery.status WHEN 'draft' THEN 'чернова (първо я запишете)' WHEN 'completed' THEN 'приключена'
                             WHEN 'cancelled' THEN 'отказана' ELSE v_delivery.status END;
  END IF;

  SELECT count(*), (array_agg(id))[1] INTO v_wh_count, v_wh
  FROM public.stores WHERE is_warehouse AND is_active;
  IF v_wh_count <> 1 THEN
    RAISE EXCEPTION 'Трябва да има точно един активен склад (обект с is_warehouse), а има %', v_wh_count;
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(item_id uuid, qty integer)
             WHERE x.item_id IS NULL OR x.qty IS NULL OR x.qty <= 0) THEN
    RAISE EXCEPTION 'Всеки ред трябва да има артикул и положително количество';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(item_id uuid, qty integer)
             LEFT JOIN public.delivery_items i ON i.id = x.item_id AND i.delivery_id = p_delivery_id
             WHERE i.id IS NULL) THEN
    RAISE EXCEPTION 'Ред от приемането не е от тази доставка';
  END IF;

  PERFORM 1 FROM public.delivery_items i
  WHERE i.id IN (SELECT x.item_id FROM jsonb_to_recordset(p_lines) AS x(item_id uuid, qty integer))
  ORDER BY i.product_id, i.id
  FOR UPDATE;

  FOR v_line IN
    SELECT i.id, i.product_id, i.quantity, i.received_qty, i.unit_cost, p.name, p.needs_label, x.qty
    FROM (SELECT r.item_id, sum(r.qty)::integer AS qty
          FROM jsonb_to_recordset(p_lines) AS r(item_id uuid, qty integer)
          GROUP BY r.item_id) x
    JOIN public.delivery_items i ON i.id = x.item_id
    JOIN public.products p ON p.id = i.product_id
    ORDER BY i.product_id, i.id
  LOOP
    IF v_line.received_qty + v_line.qty > v_line.quantity THEN
      RAISE EXCEPTION 'Приемане над доставеното за „%“: в доставката % бр., приети % бр., сега % бр.',
        v_line.name, v_line.quantity, v_line.received_qty, v_line.qty;
    END IF;

    INSERT INTO public.stock_batches (product_id, store_id, quantity_remaining, unit_cost, delivery_item_id)
    VALUES (v_line.product_id, v_wh, v_line.qty, v_line.unit_cost, v_line.id)
    RETURNING id INTO v_batch;

    INSERT INTO public.stock_movements
      (product_id, store_id, batch_id, type, quantity, unit_cost, delivery_id, notes, created_by)
    VALUES
      (v_line.product_id, v_wh, v_batch, 'restock', v_line.qty, v_line.unit_cost, p_delivery_id,
       'Доставка Д-' || lpad(v_delivery.number::text, 6, '0'), p_user);

    UPDATE public.products
    SET quantity_on_hand = quantity_on_hand + v_line.qty,
        cost_price = v_line.unit_cost
    WHERE id = v_line.product_id;

    UPDATE public.delivery_items
    SET received_qty = received_qty + v_line.qty
    WHERE id = v_line.id;

    INSERT INTO public.delivery_events (delivery_id, delivery_item_id, type, store_id, qty, details, created_by)
    VALUES (p_delivery_id, v_line.id, 'received', v_wh, v_line.qty, jsonb_build_object('batch_id', v_batch), p_user);

    v_received := v_received + v_line.qty;

    -- No label needed: ready at once, plan rows in store-name order, up to
    -- what is received and not yet ready.
    IF NOT v_line.needs_label THEN
      PERFORM 1 FROM public.delivery_item_plan WHERE delivery_item_id = v_line.id ORDER BY id FOR UPDATE;
      SELECT v_line.received_qty + v_line.qty - coalesce(sum(ready_qty), 0) INTO v_avail
      FROM public.delivery_item_plan WHERE delivery_item_id = v_line.id;

      FOR v_plan IN
        SELECT pl.id, pl.store_id, pl.planned_qty - pl.ready_qty AS open_qty
        FROM public.delivery_item_plan pl
        JOIN public.stores s ON s.id = pl.store_id
        WHERE pl.delivery_item_id = v_line.id AND pl.ready_qty < pl.planned_qty
        ORDER BY s.name, pl.id
      LOOP
        EXIT WHEN v_avail <= 0;
        v_add := LEAST(v_plan.open_qty, v_avail);
        UPDATE public.delivery_item_plan SET ready_qty = ready_qty + v_add WHERE id = v_plan.id;
        INSERT INTO public.delivery_events
          (delivery_id, delivery_item_id, plan_id, type, store_id, qty, details, created_by)
        VALUES
          (p_delivery_id, v_line.id, v_plan.id, 'ready', v_plan.store_id, v_add, jsonb_build_object('auto', true), p_user);
        v_auto := v_auto + v_add;
        v_avail := v_avail - v_add;
      END LOOP;
    END IF;
  END LOOP;

  IF v_delivery.status = 'expected' THEN
    UPDATE public.deliveries SET status = 'in_progress' WHERE id = p_delivery_id;
  END IF;

  -- The last receipt can be what completes a delivery: everything planned has
  -- already been shipped and confirmed, and these units are the unallocated
  -- rest, which stays in the warehouse. A delivery with nothing planned does
  -- not complete here (see _complete_delivery_if_done): it still waits for
  -- its plan.
  PERFORM public._complete_delivery_if_done(p_delivery_id, p_user);

  RETURN jsonb_build_object('received', v_received, 'auto_ready', v_auto);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. update_plan: upsert plan rows of one item. p_rows = [{store_id, planned_qty}].
-- Rows not listed stay as they are.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_plan(p_item_id uuid, p_user uuid, p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_delivery_id uuid;
  v_status      text;
  v_item        record;
  v_row         record;
  v_bad         text;
  v_before      jsonb;
  v_after       jsonb;
  v_before_sum  integer;
  v_sum         integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Няма редове за плана';
  END IF;

  SELECT delivery_id INTO v_delivery_id FROM public.delivery_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Редът от доставката не е намерен';
  END IF;
  SELECT status INTO v_status FROM public.deliveries WHERE id = v_delivery_id FOR UPDATE;
  IF v_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Планът не може да се променя: доставката е %',
      CASE v_status WHEN 'completed' THEN 'приключена' ELSE 'отказана' END;
  END IF;

  SELECT i.id, i.quantity, p.name INTO v_item
  FROM public.delivery_items i JOIN public.products p ON p.id = i.product_id
  WHERE i.id = p_item_id
  FOR UPDATE OF i;

  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rows) AS x(store_id uuid, planned_qty integer)
             WHERE x.store_id IS NULL OR x.planned_qty IS NULL OR x.planned_qty < 0) THEN
    RAISE EXCEPTION 'Всеки ред от плана трябва да има обект и количество 0 или повече';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rows) AS x(store_id uuid, planned_qty integer)
             GROUP BY x.store_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Обект се повтаря в плана';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rows) AS x(store_id uuid, planned_qty integer)
             LEFT JOIN public.stores s ON s.id = x.store_id WHERE s.id IS NULL) THEN
    RAISE EXCEPTION 'Обектът не е намерен';
  END IF;
  SELECT s.name INTO v_bad
  FROM jsonb_to_recordset(p_rows) AS x(store_id uuid, planned_qty integer)
  JOIN public.stores s ON s.id = x.store_id
  WHERE s.is_warehouse
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Складът % не може да е в плана: неразпределеното остава там', v_bad;
  END IF;

  PERFORM 1 FROM public.delivery_item_plan WHERE delivery_item_id = p_item_id ORDER BY id FOR UPDATE;

  SELECT coalesce(jsonb_object_agg(store_id::text, planned_qty), '{}'::jsonb), coalesce(sum(planned_qty), 0)
  INTO v_before, v_before_sum
  FROM public.delivery_item_plan WHERE delivery_item_id = p_item_id;

  FOR v_row IN
    SELECT x.store_id, x.planned_qty, s.name AS store, s.is_active, pl.id AS plan_id, pl.ready_qty
    FROM jsonb_to_recordset(p_rows) AS x(store_id uuid, planned_qty integer)
    JOIN public.stores s ON s.id = x.store_id
    LEFT JOIN public.delivery_item_plan pl ON pl.delivery_item_id = p_item_id AND pl.store_id = x.store_id
    ORDER BY s.name, s.id
  LOOP
    IF v_row.plan_id IS NOT NULL THEN
      IF v_row.planned_qty < v_row.ready_qty THEN
        RAISE EXCEPTION 'Планът за „%“ към % не може да е под готовите: готови % бр., нов план % бр.',
          v_item.name, v_row.store, v_row.ready_qty, v_row.planned_qty;
      END IF;
      UPDATE public.delivery_item_plan SET planned_qty = v_row.planned_qty WHERE id = v_row.plan_id;
    ELSE
      IF NOT v_row.is_active THEN
        RAISE EXCEPTION 'Обект % не е активен и не може да се добави в плана', v_row.store;
      END IF;
      INSERT INTO public.delivery_item_plan (delivery_item_id, store_id, planned_qty)
      VALUES (p_item_id, v_row.store_id, v_row.planned_qty);
    END IF;
  END LOOP;

  SELECT coalesce(jsonb_object_agg(store_id::text, planned_qty), '{}'::jsonb), coalesce(sum(planned_qty), 0)
  INTO v_after, v_sum
  FROM public.delivery_item_plan WHERE delivery_item_id = p_item_id;

  IF v_sum > v_item.quantity THEN
    RAISE EXCEPTION 'Планът за „%“ става % бр., а в доставката има % бр. (неразпределени бяха % бр.)',
      v_item.name, v_sum, v_item.quantity, GREATEST(v_item.quantity - v_before_sum, 0);
  END IF;

  INSERT INTO public.delivery_events (delivery_id, delivery_item_id, type, details, created_by)
  VALUES (v_delivery_id, p_item_id, 'plan_changed', jsonb_build_object('before', v_before, 'after', v_after), p_user);

  -- Lowering a plan row to what has already been shipped can be what
  -- completes the delivery.
  PERFORM public._complete_delivery_if_done(v_delivery_id, p_user);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. mark_ready: labelled and ready per plan row. p_rows = [{plan_id, qty}];
-- a negative qty corrects, but never below what is already shipped plus what
-- already sits on lines of shipments that have not left ('packing' or
-- 'packed'). Without the second part, a row lowered after packing would make
-- send_trip refuse the whole trip, and a packed shipment cannot be unpacked.
-- To lower such a row, first lower the line in pack_shipment while the
-- shipment is still 'packing'.
--
-- The unsent quantity is read without locking shipments: create_trip, the
-- only function that adds units to unsent lines, locks the same plan rows
-- first, so it queues behind this call (and this call behind it); send_trip
-- also locks the plan rows; pack_shipment only lowers or removes lines, which
-- can only make this check stricter than needed, never too loose.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_ready(p_user uuid, p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_row record;
  v_bad record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Няма редове за готовност';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rows) AS x(plan_id uuid, qty integer)
             WHERE x.plan_id IS NULL OR x.qty IS NULL) THEN
    RAISE EXCEPTION 'Всеки ред трябва да има ред от плана и количество';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rows) AS x(plan_id uuid, qty integer)
             LEFT JOIN public.delivery_item_plan pl ON pl.id = x.plan_id WHERE pl.id IS NULL) THEN
    RAISE EXCEPTION 'Ред от плана не е намерен';
  END IF;

  -- Items, then their plan rows, each in id order.
  PERFORM 1 FROM public.delivery_items i
  WHERE i.id IN (SELECT pl.delivery_item_id FROM public.delivery_item_plan pl
                 WHERE pl.id IN (SELECT x.plan_id FROM jsonb_to_recordset(p_rows) AS x(plan_id uuid, qty integer)))
  ORDER BY i.id
  FOR UPDATE;
  PERFORM 1 FROM public.delivery_item_plan pl
  WHERE pl.id IN (SELECT x.plan_id FROM jsonb_to_recordset(p_rows) AS x(plan_id uuid, qty integer))
  ORDER BY pl.id
  FOR UPDATE;

  SELECT d.number, d.status INTO v_bad
  FROM public.delivery_item_plan pl
  JOIN public.delivery_items i ON i.id = pl.delivery_item_id
  JOIN public.deliveries d ON d.id = i.delivery_id
  WHERE pl.id IN (SELECT x.plan_id FROM jsonb_to_recordset(p_rows) AS x(plan_id uuid, qty integer))
    AND d.status NOT IN ('expected', 'in_progress')
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Доставка Д-% не е в работа: тя е %', lpad(coalesce(v_bad.number::text, '-'), 6, '0'),
      CASE v_bad.status WHEN 'draft' THEN 'чернова' WHEN 'completed' THEN 'приключена'
                        WHEN 'cancelled' THEN 'отказана' ELSE v_bad.status END;
  END IF;

  FOR v_row IN
    SELECT pl.id, pl.delivery_item_id, pl.store_id, pl.planned_qty, pl.ready_qty, pl.shipped_qty,
           i.delivery_id, p.name AS product, s.name AS store, x.qty,
           coalesce(u.qty, 0) AS unsent_qty, u.trips
    FROM (SELECT r.plan_id, sum(r.qty)::integer AS qty
          FROM jsonb_to_recordset(p_rows) AS r(plan_id uuid, qty integer)
          GROUP BY r.plan_id) x
    JOIN public.delivery_item_plan pl ON pl.id = x.plan_id
    JOIN public.delivery_items i ON i.id = pl.delivery_item_id
    JOIN public.products p ON p.id = i.product_id
    JOIN public.stores s ON s.id = pl.store_id
    LEFT JOIN LATERAL (
      SELECT sum(sl.qty)::integer AS qty,
             string_agg(DISTINCT 'К-' || lpad(t.number::text, 6, '0'), ', ') AS trips
      FROM public.shipment_lines sl
      JOIN public.shipments sh ON sh.id = sl.shipment_id
      JOIN public.trips t ON t.id = sh.trip_id
      WHERE sl.plan_id = pl.id AND sh.status IN ('packing', 'packed')
    ) u ON true
    WHERE x.qty <> 0
    ORDER BY pl.id
  LOOP
    IF v_row.ready_qty + v_row.qty < v_row.shipped_qty THEN
      RAISE EXCEPTION 'Готовите за „%“ към % не могат да паднат под изпратените: изпратени % бр., готови биха станали % бр.',
        v_row.product, v_row.store, v_row.shipped_qty, v_row.ready_qty + v_row.qty;
    END IF;
    IF v_row.ready_qty + v_row.qty < v_row.shipped_qty + v_row.unsent_qty THEN
      RAISE EXCEPTION 'Готовите за „%“ към % не могат да паднат под сложените в курс %, който още не е тръгнал: в курса % бр., изпратени % бр., готови биха станали % бр. Първо намалете реда при опаковането',
        v_row.product, v_row.store, v_row.trips, v_row.unsent_qty, v_row.shipped_qty, v_row.ready_qty + v_row.qty;
    END IF;
    IF v_row.ready_qty + v_row.qty > v_row.planned_qty THEN
      RAISE EXCEPTION 'Готовите за „%“ към % надхвърлят плана: план % бр., готови биха станали % бр.',
        v_row.product, v_row.store, v_row.planned_qty, v_row.ready_qty + v_row.qty;
    END IF;

    UPDATE public.delivery_item_plan SET ready_qty = ready_qty + v_row.qty WHERE id = v_row.id;

    INSERT INTO public.delivery_events
      (delivery_id, delivery_item_id, plan_id, type, store_id, qty, created_by)
    VALUES
      (v_row.delivery_id, v_row.delivery_item_id, v_row.id, 'ready', v_row.store_id, v_row.qty, p_user);
  END LOOP;

  SELECT p.name, i.received_qty, sum(pl.ready_qty)::integer AS ready INTO v_bad
  FROM public.delivery_items i
  JOIN public.products p ON p.id = i.product_id
  JOIN public.delivery_item_plan pl ON pl.delivery_item_id = i.id
  WHERE i.id IN (SELECT pl2.delivery_item_id FROM public.delivery_item_plan pl2
                 WHERE pl2.id IN (SELECT x.plan_id FROM jsonb_to_recordset(p_rows) AS x(plan_id uuid, qty integer)))
  GROUP BY i.id, p.name, i.received_qty
  HAVING sum(pl.ready_qty) > i.received_qty
  ORDER BY i.id
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Готови % бр. от „%“, а са приети само % бр.', v_bad.ready, v_bad.name, v_bad.received_qty;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. create_trip: a trip with one 'packing' shipment per store that has
-- anything ready, collecting ready rows from every open delivery.
-- Returns {trip_id, number, shipments: [{shipment_id, number, store_id, lines}]}
-- where lines is the number of lines.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_trip(p_user uuid, p_store_ids uuid[], p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_trip_id   uuid;
  v_trip_no   integer;
  v_store     record;
  v_cand      record;
  v_ship_id   uuid;
  v_ship_no   integer;
  v_lines     integer;
  v_units     integer;
  v_shipments jsonb := '[]'::jsonb;
  v_bad       text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF p_store_ids IS NULL OR cardinality(p_store_ids) = 0 THEN
    RAISE EXCEPTION 'Изберете поне един обект';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_store_ids) AS x(id) LEFT JOIN public.stores s ON s.id = x.id WHERE s.id IS NULL) THEN
    RAISE EXCEPTION 'Обектът не е намерен';
  END IF;
  SELECT s.name INTO v_bad FROM public.stores s WHERE s.id = ANY (p_store_ids) AND s.is_warehouse LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Складът % не получава пратки', v_bad;
  END IF;

  -- Lock the candidate plan rows; a second create_trip for the same stores
  -- waits here and then sees this trip's lines as already taken.
  PERFORM 1 FROM public.delivery_item_plan pl
  JOIN public.delivery_items i ON i.id = pl.delivery_item_id
  JOIN public.deliveries d ON d.id = i.delivery_id
  WHERE pl.store_id = ANY (p_store_ids)
    AND d.status IN ('expected', 'in_progress')
    AND pl.ready_qty > pl.shipped_qty
  ORDER BY pl.id
  FOR UPDATE OF pl;

  INSERT INTO public.trips (created_by, notes) VALUES (p_user, p_notes)
  RETURNING id, number INTO v_trip_id, v_trip_no;

  FOR v_store IN
    SELECT s.id, s.name FROM public.stores s WHERE s.id = ANY (p_store_ids) ORDER BY s.name, s.id
  LOOP
    v_ship_id := NULL;
    v_lines := 0;
    v_units := 0;
    FOR v_cand IN
      SELECT pl.id AS plan_id, pl.delivery_item_id, i.product_id,
             pl.ready_qty - pl.shipped_qty
               - coalesce((SELECT sum(sl.qty) FROM public.shipment_lines sl
                           JOIN public.shipments sh ON sh.id = sl.shipment_id
                           WHERE sl.plan_id = pl.id AND sh.status IN ('packing', 'packed')), 0) AS qty
      FROM public.delivery_item_plan pl
      JOIN public.delivery_items i ON i.id = pl.delivery_item_id
      JOIN public.deliveries d ON d.id = i.delivery_id
      WHERE pl.store_id = v_store.id
        AND d.status IN ('expected', 'in_progress')
        AND pl.ready_qty > pl.shipped_qty
      ORDER BY d.number, i.sort_order, i.id
    LOOP
      CONTINUE WHEN v_cand.qty <= 0;
      IF v_ship_id IS NULL THEN
        INSERT INTO public.shipments (trip_id, store_id, created_by)
        VALUES (v_trip_id, v_store.id, p_user)
        RETURNING id, number INTO v_ship_id, v_ship_no;
      END IF;
      INSERT INTO public.shipment_lines (shipment_id, plan_id, delivery_item_id, product_id, qty)
      VALUES (v_ship_id, v_cand.plan_id, v_cand.delivery_item_id, v_cand.product_id, v_cand.qty);
      v_lines := v_lines + 1;
      v_units := v_units + v_cand.qty;
    END LOOP;

    IF v_ship_id IS NOT NULL THEN
      v_shipments := v_shipments || jsonb_build_array(jsonb_build_object(
        'shipment_id', v_ship_id, 'number', v_ship_no, 'store_id', v_store.id, 'lines', v_lines, 'units', v_units));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_shipments) = 0 THEN
    RAISE EXCEPTION 'Няма готови стоки за избраните обекти';
  END IF;

  INSERT INTO public.delivery_events (trip_id, type, details, created_by)
  VALUES (v_trip_id, 'trip_created',
          jsonb_build_object('number', v_trip_no, 'store_ids', to_jsonb(p_store_ids), 'shipments', v_shipments), p_user);

  RETURN jsonb_build_object('trip_id', v_trip_id, 'number', v_trip_no, 'shipments', v_shipments);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. pack_shipment: the packing checklist. p_lines = [{line_id, qty}] with
-- qty = what was packed: lower than the line lowers it, 0 removes it. Lines
-- not listed stay as they are.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pack_shipment(p_shipment_id uuid, p_user uuid, p_lines jsonb, p_box_count integer)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_ship    record;
  v_line    record;
  v_lines   jsonb := coalesce(p_lines, '[]'::jsonb);
  v_changes jsonb := '[]'::jsonb;
  v_left    integer;
  v_units   integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF p_box_count IS NULL OR p_box_count < 1 THEN
    RAISE EXCEPTION 'Броят кашони трябва да е поне 1';
  END IF;
  IF jsonb_typeof(v_lines) <> 'array' THEN
    RAISE EXCEPTION 'Редовете на опаковането трябва да са списък';
  END IF;

  SELECT sh.id, sh.number, sh.status, sh.trip_id, sh.store_id, s.name AS store INTO v_ship
  FROM public.shipments sh JOIN public.stores s ON s.id = sh.store_id
  WHERE sh.id = p_shipment_id
  FOR UPDATE OF sh;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Пратката не е намерена';
  END IF;
  IF v_ship.status <> 'packing' THEN
    RAISE EXCEPTION 'Пратка П-% не може да се опакова: тя е %', lpad(v_ship.number::text, 6, '0'),
      CASE v_ship.status WHEN 'packed' THEN 'опакована' WHEN 'sent' THEN 'изпратена'
                         ELSE 'получена' END;
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_lines) AS x(line_id uuid, qty integer)
             WHERE x.line_id IS NULL OR x.qty IS NULL OR x.qty < 0) THEN
    RAISE EXCEPTION 'Всеки ред трябва да има ред от пратката и количество 0 или повече';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_lines) AS x(line_id uuid, qty integer)
             GROUP BY x.line_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Ред от пратката се повтаря';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_lines) AS x(line_id uuid, qty integer)
             LEFT JOIN public.shipment_lines sl ON sl.id = x.line_id AND sl.shipment_id = p_shipment_id
             WHERE sl.id IS NULL) THEN
    RAISE EXCEPTION 'Ред от опаковането не е от тази пратка';
  END IF;

  PERFORM 1 FROM public.shipment_lines WHERE shipment_id = p_shipment_id ORDER BY id FOR UPDATE;

  FOR v_line IN
    SELECT sl.id, sl.qty AS line_qty, x.qty, p.name
    FROM jsonb_to_recordset(v_lines) AS x(line_id uuid, qty integer)
    JOIN public.shipment_lines sl ON sl.id = x.line_id
    JOIN public.products p ON p.id = sl.product_id
    ORDER BY sl.id
  LOOP
    IF v_line.qty > v_line.line_qty THEN
      RAISE EXCEPTION 'Опаковани % бр. от „%“, а в пратката са % бр.', v_line.qty, v_line.name, v_line.line_qty;
    END IF;
    IF v_line.qty = 0 THEN
      -- A pack-step signal about this line keeps its shipment and item.
      UPDATE public.delivery_signals SET shipment_line_id = NULL WHERE shipment_line_id = v_line.id;
      DELETE FROM public.shipment_lines WHERE id = v_line.id;
    ELSIF v_line.qty < v_line.line_qty THEN
      UPDATE public.shipment_lines SET qty = v_line.qty WHERE id = v_line.id;
    END IF;
    IF v_line.qty < v_line.line_qty THEN
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'line_id', v_line.id, 'from', v_line.line_qty, 'to', v_line.qty));
    END IF;
  END LOOP;

  SELECT count(*), coalesce(sum(qty), 0) INTO v_left, v_units
  FROM public.shipment_lines WHERE shipment_id = p_shipment_id;
  IF v_left = 0 THEN
    RAISE EXCEPTION 'Пратка П-% за % остава празна: оставете поне един ред', lpad(v_ship.number::text, 6, '0'), v_ship.store;
  END IF;

  UPDATE public.shipments
  SET status = 'packed', packed_by = p_user, packed_at = now(), box_count = p_box_count
  WHERE id = p_shipment_id;

  INSERT INTO public.delivery_events (trip_id, shipment_id, type, store_id, qty, details, created_by)
  VALUES (v_ship.trip_id, p_shipment_id, 'packed', v_ship.store_id, v_units,
          jsonb_build_object('box_count', p_box_count, 'lines', v_left, 'changes', v_changes), p_user);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. send_trip: the driver signs and the whole trip leaves the warehouse in
-- one transaction. Stock is taken FIFO from the warehouse's batches of the
-- product (Офис also sells, so not necessarily the delivery's own batches).
-- Returns {trip_id, number, shipments, units, batches}.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_trip(p_trip_id uuid, p_driver uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_trip     record;
  v_wh       uuid;
  v_wh_name  text;
  v_wh_count integer;
  v_ships    integer;
  v_bad      record;
  v_prod     record;
  v_line     record;
  v_batch    record;
  v_avail    integer;
  v_rem      integer;
  v_take     integer;
  v_new      uuid;
  v_units    integer := 0;
  v_batches  integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_driver) THEN
    RAISE EXCEPTION 'Непознат шофьор (потребител)';
  END IF;

  SELECT id, number, status INTO v_trip FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Курсът не е намерен';
  END IF;
  IF v_trip.status <> 'open' THEN
    RAISE EXCEPTION 'Курс К-% вече е тръгнал', lpad(v_trip.number::text, 6, '0');
  END IF;

  SELECT count(*), (array_agg(id))[1], (array_agg(name))[1] INTO v_wh_count, v_wh, v_wh_name
  FROM public.stores WHERE is_warehouse AND is_active;
  IF v_wh_count <> 1 THEN
    RAISE EXCEPTION 'Трябва да има точно един активен склад (обект с is_warehouse), а има %', v_wh_count;
  END IF;

  PERFORM 1 FROM public.shipments WHERE trip_id = p_trip_id ORDER BY id FOR UPDATE;
  SELECT count(*) INTO v_ships FROM public.shipments WHERE trip_id = p_trip_id;
  IF v_ships = 0 THEN
    RAISE EXCEPTION 'Курс К-% няма пратки', lpad(v_trip.number::text, 6, '0');
  END IF;

  SELECT sh.number, s.name AS store INTO v_bad
  FROM public.shipments sh JOIN public.stores s ON s.id = sh.store_id
  WHERE sh.trip_id = p_trip_id AND sh.status <> 'packed'
  ORDER BY s.name LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Пратка П-% за % още не е опакована', lpad(v_bad.number::text, 6, '0'), v_bad.store;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.shipment_lines sl JOIN public.shipments sh ON sh.id = sl.shipment_id
                 WHERE sh.trip_id = p_trip_id) THEN
    RAISE EXCEPTION 'Курс К-% няма нито един ред', lpad(v_trip.number::text, 6, '0');
  END IF;

  PERFORM 1 FROM public.delivery_item_plan pl
  WHERE pl.id IN (SELECT sl.plan_id FROM public.shipment_lines sl
                  JOIN public.shipments sh ON sh.id = sl.shipment_id WHERE sh.trip_id = p_trip_id)
  ORDER BY pl.id
  FOR UPDATE;

  SELECT d.number, d.status INTO v_bad
  FROM public.shipment_lines sl
  JOIN public.shipments sh ON sh.id = sl.shipment_id
  JOIN public.delivery_items i ON i.id = sl.delivery_item_id
  JOIN public.deliveries d ON d.id = i.delivery_id
  WHERE sh.trip_id = p_trip_id AND d.status NOT IN ('expected', 'in_progress')
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Доставка Д-% в курса е %: махнете я от пратките', lpad(v_bad.number::text, 6, '0'),
      CASE v_bad.status WHEN 'completed' THEN 'приключена' WHEN 'cancelled' THEN 'отказана' ELSE v_bad.status END;
  END IF;

  SELECT p.name AS product, s.name AS store, pl.ready_qty, pl.shipped_qty, x.qty INTO v_bad
  FROM (SELECT sl.plan_id, sum(sl.qty)::integer AS qty
        FROM public.shipment_lines sl JOIN public.shipments sh ON sh.id = sl.shipment_id
        WHERE sh.trip_id = p_trip_id GROUP BY sl.plan_id) x
  JOIN public.delivery_item_plan pl ON pl.id = x.plan_id
  JOIN public.delivery_items i ON i.id = pl.delivery_item_id
  JOIN public.products p ON p.id = i.product_id
  JOIN public.stores s ON s.id = pl.store_id
  WHERE pl.shipped_qty + x.qty > pl.ready_qty
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Изпращане над готовото за „%“ към %: готови % бр., вече изпратени % бр., сега % бр.',
      v_bad.product, v_bad.store, v_bad.ready_qty, v_bad.shipped_qty, v_bad.qty;
  END IF;

  FOR v_prod IN
    SELECT sl.product_id, p.name, sum(sl.qty)::integer AS need
    FROM public.shipment_lines sl
    JOIN public.shipments sh ON sh.id = sl.shipment_id
    JOIN public.products p ON p.id = sl.product_id
    WHERE sh.trip_id = p_trip_id
    GROUP BY sl.product_id, p.name
    ORDER BY sl.product_id
  LOOP
    PERFORM 1 FROM public.stock_batches
    WHERE product_id = v_prod.product_id AND store_id = v_wh AND quantity_remaining > 0
    ORDER BY created_at, id
    FOR UPDATE;
    SELECT coalesce(sum(quantity_remaining), 0) INTO v_avail
    FROM public.stock_batches WHERE product_id = v_prod.product_id AND store_id = v_wh;
    IF v_avail < v_prod.need THEN
      RAISE EXCEPTION 'Недостатъчна наличност в % за „%“: нужни % бр., налични % бр.',
        v_wh_name, v_prod.name, v_prod.need, v_avail;
    END IF;

    FOR v_line IN
      SELECT sl.id, sl.qty, sl.plan_id, sl.delivery_item_id, i.delivery_id, sh.id AS shipment_id, sh.store_id
      FROM public.shipment_lines sl
      JOIN public.shipments sh ON sh.id = sl.shipment_id
      JOIN public.stores s ON s.id = sh.store_id
      JOIN public.delivery_items i ON i.id = sl.delivery_item_id
      WHERE sh.trip_id = p_trip_id AND sl.product_id = v_prod.product_id
      ORDER BY s.name, sl.id
    LOOP
      v_rem := v_line.qty;
      FOR v_batch IN
        SELECT id, quantity_remaining, unit_cost
        FROM public.stock_batches
        WHERE product_id = v_prod.product_id AND store_id = v_wh AND quantity_remaining > 0
        ORDER BY created_at, id
        FOR UPDATE
      LOOP
        EXIT WHEN v_rem = 0;
        v_take := LEAST(v_rem, v_batch.quantity_remaining);

        UPDATE public.stock_batches SET quantity_remaining = quantity_remaining - v_take WHERE id = v_batch.id;

        INSERT INTO public.stock_movements
          (product_id, store_id, batch_id, type, quantity, unit_cost, source_store_id,
           delivery_id, shipment_id, created_by)
        VALUES
          (v_prod.product_id, v_wh, v_batch.id, 'transfer_out', -v_take, v_batch.unit_cost, v_line.store_id,
           v_line.delivery_id, v_line.shipment_id, p_driver);

        INSERT INTO public.stock_batches (product_id, store_id, quantity_remaining, unit_cost, delivery_item_id, created_at)
        VALUES (v_prod.product_id, v_line.store_id, v_take, v_batch.unit_cost, v_line.delivery_item_id, clock_timestamp())
        RETURNING id INTO v_new;

        INSERT INTO public.stock_movements
          (product_id, store_id, batch_id, type, quantity, unit_cost, source_store_id,
           delivery_id, shipment_id, created_by)
        VALUES
          (v_prod.product_id, v_line.store_id, v_new, 'transfer_in', v_take, v_batch.unit_cost, v_wh,
           v_line.delivery_id, v_line.shipment_id, p_driver);

        v_rem := v_rem - v_take;
        v_batches := v_batches + 1;
      END LOOP;

      IF v_rem > 0 THEN
        -- Cannot happen after the check above; kept so a bug cannot ship short.
        RAISE EXCEPTION 'Недостатъчна наличност в % за „%“: липсват % бр.', v_wh_name, v_prod.name, v_rem;
      END IF;

      UPDATE public.delivery_item_plan SET shipped_qty = shipped_qty + v_line.qty WHERE id = v_line.plan_id;
      v_units := v_units + v_line.qty;
    END LOOP;
  END LOOP;

  UPDATE public.shipments
  SET status = 'sent', sent_by = p_driver, sent_at = now()
  WHERE trip_id = p_trip_id;

  UPDATE public.trips
  SET status = 'departed', driver_id = p_driver, departed_at = now()
  WHERE id = p_trip_id;

  INSERT INTO public.delivery_events (trip_id, shipment_id, type, store_id, qty, details, created_by)
  SELECT sh.trip_id, sh.id, 'sent', sh.store_id, sum(sl.qty)::integer,
         jsonb_build_object('number', sh.number, 'lines', count(*), 'box_count', sh.box_count,
                            'delivery_ids', jsonb_agg(DISTINCT i.delivery_id)),
         p_driver
  FROM public.shipments sh
  JOIN public.shipment_lines sl ON sl.shipment_id = sh.id
  JOIN public.delivery_items i ON i.id = sl.delivery_item_id
  WHERE sh.trip_id = p_trip_id
  GROUP BY sh.id;

  RETURN jsonb_build_object('trip_id', p_trip_id, 'number', v_trip.number, 'shipments', v_ships,
                            'units', v_units, 'batches', v_batches);
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. confirm_shipment: the store ticks what arrived.
-- p_lines = [{line_id, received_qty, reason, note}], every line of the shipment.
-- Short lines raise a store_receive signal and the missing units leave the
-- store's stock (FIFO) until an admin resolves the signal. Returns
-- {status, signals, removed, not_removed}.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_shipment(p_shipment_id uuid, p_user uuid, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_user        record;
  v_trip_id     uuid;
  v_ship        record;
  v_lines       jsonb := coalesce(p_lines, '[]'::jsonb);
  v_line        record;
  v_batch       record;
  v_missing     integer;
  v_rem         integer;
  v_take        integer;
  v_removed     integer;
  v_signal      uuid;
  v_note        text;
  v_bad         record;
  v_issues      boolean := false;
  v_signals     integer := 0;
  v_removed_all integer := 0;
  v_kept_all    integer := 0;
  v_received    integer := 0;
  v_status      text;
  v_delivery    uuid;
BEGIN
  SELECT id, role, store_id INTO v_user FROM public.users WHERE id = p_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF jsonb_typeof(v_lines) <> 'array' THEN
    RAISE EXCEPTION 'Редовете за потвърждаване трябва да са списък';
  END IF;

  -- The trip first, as send_trip does: two shipments of one trip confirmed at
  -- once queue here, so the second sees the first and can complete the trip.
  SELECT trip_id INTO v_trip_id FROM public.shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Пратката не е намерена';
  END IF;
  PERFORM 1 FROM public.trips WHERE id = v_trip_id FOR UPDATE;

  SELECT sh.id, sh.number, sh.status, sh.trip_id, sh.store_id, s.name AS store INTO v_ship
  FROM public.shipments sh JOIN public.stores s ON s.id = sh.store_id
  WHERE sh.id = p_shipment_id
  FOR UPDATE OF sh;

  IF v_user.role <> 'admin' AND v_user.store_id IS DISTINCT FROM v_ship.store_id THEN
    RAISE EXCEPTION 'Само обект % или администратор може да потвърди пратка П-%',
      v_ship.store, lpad(v_ship.number::text, 6, '0');
  END IF;
  IF v_ship.status <> 'sent' THEN
    RAISE EXCEPTION 'Пратка П-% не очаква потвърждение: тя е %', lpad(v_ship.number::text, 6, '0'),
      CASE v_ship.status WHEN 'packing' THEN 'в опаковане' WHEN 'packed' THEN 'опакована, но не е изпратена'
                         ELSE 'вече получена' END;
  END IF;

  PERFORM 1 FROM public.shipment_lines WHERE shipment_id = p_shipment_id ORDER BY id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_lines) AS x(line_id uuid, received_qty integer, reason text, note text)
             WHERE x.line_id IS NULL OR x.received_qty IS NULL) THEN
    RAISE EXCEPTION 'Всеки ред трябва да има ред от пратката и получено количество';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_lines) AS x(line_id uuid, received_qty integer, reason text, note text)
             GROUP BY x.line_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Ред от пратката се повтаря';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_lines) AS x(line_id uuid, received_qty integer, reason text, note text)
             LEFT JOIN public.shipment_lines sl ON sl.id = x.line_id AND sl.shipment_id = p_shipment_id
             WHERE sl.id IS NULL) THEN
    RAISE EXCEPTION 'Ред от потвърждаването не е от тази пратка';
  END IF;
  SELECT count(*)::integer AS n, string_agg(p.name, ', ' ORDER BY p.name) AS names INTO v_bad
  FROM public.shipment_lines sl JOIN public.products p ON p.id = sl.product_id
  WHERE sl.shipment_id = p_shipment_id
    AND sl.id NOT IN (SELECT x.line_id FROM jsonb_to_recordset(v_lines) AS x(line_id uuid, received_qty integer, reason text, note text));
  IF v_bad.n > 0 THEN
    RAISE EXCEPTION 'Липсват редове от пратката: потвърдете всеки ред (% бр.: %)', v_bad.n, v_bad.names;
  END IF;
  SELECT p.name, sl.qty, x.received_qty INTO v_bad
  FROM jsonb_to_recordset(v_lines) AS x(line_id uuid, received_qty integer, reason text, note text)
  JOIN public.shipment_lines sl ON sl.id = x.line_id
  JOIN public.products p ON p.id = sl.product_id
  WHERE x.received_qty < 0 OR x.received_qty > sl.qty
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Получени % бр. от „%“, а са изпратени % бр.', v_bad.received_qty, v_bad.name, v_bad.qty;
  END IF;
  SELECT x.reason INTO v_bad
  FROM jsonb_to_recordset(v_lines) AS x(line_id uuid, received_qty integer, reason text, note text)
  JOIN public.shipment_lines sl ON sl.id = x.line_id
  WHERE x.received_qty < sl.qty
    AND nullif(btrim(x.reason), '') IS NOT NULL
    AND btrim(x.reason) NOT IN ('short', 'partial', 'damaged', 'wrong_product', 'wrong_label', 'missing', 'other')
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Непозната причина: %', v_bad.reason;
  END IF;

  FOR v_line IN
    SELECT sl.id, sl.qty, sl.product_id, sl.delivery_item_id, i.delivery_id, p.name,
           x.received_qty, coalesce(nullif(btrim(x.reason), ''), 'short') AS reason, nullif(btrim(x.note), '') AS note
    FROM jsonb_to_recordset(v_lines) AS x(line_id uuid, received_qty integer, reason text, note text)
    JOIN public.shipment_lines sl ON sl.id = x.line_id
    JOIN public.delivery_items i ON i.id = sl.delivery_item_id
    JOIN public.products p ON p.id = sl.product_id
    ORDER BY sl.product_id, sl.id
  LOOP
    UPDATE public.shipment_lines SET received_qty = v_line.received_qty WHERE id = v_line.id;
    v_received := v_received + v_line.received_qty;

    CONTINUE WHEN v_line.received_qty >= v_line.qty;

    v_issues := true;
    v_missing := v_line.qty - v_line.received_qty;
    v_rem := v_missing;

    FOR v_batch IN
      SELECT id, quantity_remaining, unit_cost
      FROM public.stock_batches
      WHERE product_id = v_line.product_id AND store_id = v_ship.store_id AND quantity_remaining > 0
      ORDER BY created_at, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_rem = 0;
      v_take := LEAST(v_rem, v_batch.quantity_remaining);
      UPDATE public.stock_batches SET quantity_remaining = quantity_remaining - v_take WHERE id = v_batch.id;
      INSERT INTO public.stock_movements
        (product_id, store_id, batch_id, type, quantity, unit_cost, delivery_id, shipment_id, notes, created_by)
      VALUES
        (v_line.product_id, v_ship.store_id, v_batch.id, 'correction', -v_take, v_batch.unit_cost,
         v_line.delivery_id, p_shipment_id, 'Липса при получаване на П-' || lpad(v_ship.number::text, 6, '0'), p_user);
      v_rem := v_rem - v_take;
    END LOOP;

    v_removed := v_missing - v_rem;
    IF v_removed > 0 THEN
      UPDATE public.products SET quantity_on_hand = quantity_on_hand - v_removed WHERE id = v_line.product_id;
    END IF;

    v_note := v_line.note;
    IF v_rem > 0 THEN
      v_note := concat_ws('. ', v_note, format(
        'Обектът вече е продал част: от наличността са извадени %s от %s липсващи бр., не са извадени %s бр.',
        v_removed, v_missing, v_rem));
    END IF;

    INSERT INTO public.delivery_signals
      (delivery_id, delivery_item_id, shipment_id, shipment_line_id, step, reason,
       qty_expected, qty_actual, note, created_by)
    VALUES
      (v_line.delivery_id, v_line.delivery_item_id, p_shipment_id, v_line.id, 'store_receive', v_line.reason,
       v_line.qty, v_line.received_qty, v_note, p_user)
    RETURNING id INTO v_signal;

    -- removed is what resolve_signal('found') puts back.
    INSERT INTO public.delivery_events
      (delivery_id, delivery_item_id, trip_id, shipment_id, signal_id, type, store_id, qty, details, created_by)
    VALUES
      (v_line.delivery_id, v_line.delivery_item_id, v_ship.trip_id, p_shipment_id, v_signal, 'signal_raised',
       v_ship.store_id, v_missing,
       jsonb_build_object('step', 'store_receive', 'reason', v_line.reason, 'qty_expected', v_line.qty,
                          'qty_actual', v_line.received_qty, 'removed', v_removed, 'not_removed', v_rem),
       p_user);

    v_signals := v_signals + 1;
    v_removed_all := v_removed_all + v_removed;
    v_kept_all := v_kept_all + v_rem;
  END LOOP;

  v_status := CASE WHEN v_issues THEN 'received_with_issues' ELSE 'received' END;

  UPDATE public.shipments
  SET status = v_status, received_by = p_user, received_at = now()
  WHERE id = p_shipment_id;

  IF NOT EXISTS (SELECT 1 FROM public.shipments
                 WHERE trip_id = v_ship.trip_id AND status NOT IN ('received', 'received_with_issues')) THEN
    UPDATE public.trips SET status = 'completed', completed_at = now() WHERE id = v_ship.trip_id;
  END IF;

  INSERT INTO public.delivery_events (trip_id, shipment_id, type, store_id, qty, details, created_by)
  SELECT v_ship.trip_id, p_shipment_id, 'store_received', v_ship.store_id, v_received,
         jsonb_build_object('number', v_ship.number, 'status', v_status, 'signals', v_signals,
                            'removed', v_removed_all, 'not_removed', v_kept_all,
                            'delivery_ids', (SELECT jsonb_agg(DISTINCT i.delivery_id)
                                             FROM public.shipment_lines sl
                                             JOIN public.delivery_items i ON i.id = sl.delivery_item_id
                                             WHERE sl.shipment_id = p_shipment_id)),
         p_user;

  FOR v_delivery IN
    SELECT DISTINCT i.delivery_id
    FROM public.shipment_lines sl JOIN public.delivery_items i ON i.id = sl.delivery_item_id
    WHERE sl.shipment_id = p_shipment_id
    ORDER BY i.delivery_id
  LOOP
    PERFORM public._complete_delivery_if_done(v_delivery, p_user);
  END LOOP;

  RETURN jsonb_build_object('status', v_status, 'signals', v_signals,
                            'removed', v_removed_all, 'not_removed', v_kept_all);
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. raise_signal: something is wrong at receiving, labelling or packing.
-- No stock changes. Returns the signal id.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.raise_signal(
  p_user             uuid,
  p_step             text,
  p_reason           text,
  p_delivery_item_id uuid,
  p_shipment_line_id uuid,
  p_qty_expected     integer,
  p_qty_actual       integer,
  p_note             text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_item     uuid := p_delivery_item_id;
  v_shipment uuid;
  v_line     record;
  v_delivery record;
  v_signal   uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF p_step = 'store_receive' THEN
    RAISE EXCEPTION 'Сигнал от обекта се подава при потвърждаване на пратката';
  END IF;
  IF p_step IS NULL OR p_step NOT IN ('receive', 'label', 'pack') THEN
    RAISE EXCEPTION 'Непознат етап: %', coalesce(p_step, 'нищо');
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('short', 'partial', 'damaged', 'wrong_product', 'wrong_label', 'missing', 'other') THEN
    RAISE EXCEPTION 'Непозната причина: %', coalesce(p_reason, 'нищо');
  END IF;
  IF p_qty_expected < 0 OR p_qty_actual < 0 THEN
    RAISE EXCEPTION 'Количествата в сигнала не могат да са отрицателни';
  END IF;
  IF p_delivery_item_id IS NULL AND p_shipment_line_id IS NULL THEN
    RAISE EXCEPTION 'Посочете ред от доставката или от пратката';
  END IF;

  IF p_shipment_line_id IS NOT NULL THEN
    SELECT delivery_item_id, shipment_id INTO v_line FROM public.shipment_lines WHERE id = p_shipment_line_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Редът от пратката не е намерен';
    END IF;
    IF p_delivery_item_id IS NOT NULL AND p_delivery_item_id <> v_line.delivery_item_id THEN
      RAISE EXCEPTION 'Редът от пратката е за друг ред от доставката';
    END IF;
    v_item := v_line.delivery_item_id;
    v_shipment := v_line.shipment_id;
  END IF;

  SELECT d.id, d.status INTO v_delivery
  FROM public.delivery_items i JOIN public.deliveries d ON d.id = i.delivery_id
  WHERE i.id = v_item;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Редът от доставката не е намерен';
  END IF;
  IF v_delivery.status IN ('draft', 'cancelled') THEN
    RAISE EXCEPTION 'Доставката е %: не може да се подаде сигнал',
      CASE v_delivery.status WHEN 'draft' THEN 'чернова' ELSE 'отказана' END;
  END IF;

  INSERT INTO public.delivery_signals
    (delivery_id, delivery_item_id, shipment_id, shipment_line_id, step, reason, qty_expected, qty_actual, note, created_by)
  VALUES
    (v_delivery.id, v_item, v_shipment, p_shipment_line_id, p_step, p_reason, p_qty_expected, p_qty_actual, p_note, p_user)
  RETURNING id INTO v_signal;

  INSERT INTO public.delivery_events
    (delivery_id, delivery_item_id, shipment_id, signal_id, type, qty, details, created_by)
  VALUES
    (v_delivery.id, v_item, v_shipment, v_signal, 'signal_raised', p_qty_actual,
     jsonb_build_object('step', p_step, 'reason', p_reason, 'qty_expected', p_qty_expected, 'qty_actual', p_qty_actual),
     p_user);

  RETURN v_signal;
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. resolve_signal: admins only. A store_receive signal resolved as 'found'
-- puts back into the store what confirm_shipment took out (normally all the
-- missing units; less if the store had already sold some), at the item's
-- unit cost. Other resolutions change no stock. A 'receive' signal resolved
-- as 'returned_to_supplier' closes the item's shortfall for the completion
-- check (see _complete_delivery_if_done).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_signal(p_signal_id uuid, p_user uuid, p_resolution text, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_role  text;
  v_sig   record;
  v_ship  record;
  v_item  record;
  v_back  integer := 0;
  v_batch uuid;
  v_short integer;
  v_qty   integer;
  v_recv  integer;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = p_user;
  IF NOT FOUND OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'Само администратор може да решава сигнали';
  END IF;
  IF p_resolution IS NULL OR p_resolution NOT IN ('corrected', 'returned_to_supplier', 'found', 'other') THEN
    RAISE EXCEPTION 'Непознато решение: %', coalesce(p_resolution, 'нищо');
  END IF;

  SELECT * INTO v_sig FROM public.delivery_signals WHERE id = p_signal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Сигналът не е намерен';
  END IF;
  IF v_sig.status <> 'open' THEN
    RAISE EXCEPTION 'Сигналът вече е решен';
  END IF;

  IF v_sig.step = 'store_receive' AND p_resolution = 'found' THEN
    SELECT coalesce((e.details ->> 'removed')::integer, v_sig.qty_expected - v_sig.qty_actual) INTO v_back
    FROM public.delivery_events e
    WHERE e.signal_id = p_signal_id AND e.type = 'signal_raised'
    ORDER BY e.created_at
    LIMIT 1;
    IF NOT FOUND THEN
      v_back := v_sig.qty_expected - v_sig.qty_actual;
    END IF;

    IF v_back > 0 THEN
      SELECT sh.number, sh.store_id INTO v_ship FROM public.shipments sh WHERE sh.id = v_sig.shipment_id;
      SELECT i.id, i.product_id, i.unit_cost INTO v_item
      FROM public.delivery_items i WHERE i.id = v_sig.delivery_item_id;

      INSERT INTO public.stock_batches (product_id, store_id, quantity_remaining, unit_cost, delivery_item_id)
      VALUES (v_item.product_id, v_ship.store_id, v_back, v_item.unit_cost, v_item.id)
      RETURNING id INTO v_batch;

      INSERT INTO public.stock_movements
        (product_id, store_id, batch_id, type, quantity, unit_cost, delivery_id, shipment_id, notes, created_by)
      VALUES
        (v_item.product_id, v_ship.store_id, v_batch, 'correction', v_back, v_item.unit_cost,
         v_sig.delivery_id, v_sig.shipment_id,
         'Намерени след липса при получаване на П-' || lpad(v_ship.number::text, 6, '0'), p_user);

      UPDATE public.products SET quantity_on_hand = quantity_on_hand + v_back WHERE id = v_item.product_id;
    END IF;
  END IF;

  -- A 'receive' signal resolved as returned_to_supplier closes the item's
  -- shortfall: _complete_delivery_if_done no longer waits for those units.
  -- The event records how many units that was. The item is read without a
  -- lock: receive_delivery locks the delivery before its items, and taking
  -- the item first here would invert that order.
  IF v_sig.step = 'receive' AND p_resolution = 'returned_to_supplier' AND v_sig.delivery_item_id IS NOT NULL THEN
    SELECT i.quantity, i.received_qty INTO v_qty, v_recv
    FROM public.delivery_items i WHERE i.id = v_sig.delivery_item_id;
    IF v_recv < v_qty THEN
      v_short := v_qty - v_recv;
    END IF;
  END IF;

  UPDATE public.delivery_signals
  SET status = 'resolved', resolution = p_resolution, resolution_note = p_note,
      resolved_by = p_user, resolved_at = now()
  WHERE id = p_signal_id;

  INSERT INTO public.delivery_events
    (delivery_id, delivery_item_id, shipment_id, signal_id, type, qty, details, created_by)
  VALUES
    (v_sig.delivery_id, v_sig.delivery_item_id, v_sig.shipment_id, p_signal_id, 'signal_resolved', v_back,
     jsonb_build_object('resolution', p_resolution, 'note', p_note, 'returned_to_store', v_back)
       || CASE WHEN v_short IS NOT NULL
               THEN jsonb_build_object('shortfall_closed', v_short, 'quantity', v_qty, 'received_qty', v_recv)
               ELSE '{}'::jsonb END,
     p_user);

  IF v_sig.delivery_id IS NOT NULL THEN
    PERFORM public._complete_delivery_if_done(v_sig.delivery_id, p_user);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 12. cancel_delivery: only before anything was shipped, and only while the
-- warehouse still holds everything that was received (else something was
-- sold or moved). The received stock leaves the warehouse with
-- delivery_cancel movements.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_delivery(p_delivery_id uuid, p_user uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_d        record;
  v_wh       uuid;
  v_wh_name  text;
  v_wh_count integer;
  v_bad      record;
  v_item     record;
  v_batch    record;
  v_left     integer;
  v_total    integer := 0;
  v_removed  jsonb := '[]'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Посочете причина за отказа';
  END IF;

  SELECT id, number, status INTO v_d FROM public.deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Доставката не е намерена';
  END IF;
  IF v_d.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Доставка Д-% е % и не може да се откаже', lpad(coalesce(v_d.number::text, '-'), 6, '0'),
      CASE v_d.status WHEN 'completed' THEN 'приключена' ELSE 'отказана' END;
  END IF;

  SELECT count(*), (array_agg(id))[1], (array_agg(name))[1] INTO v_wh_count, v_wh, v_wh_name
  FROM public.stores WHERE is_warehouse AND is_active;
  IF v_wh_count <> 1 THEN
    RAISE EXCEPTION 'Трябва да има точно един активен склад (обект с is_warehouse), а има %', v_wh_count;
  END IF;

  PERFORM 1 FROM public.delivery_items WHERE delivery_id = p_delivery_id ORDER BY product_id, id FOR UPDATE;
  PERFORM 1 FROM public.delivery_item_plan pl
    JOIN public.delivery_items i ON i.id = pl.delivery_item_id
    WHERE i.delivery_id = p_delivery_id ORDER BY pl.id FOR UPDATE OF pl;

  SELECT p.name, sum(pl.shipped_qty)::integer AS shipped INTO v_bad
  FROM public.delivery_item_plan pl
  JOIN public.delivery_items i ON i.id = pl.delivery_item_id
  JOIN public.products p ON p.id = i.product_id
  WHERE i.delivery_id = p_delivery_id
  GROUP BY i.id, p.name
  HAVING sum(pl.shipped_qty) > 0
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Доставката не може да се откаже: „%“ вече е изпратена към обектите (% бр.)', v_bad.name, v_bad.shipped;
  END IF;

  SELECT t.number INTO v_bad
  FROM public.shipment_lines sl
  JOIN public.delivery_items i ON i.id = sl.delivery_item_id
  JOIN public.shipments sh ON sh.id = sl.shipment_id
  JOIN public.trips t ON t.id = sh.trip_id
  WHERE i.delivery_id = p_delivery_id AND sh.status IN ('packing', 'packed')
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Доставката е в курс К-%, който още не е тръгнал: първо я махнете от пратките', lpad(v_bad.number::text, 6, '0');
  END IF;

  FOR v_item IN
    SELECT i.id, i.product_id, i.received_qty, p.name
    FROM public.delivery_items i JOIN public.products p ON p.id = i.product_id
    WHERE i.delivery_id = p_delivery_id AND i.received_qty > 0
    ORDER BY i.product_id, i.id
  LOOP
    PERFORM 1 FROM public.stock_batches
    WHERE delivery_item_id = v_item.id AND store_id = v_wh
    ORDER BY created_at, id
    FOR UPDATE;
    SELECT coalesce(sum(quantity_remaining), 0) INTO v_left
    FROM public.stock_batches WHERE delivery_item_id = v_item.id AND store_id = v_wh;
    IF v_left <> v_item.received_qty THEN
      RAISE EXCEPTION 'Доставката не може да се откаже: от „%“ са приети % бр., а в % от тази доставка са останали % бр. (част е продадена или преместена)',
        v_item.name, v_item.received_qty, v_wh_name, v_left;
    END IF;

    FOR v_batch IN
      SELECT id, quantity_remaining, unit_cost
      FROM public.stock_batches
      WHERE delivery_item_id = v_item.id AND store_id = v_wh AND quantity_remaining > 0
      ORDER BY created_at, id
    LOOP
      UPDATE public.stock_batches SET quantity_remaining = 0 WHERE id = v_batch.id;
      INSERT INTO public.stock_movements
        (product_id, store_id, batch_id, type, quantity, unit_cost, delivery_id, notes, created_by)
      VALUES
        (v_item.product_id, v_wh, v_batch.id, 'delivery_cancel', -v_batch.quantity_remaining, v_batch.unit_cost,
         p_delivery_id, p_reason, p_user);
    END LOOP;

    UPDATE public.products SET quantity_on_hand = quantity_on_hand - v_item.received_qty WHERE id = v_item.product_id;

    v_total := v_total + v_item.received_qty;
    v_removed := v_removed || jsonb_build_array(jsonb_build_object('item_id', v_item.id, 'qty', v_item.received_qty));
  END LOOP;

  UPDATE public.deliveries
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = p_user, cancel_reason = p_reason
  WHERE id = p_delivery_id;

  INSERT INTO public.delivery_events (delivery_id, type, store_id, qty, details, created_by)
  VALUES (p_delivery_id, 'cancelled', v_wh, v_total,
          jsonb_build_object('reason', p_reason, 'previous_status', v_d.status, 'removed', v_removed), p_user);
END;
$$;

-- ---------------------------------------------------------------------------
-- Access: service_role only.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.transfer_stock(uuid, uuid, uuid, integer, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_stock(uuid, uuid, uuid, integer, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.save_delivery(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_delivery(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.receive_delivery(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_delivery(uuid, uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.update_plan(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_plan(uuid, uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.mark_ready(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_ready(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.create_trip(uuid, uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_trip(uuid, uuid[], text) TO service_role;

REVOKE ALL ON FUNCTION public.pack_shipment(uuid, uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pack_shipment(uuid, uuid, jsonb, integer) TO service_role;

REVOKE ALL ON FUNCTION public.send_trip(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_trip(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.confirm_shipment(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_shipment(uuid, uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.raise_signal(uuid, text, text, uuid, uuid, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.raise_signal(uuid, text, text, uuid, uuid, integer, integer, text) TO service_role;

REVOKE ALL ON FUNCTION public.resolve_signal(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_signal(uuid, uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.cancel_delivery(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_delivery(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public._complete_delivery_if_done(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._complete_delivery_if_done(uuid, uuid) TO service_role;
