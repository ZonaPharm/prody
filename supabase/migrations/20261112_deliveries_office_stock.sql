-- Доставки: стока от Офис в пратките (Владимир, 2026-11-12). On top of the phase 1–3
-- delivery migrations and 20261111_deliveries_trip_edit.
--
-- Until now every shipment line came from a delivery plan row. In practice Офис also
-- sends what it already holds (stock that came before the system, or that Офис keeps so
-- the stores are not overfilled), and a store often calls at the last minute for "one
-- more box". Both now go through the trip, so the stock is moved with a record and the
-- store confirms it like everything else:
--
--   shipment_lines   plan_id and delivery_item_id may both be null: a line of Office
--                    stock ("от Офис"). One such line per product and shipment.
--   office_free_stock what Офис can send per product without a delivery: its stock minus
--                    what open deliveries still need and what already waits in a shipment.
--   add_office_stock products and quantities from Офис into one store's shipment of an
--                    open trip (or of a new trip when p_trip_id is null). A packed
--                    shipment is opened for packing again: it is packed and signed anew.
--                    Never more than office_free_stock says is free.
--   send_trip, confirm_shipment, resolve_signal (replaced) — the same as before for
--                    delivery lines; an Office line moves FIFO from Офис like the others
--                    but has no plan row or delivery to update.
--
-- Schema: delivery_events type 'office_added'. The tables are new (phase 1) and the
-- check swaps are instant. Re-runnable. Same rules as the other delivery functions:
-- SECURITY INVOKER, empty search_path, fully qualified names, Bulgarian messages for
-- anything the user can fix, service_role only.

ALTER TABLE public.shipment_lines ALTER COLUMN plan_id DROP NOT NULL;
ALTER TABLE public.shipment_lines ALTER COLUMN delivery_item_id DROP NOT NULL;

-- Both set (a delivery line) or both null (Office stock).
ALTER TABLE public.shipment_lines DROP CONSTRAINT IF EXISTS shipment_lines_source_check;
ALTER TABLE public.shipment_lines ADD CONSTRAINT shipment_lines_source_check
  CHECK ((plan_id IS NULL) = (delivery_item_id IS NULL));

-- One Office line per product in a shipment: adding more raises its quantity.
CREATE UNIQUE INDEX IF NOT EXISTS shipment_lines_office_product_key
  ON public.shipment_lines (shipment_id, product_id) WHERE plan_id IS NULL;

-- What waits in Office for a product, for the free-stock check.
CREATE INDEX IF NOT EXISTS shipment_lines_product_id_idx ON public.shipment_lines (product_id);

ALTER TABLE public.delivery_events DROP CONSTRAINT IF EXISTS delivery_events_type_check;
ALTER TABLE public.delivery_events ADD CONSTRAINT delivery_events_type_check
  CHECK (type IN ('created', 'saved', 'received', 'plan_changed', 'ready', 'trip_created',
                  'packed', 'sent', 'store_received', 'signal_raised', 'signal_resolved',
                  'cancelled', 'completed', 'labelled', 'trip_changed', 'unpacked', 'office_added'));

