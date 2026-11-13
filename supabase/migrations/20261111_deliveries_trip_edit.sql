-- Доставки, фаза 3: changing a trip (К-…) before it leaves. On top of the phase 1–3
-- delivery migrations (20261111_deliveries_label_pack_trip, 20261111_deliveries_label_items).
--
--   add_to_trip      — what became ready after the trip was made goes into it: new lines
--                      or more units on a shipment still being packed, a new shipment for a
--                      store not yet in the trip. A packed shipment is not changed silently.
--   remove_shipment  — one store's shipment leaves a trip that has not left; its ready
--                      units wait for the next trip. The last shipment cannot be removed
--                      (that is "Откажи курса").
--   reopen_packing   — a packed shipment goes back to packing, so it can be packed and
--                      signed again (box count, a line found short).
--   send_trip, confirm_shipment (replaced) — a removed shipment ('cancelled') stays in the
--                      trip with no lines: it does not leave with the driver and does not
--                      keep the trip from being completed.
--
-- Schema: delivery_events types 'trip_changed' and 'unpacked'. The table is new (phase 1)
-- and empty in production, so the check swap is instant. Re-runnable.
--
-- Same rules as the other delivery functions: SECURITY INVOKER, empty search_path, fully
-- qualified names, Bulgarian messages for anything the user can fix, service_role only.

ALTER TABLE public.delivery_events DROP CONSTRAINT IF EXISTS delivery_events_type_check;
ALTER TABLE public.delivery_events ADD CONSTRAINT delivery_events_type_check
  CHECK (type IN ('created', 'saved', 'received', 'plan_changed', 'ready', 'trip_created',
                  'packed', 'sent', 'store_received', 'signal_raised', 'signal_resolved',
                  'cancelled', 'completed', 'labelled', 'trip_changed', 'unpacked'));

-- ---------------------------------------------------------------------------
-- add_to_trip
--
-- p_store_ids: the stores whose free ready units go into the trip now (free = ready, not
-- shipped, not on a packing or packed shipment). Per store, by name:
--   no shipment in the trip   → a new one (packing)
--   removed ('cancelled')     → it comes back (packing), with the new lines
--   packing                   → new lines, or more units on the line of the same plan row
--   packed                    → refused when there is something to add: open its packing first
-- A store with nothing free is skipped; nothing free at all is an error.
-- Returns {trip_id, number, shipments: [{shipment_id, number, store_id, lines, units}], units}.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_to_trip(p_trip_id uuid, p_user uuid, p_store_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_trip    record;
  v_store   record;
  v_ship    record;
  v_cand    record;
  v_ship_id uuid;
  v_ship_no integer;
  v_lines   integer;
  v_units   integer;
  v_total   integer := 0;
  v_out     jsonb := '[]'::jsonb;
  v_bad     text;
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

  SELECT id, number, status INTO v_trip FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Курсът не е намерен';
  END IF;
  IF v_trip.status <> 'open' THEN
    RAISE EXCEPTION 'Курс К-% не се променя: той е %', lpad(v_trip.number::text, 6, '0'),
      CASE v_trip.status WHEN 'departed' THEN 'тръгнал' WHEN 'completed' THEN 'завършен' ELSE 'отказан' END;
  END IF;

  PERFORM 1 FROM public.shipments WHERE trip_id = p_trip_id ORDER BY id FOR UPDATE;

  -- As create_trip: lock the candidate plan rows so two changes queue here.
  PERFORM 1 FROM public.delivery_item_plan pl
  JOIN public.delivery_items i ON i.id = pl.delivery_item_id
  JOIN public.deliveries d ON d.id = i.delivery_id
  WHERE pl.store_id = ANY (p_store_ids)
    AND d.status IN ('expected', 'in_progress')
    AND pl.ready_qty > pl.shipped_qty
  ORDER BY pl.id
  FOR UPDATE OF pl;

  FOR v_store IN
    SELECT s.id, s.name FROM public.stores s WHERE s.id = ANY (p_store_ids) ORDER BY s.name, s.id
  LOOP
    SELECT sh.id, sh.number, sh.status INTO v_ship
    FROM public.shipments sh WHERE sh.trip_id = p_trip_id AND sh.store_id = v_store.id;

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
        IF v_ship.status = 'packed' THEN
          RAISE EXCEPTION 'Пратка П-% за % е опакована: първо „Отвори опаковането“', lpad(v_ship.number::text, 6, '0'), v_store.name;
        END IF;
        IF v_ship.id IS NULL THEN
          INSERT INTO public.shipments (trip_id, store_id, created_by)
          VALUES (p_trip_id, v_store.id, p_user)
          RETURNING id, number INTO v_ship_id, v_ship_no;
        ELSE
          v_ship_id := v_ship.id;
          v_ship_no := v_ship.number;
          IF v_ship.status = 'cancelled' THEN
            UPDATE public.shipments
            SET status = 'packing', box_count = NULL, packed_by = NULL, packed_at = NULL
            WHERE id = v_ship_id;
          END IF;
        END IF;
      END IF;
      INSERT INTO public.shipment_lines (shipment_id, plan_id, delivery_item_id, product_id, qty)
      VALUES (v_ship_id, v_cand.plan_id, v_cand.delivery_item_id, v_cand.product_id, v_cand.qty)
      ON CONFLICT ON CONSTRAINT shipment_lines_shipment_plan_key
      DO UPDATE SET qty = public.shipment_lines.qty + EXCLUDED.qty;
      v_lines := v_lines + 1;
      v_units := v_units + v_cand.qty;
    END LOOP;

    IF v_ship_id IS NOT NULL THEN
      v_total := v_total + v_units;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'shipment_id', v_ship_id, 'number', v_ship_no, 'store_id', v_store.id, 'lines', v_lines, 'units', v_units));
    END IF;
  END LOOP;

  IF v_total = 0 THEN
    RAISE EXCEPTION 'Няма нова готова стока за избраните обекти';
  END IF;

  INSERT INTO public.delivery_events (trip_id, type, qty, details, created_by)
  VALUES (p_trip_id, 'trip_changed', v_total,
          jsonb_build_object('action', 'added', 'number', v_trip.number, 'store_ids', to_jsonb(p_store_ids),
                             'shipments', v_out), p_user);

  RETURN jsonb_build_object('trip_id', p_trip_id, 'number', v_trip.number, 'shipments', v_out, 'units', v_total);