-- ---------------------------------------------------------------------------
-- office_free_stock
--
-- What Офис can send to a store without a delivery, per product (one rule for
-- add_office_stock, "Добави от Офис" and the stores' "Заявки"):
--   on_hand        units in the warehouse's batches
--   for_deliveries units of open deliveries (expected, in_progress) still bound to them:
--                  planned for a store and not shipped yet, plus Офис's own share that
--                  still waits for its label. Per delivery line:
--                    LEAST(received − shipped,
--                          (planned for stores − shipped)
--                          + GREATEST(unlabelled − Σ(planned − ready) of the stores, 0))
--   in_shipments   Office lines (no delivery) in a packing or packed shipment
--   free           GREATEST(on_hand − for_deliveries − in_shipments, 0)
-- p_product_ids null = every product Офис holds.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.office_free_stock(p_product_ids uuid[] DEFAULT NULL)
RETURNS TABLE (product_id uuid, on_hand integer, for_deliveries integer, in_shipments integer, free integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  WITH wh AS (
    SELECT id FROM public.stores WHERE is_warehouse AND is_active
  ),
  stock AS (
    SELECT b.product_id, sum(b.quantity_remaining)::integer AS on_hand
    FROM public.stock_batches b JOIN wh ON wh.id = b.store_id
    WHERE b.quantity_remaining > 0
      AND (p_product_ids IS NULL OR b.product_id = ANY (p_product_ids))
    GROUP BY b.product_id
  ),
  plan AS (
    SELECT pl.delivery_item_id,
           sum(pl.planned_qty)::integer AS planned,
           sum(pl.shipped_qty)::integer AS shipped,
           sum(GREATEST(pl.planned_qty - pl.ready_qty, 0))::integer AS unready
    FROM public.delivery_item_plan pl
    JOIN public.stores s ON s.id = pl.store_id
    WHERE NOT coalesce(s.is_warehouse, false)
    GROUP BY pl.delivery_item_id
  ),
  bound AS (
    SELECT i.product_id,
           sum(GREATEST(LEAST(
             i.received_qty - coalesce(pl.shipped, 0),
             GREATEST(coalesce(pl.planned, 0) - coalesce(pl.shipped, 0), 0)
               + GREATEST((i.received_qty - i.labelled_qty) - coalesce(pl.unready, 0), 0)
           ), 0))::integer AS qty
    FROM public.delivery_items i
    JOIN public.deliveries d ON d.id = i.delivery_id
    LEFT JOIN plan pl ON pl.delivery_item_id = i.id
    WHERE d.status IN ('expected', 'in_progress')
      AND i.product_id IN (SELECT product_id FROM stock)
    GROUP BY i.product_id
  ),
  held AS (
    SELECT sl.product_id, sum(sl.qty)::integer AS qty
    FROM public.shipment_lines sl
    JOIN public.shipments sh ON sh.id = sl.shipment_id
    WHERE sl.plan_id IS NULL AND sh.status IN ('packing', 'packed')
      AND sl.product_id IN (SELECT product_id FROM stock)
    GROUP BY sl.product_id
  )
  SELECT st.product_id, st.on_hand,
         coalesce(b.qty, 0), coalesce(h.qty, 0),
         GREATEST(st.on_hand - coalesce(b.qty, 0) - coalesce(h.qty, 0), 0)
  FROM stock st
  LEFT JOIN bound b ON b.product_id = st.product_id
  LEFT JOIN held h ON h.product_id = st.product_id
$$;

-- ---------------------------------------------------------------------------
-- add_office_stock
--
-- p_lines = [{product_id, qty}], one row per product, qty > 0.
-- p_trip_id null starts a new trip with this one shipment.
-- The store's shipment in the trip, by status:
--   none        → a new one (packing)
--   cancelled   → it comes back (packing)
--   packing     → new lines, or more units on the product's Office line
--   packed      → opened again (packing, box count and signature cleared, 'unpacked'
--                 logged), then as packing
-- Never more than office_free_stock says is free: what open deliveries still need
-- (store plans, Офис's unlabelled share) and Office lines already in a shipment stay.
-- Returns {trip_id, trip_number, new_trip, shipment_id, shipment_number, store_id,
--          reopened, units, lines: [{product_id, qty}]}.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_office_stock(p_trip_id uuid, p_store_id uuid, p_user uuid, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_lines    jsonb := coalesce(p_lines, '[]'::jsonb);
  v_store    record;
  v_trip     record;
  v_ship     record;
  v_line     record;
  v_wh       uuid;
  v_wh_name  text;
  v_wh_count integer;
  v_ship_id  uuid;
  v_ship_no  integer;
  v_new_trip boolean := false;
  v_reopened boolean := false;
  v_units    integer := 0;
  v_out      jsonb := '[]'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF jsonb_typeof(v_lines) <> 'array' THEN
    RAISE EXCEPTION 'Редовете трябва да са списък';
  END IF;
  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Добавете поне един продукт';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_lines) AS x(product_id uuid, qty integer)
             WHERE x.product_id IS NULL OR x.qty IS NULL OR x.qty < 1) THEN
    RAISE EXCEPTION 'Всеки ред трябва да има продукт и брой поне 1';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_lines) AS x(product_id uuid, qty integer)
             GROUP BY x.product_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Продукт се повтаря: въведете го веднъж с общия брой';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_lines) AS x(product_id uuid, qty integer)
             LEFT JOIN public.products p ON p.id = x.product_id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Продуктът не е намерен';
  END IF;

  SELECT s.id, s.name, coalesce(s.is_warehouse, false) AS is_warehouse, s.is_active INTO v_store
  FROM public.stores s WHERE s.id = p_store_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Обектът не е намерен';
  END IF;
  IF v_store.is_warehouse THEN
    RAISE EXCEPTION 'Складът % не получава пратки', v_store.name;
  END IF;
  IF NOT v_store.is_active THEN
    RAISE EXCEPTION 'Обект % не е активен', v_store.name;
  END IF;

  SELECT count(*), (array_agg(id))[1], (array_agg(name))[1] INTO v_wh_count, v_wh, v_wh_name
  FROM public.stores WHERE is_warehouse AND is_active;
  IF v_wh_count <> 1 THEN
    RAISE EXCEPTION 'Трябва да има точно един активен склад (обект с is_warehouse), а има %', v_wh_count;
  END IF;

  -- The trip first, as the other trip functions do.
  IF p_trip_id IS NULL THEN
    INSERT INTO public.trips (created_by) VALUES (p_user) RETURNING id, number, status INTO v_trip;
    v_new_trip := true;
  ELSE
    SELECT id, number, status INTO v_trip FROM public.trips WHERE id = p_trip_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Курсът не е намерен';
    END IF;
    IF v_trip.status <> 'open' THEN
      RAISE EXCEPTION 'Курс К-% не се променя: той е %', lpad(v_trip.number::text, 6, '0'),
        CASE v_trip.status WHEN 'departed' THEN 'тръгнал' WHEN 'completed' THEN 'завършен' ELSE 'отказан' END;
    END IF;
    PERFORM 1 FROM public.shipments WHERE trip_id = v_trip.id ORDER BY id FOR UPDATE;
  END IF;

  SELECT sh.id, sh.number, sh.status, sh.box_count, sh.packed_by, sh.packed_at INTO v_ship
  FROM public.shipments sh WHERE sh.trip_id = v_trip.id AND sh.store_id = p_store_id;

  IF NOT FOUND THEN
    INSERT INTO public.shipments (trip_id, store_id, created_by)
    VALUES (v_trip.id, p_store_id, p_user)
    RETURNING id, number INTO v_ship_id, v_ship_no;
  ELSE
    v_ship_id := v_ship.id;
    v_ship_no := v_ship.number;
    IF v_ship.status = 'cancelled' THEN
      UPDATE public.shipments
      SET status = 'packing', box_count = NULL, packed_by = NULL, packed_at = NULL
      WHERE id = v_ship_id;
    ELSIF v_ship.status = 'packed' THEN
      UPDATE public.shipments
      SET status = 'packing', box_count = NULL, packed_by = NULL, packed_at = NULL
      WHERE id = v_ship_id;
      INSERT INTO public.delivery_events (trip_id, shipment_id, type, store_id, details, created_by)
      VALUES (v_trip.id, v_ship_id, 'unpacked', p_store_id,
              jsonb_build_object('number', v_ship_no, 'box_count', v_ship.box_count,
                                 'packed_by', v_ship.packed_by, 'packed_at', v_ship.packed_at,
                                 'reason', 'office_added'), p_user);
      v_reopened := true;
    END IF;
  END IF;

  -- Office's batches of these products, in the order sales and send_trip take them, so
  -- two additions of the same product queue here and the second sees the first.
  PERFORM 1 FROM public.stock_batches
  WHERE store_id = v_wh AND quantity_remaining > 0
    AND product_id IN (SELECT x.product_id FROM jsonb_to_recordset(v_lines) AS x(product_id uuid, qty integer))
  ORDER BY created_at, id
  FOR UPDATE;

  FOR v_line IN
    SELECT x.product_id, x.qty, p.name,
           coalesce(f.on_hand, 0) AS on_hand, coalesce(f.for_deliveries, 0) AS bound,
           coalesce(f.in_shipments, 0) AS held, coalesce(f.free, 0) AS free
    FROM jsonb_to_recordset(v_lines) AS x(product_id uuid, qty integer)
    JOIN public.products p ON p.id = x.product_id
    LEFT JOIN public.office_free_stock(
      ARRAY(SELECT y.product_id FROM jsonb_to_recordset(v_lines) AS y(product_id uuid, qty integer))) f
      ON f.product_id = x.product_id
    ORDER BY p.name, x.product_id
  LOOP
    IF v_line.qty > v_line.free THEN
      RAISE EXCEPTION 'Няма толкова „%“ в %: налични % бр., за доставки % бр., чакат в пратки % бр., свободни % бр.',
        v_line.name, v_wh_name, v_line.on_hand, v_line.bound, v_line.held, v_line.free;
    END IF;

    INSERT INTO public.shipment_lines (shipment_id, product_id, qty)
    VALUES (v_ship_id, v_line.product_id, v_line.qty)
    ON CONFLICT (shipment_id, product_id) WHERE plan_id IS NULL
    DO UPDATE SET qty = public.shipment_lines.qty + EXCLUDED.qty;

    v_units := v_units + v_line.qty;
    v_out := v_out || jsonb_build_array(jsonb_build_object('product_id', v_line.product_id, 'qty', v_line.qty));
  END LOOP;

  IF v_new_trip THEN
    INSERT INTO public.delivery_events (trip_id, type, details, created_by)
    VALUES (v_trip.id, 'trip_created',
            jsonb_build_object('number', v_trip.number, 'store_ids', jsonb_build_array(p_store_id),
                               'shipments', jsonb_build_array(jsonb_build_object(
                                 'shipment_id', v_ship_id, 'number', v_ship_no, 'store_id', p_store_id,
                                 'lines', jsonb_array_length(v_out), 'units', v_units)),
                               'office', true), p_user);
  END IF;

  INSERT INTO public.delivery_events (trip_id, shipment_id, type, store_id, qty, details, created_by)
  VALUES (v_trip.id, v_ship_id, 'office_added', p_store_id, v_units,
          jsonb_build_object('trip_number', v_trip.number, 'number', v_ship_no, 'lines', v_out,
                             'reopened', v_reopened, 'new_trip', v_new_trip), p_user);

  RETURN jsonb_build_object('trip_id', v_trip.id, 'trip_number', v_trip.number, 'new_trip', v_new_trip,
                            'shipment_id', v_ship_id, 'shipment_number', v_ship_no, 'store_id', p_store_id,
                            'reopened', v_reopened, 'units', v_units, 'lines', v_out);
END;
$$;

-- ---------------------------------------------------------------------------
-- send_trip (replaced): as in 20261111_deliveries_trip_edit, and an Office line (no plan
-- row, no delivery) leaves FIFO from Офис like the others.
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
                  JOIN public.shipments sh ON sh.id = sl.shipment_id
                  WHERE sh.trip_id = p_trip_id AND sl.plan_id IS NOT NULL)
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
        WHERE sh.trip_id = p_trip_id AND sl.plan_id IS NOT NULL GROUP BY sl.plan_id) x
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
      LEFT JOIN public.delivery_items i ON i.id = sl.delivery_item_id
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

      IF v_line.plan_id IS NOT NULL THEN
        UPDATE public.delivery_item_plan SET shipped_qty = shipped_qty + v_line.qty WHERE id = v_line.plan_id;
      END IF;
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
                            'delivery_ids', coalesce(jsonb_agg(DISTINCT i.delivery_id)
                                                       FILTER (WHERE i.delivery_id IS NOT NULL), '[]'::jsonb),
                            'office_units', coalesce(sum(sl.qty) FILTER (WHERE sl.plan_id IS NULL), 0)),
         p_driver
  FROM public.shipments sh
  JOIN public.shipment_lines sl ON sl.shipment_id = sh.id
  LEFT JOIN public.delivery_items i ON i.id = sl.delivery_item_id
  WHERE sh.trip_id = p_trip_id
  GROUP BY sh.id;

  RETURN jsonb_build_object('trip_id', p_trip_id, 'number', v_trip.number, 'shipments', v_ships,
                            'units', v_units, 'batches', v_batches);
END;
$$;

-- ---------------------------------------------------------------------------
-- confirm_shipment (replaced): as in 20261111_deliveries_trip_edit, and an Office line
-- is confirmed like the others; its shortfall signal has no delivery.
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
    LEFT JOIN public.delivery_items i ON i.id = sl.delivery_item_id
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
                          'qty_actual', v_line.received_qty, 'removed', v_removed, 'not_removed', v_rem,
                          'product_id', v_line.product_id),
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
                            'delivery_ids', (SELECT coalesce(jsonb_agg(DISTINCT i.delivery_id), '[]'::jsonb)
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
-- resolve_signal (replaced): as in 20261110_deliveries_functions, and a store shortfall
-- on an Office line resolved as 'found' puts the units back into the store at the cost
-- they arrived with (the shipment's transfer_in of the product), since there is no
-- delivery item to take the cost from.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_signal(p_signal_id uuid, p_user uuid, p_resolution text, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_role    text;
  v_sig     record;
  v_ship    record;
  v_product uuid;
  v_cost    numeric;
  v_item_id uuid;
  v_back    integer := 0;
  v_batch   uuid;
  v_short   integer;
  v_qty     integer;
  v_recv    integer;
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
      IF v_sig.delivery_item_id IS NOT NULL THEN
        SELECT i.product_id, i.unit_cost, i.id INTO v_product, v_cost, v_item_id
        FROM public.delivery_items i WHERE i.id = v_sig.delivery_item_id;
      ELSE
        -- An Office line: the product from the line (or the log, if the line is gone),
        -- the cost from what the shipment brought into the store.
        SELECT sl.product_id INTO v_product FROM public.shipment_lines sl WHERE sl.id = v_sig.shipment_line_id;
        IF v_product IS NULL THEN
          SELECT (e.details ->> 'product_id')::uuid INTO v_product
          FROM public.delivery_events e
          WHERE e.signal_id = p_signal_id AND e.type = 'signal_raised'
          ORDER BY e.created_at LIMIT 1;
        END IF;
        IF v_product IS NULL THEN
          RAISE EXCEPTION 'Продуктът на сигнала не е намерен';
        END IF;
        SELECT round(sum(m.quantity * m.unit_cost) / nullif(sum(m.quantity), 0), 4) INTO v_cost
        FROM public.stock_movements m
        WHERE m.shipment_id = v_sig.shipment_id AND m.product_id = v_product
          AND m.type = 'transfer_in' AND m.store_id = v_ship.store_id;
      END IF;

      INSERT INTO public.stock_batches (product_id, store_id, quantity_remaining, unit_cost, delivery_item_id)
      VALUES (v_product, v_ship.store_id, v_back, coalesce(v_cost, 0), v_item_id)
      RETURNING id INTO v_batch;

      INSERT INTO public.stock_movements
        (product_id, store_id, batch_id, type, quantity, unit_cost, delivery_id, shipment_id, notes, created_by)
      VALUES
        (v_product, v_ship.store_id, v_batch, 'correction', v_back, coalesce(v_cost, 0),
         v_sig.delivery_id, v_sig.shipment_id,
         'Намерени след липса при получаване на П-' || lpad(v_ship.number::text, 6, '0'), p_user);

      UPDATE public.products SET quantity_on_hand = quantity_on_hand + v_back WHERE id = v_product;
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

REVOKE ALL ON FUNCTION public.office_free_stock(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.office_free_stock(uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.add_office_stock(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_office_stock(uuid, uuid, uuid, jsonb) TO service_role;
-- Replaced functions keep their grants; restated so a fresh database ends up the same.
REVOKE ALL ON FUNCTION public.send_trip(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_trip(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.confirm_shipment(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_shipment(uuid, uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.resolve_signal(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_signal(uuid, uuid, text, text) TO service_role;