END;
$$;

-- ---------------------------------------------------------------------------
-- remove_shipment
--
-- One store's shipment leaves a trip that has not left. Its lines are removed (a pack
-- signal on a line keeps its shipment and item, as in cancel_trip), the shipment stays
-- in the trip as 'cancelled' with its number, and the ready units wait for the next trip.
-- Nothing moves in stock. The last live shipment of a trip cannot be removed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.remove_shipment(p_shipment_id uuid, p_user uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_trip_id uuid;
  v_trip    record;
  v_ship    record;
  v_held    jsonb;
  v_units   integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Напишете причина';
  END IF;

  SELECT trip_id INTO v_trip_id FROM public.shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Пратката не е намерена';
  END IF;
  -- The trip first, as send_trip and cancel_trip do.
  SELECT id, number, status INTO v_trip FROM public.trips WHERE id = v_trip_id FOR UPDATE;
  SELECT sh.id, sh.number, sh.status, sh.store_id, s.name AS store INTO v_ship
  FROM public.shipments sh JOIN public.stores s ON s.id = sh.store_id
  WHERE sh.id = p_shipment_id
  FOR UPDATE OF sh;

  IF v_trip.status <> 'open' THEN
    RAISE EXCEPTION 'Курс К-% не се променя: той е %', lpad(v_trip.number::text, 6, '0'),
      CASE v_trip.status WHEN 'departed' THEN 'тръгнал' WHEN 'completed' THEN 'завършен' ELSE 'отказан' END;
  END IF;
  IF v_ship.status = 'cancelled' THEN
    RAISE EXCEPTION 'Пратка П-% вече е махната от курса', lpad(v_ship.number::text, 6, '0');
  END IF;
  IF EXISTS (SELECT 1 FROM public.shipments WHERE trip_id = v_trip_id AND id <> p_shipment_id) THEN
    PERFORM 1 FROM public.shipments WHERE trip_id = v_trip_id AND id <> p_shipment_id ORDER BY id FOR UPDATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shipments
                 WHERE trip_id = v_trip_id AND id <> p_shipment_id AND status <> 'cancelled') THEN
    RAISE EXCEPTION 'П-% е единствената пратка в курс К-%: откажете целия курс',
      lpad(v_ship.number::text, 6, '0'), lpad(v_trip.number::text, 6, '0');
  END IF;

  PERFORM 1 FROM public.shipment_lines WHERE shipment_id = p_shipment_id ORDER BY id FOR UPDATE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('plan_id', sl.plan_id, 'product_id', sl.product_id, 'qty', sl.qty)
                            ORDER BY sl.id), '[]'::jsonb),
         coalesce(sum(sl.qty), 0)::integer
    INTO v_held, v_units
  FROM public.shipment_lines sl WHERE sl.shipment_id = p_shipment_id;

  UPDATE public.delivery_signals SET shipment_line_id = NULL
  WHERE shipment_line_id IN (SELECT id FROM public.shipment_lines WHERE shipment_id = p_shipment_id);
  DELETE FROM public.shipment_lines WHERE shipment_id = p_shipment_id;

  UPDATE public.shipments
  SET status = 'cancelled', box_count = NULL, packed_by = NULL, packed_at = NULL
  WHERE id = p_shipment_id;

  INSERT INTO public.delivery_events (trip_id, shipment_id, type, store_id, qty, details, created_by)
  VALUES (v_trip_id, p_shipment_id, 'trip_changed', v_ship.store_id, v_units,
          jsonb_build_object('action', 'removed', 'number', v_ship.number, 'status', v_ship.status,
                             'reason', btrim(p_reason), 'lines', v_held), p_user);
END;
$$;

-- ---------------------------------------------------------------------------
-- reopen_packing
--
-- A packed shipment of a trip that has not left goes back to 'packing': the box count
-- and the packing signature are cleared (the log keeps them), the lines stay as they
-- were packed. It is then packed and signed again with pack_shipment_checked.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reopen_packing(p_shipment_id uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_trip_id uuid;
  v_trip    record;
  v_ship    record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;

  SELECT trip_id INTO v_trip_id FROM public.shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Пратката не е намерена';
  END IF;
  SELECT id, number, status INTO v_trip FROM public.trips WHERE id = v_trip_id FOR UPDATE;
  SELECT sh.id, sh.number, sh.status, sh.store_id, sh.box_count, sh.packed_by, sh.packed_at INTO v_ship
  FROM public.shipments sh WHERE sh.id = p_shipment_id
  FOR UPDATE;

  IF v_trip.status <> 'open' THEN
    RAISE EXCEPTION 'Курс К-% не се променя: той е %', lpad(v_trip.number::text, 6, '0'),
      CASE v_trip.status WHEN 'departed' THEN 'тръгнал' WHEN 'completed' THEN 'завършен' ELSE 'отказан' END;
  END IF;
  IF v_ship.status <> 'packed' THEN
    RAISE EXCEPTION 'Пратка П-% не е опакована: тя е %', lpad(v_ship.number::text, 6, '0'),
      CASE v_ship.status WHEN 'packing' THEN 'в опаковане' WHEN 'cancelled' THEN 'махната от курса' ELSE v_ship.status END;
  END IF;

  UPDATE public.shipments
  SET status = 'packing', box_count = NULL, packed_by = NULL, packed_at = NULL
  WHERE id = p_shipment_id;

  INSERT INTO public.delivery_events (trip_id, shipment_id, type, store_id, details, created_by)
  VALUES (v_trip_id, p_shipment_id, 'unpacked', v_ship.store_id,
          jsonb_build_object('number', v_ship.number, 'box_count', v_ship.box_count,
                             'packed_by', v_ship.packed_by, 'packed_at', v_ship.packed_at), p_user);
END;
$$;

-- ---------------------------------------------------------------------------
-- send_trip (replaced): as in 20261110_deliveries_functions, and a removed shipment
-- ('cancelled') neither blocks the trip nor leaves with it.
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
  SELECT count(*) INTO v_ships FROM public.shipments WHERE trip_id = p_trip_id AND status <> 'cancelled';
  IF v_ships = 0 THEN
    RAISE EXCEPTION 'Курс К-% няма пратки', lpad(v_trip.number::text, 6, '0');
  END IF;

  SELECT sh.number, s.name AS store INTO v_bad
  FROM public.shipments sh JOIN public.stores s ON s.id = sh.store_id
  WHERE sh.trip_id = p_trip_id AND sh.status NOT IN ('packed', 'cancelled')
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
  WHERE trip_id = p_trip_id AND status = 'packed';

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
-- confirm_shipment (replaced): as in 20261110_deliveries_functions, and a removed
-- shipment ('cancelled') does not keep the trip from being completed.
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
                         WHEN 'cancelled' THEN 'махната от курса' ELSE 'вече получена' END;
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
                 WHERE trip_id = v_ship.trip_id AND status NOT IN ('received', 'received_with_issues', 'cancelled')) THEN
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

REVOKE ALL ON FUNCTION public.add_to_trip(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_to_trip(uuid, uuid, uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.remove_shipment(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_shipment(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.reopen_packing(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_packing(uuid, uuid) TO service_role;
-- Replaced functions keep their grants; restated so a fresh database ends up the same.
REVOKE ALL ON FUNCTION public.send_trip(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_trip(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.confirm_shipment(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_shipment(uuid, uuid, jsonb) TO service_role;
