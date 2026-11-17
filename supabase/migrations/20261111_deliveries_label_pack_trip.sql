-- Доставки, фаза 3: the signed checklists for labelling and packing, and taking back a
-- trip that has not left. On top of 20261110_deliveries_schema, 20261110_deliveries_functions
-- and 20261111_deliveries_draft_receive.
--
--   mark_ready_checked     — the "Етикетиране" checklist: ticked rows become ready, the
--                            "Не е наред" rows become label signals, in one transaction.
--   pack_shipment_checked  — the packing checklist of one shipment (П-…): every line ticked
--                            or marked, the box count, the signals, in one transaction.
--   cancel_trip            — a trip (К-…) that has not left is taken back: its shipments are
--                            marked cancelled, their lines removed, the ready units wait for
--                            the next trip.
--
-- Schema: trips and shipments get the status 'cancelled' and trips three nullable columns.
-- These tables are new (phase 1) and empty in production, so the check swap is instant.
-- Nothing in the existing tables changes. Re-runnable.
--
-- Same rules as the phase 1 functions: SECURITY INVOKER, empty search_path, fully qualified
-- names, Bulgarian messages for anything the user can fix, service_role only.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_status_check;
ALTER TABLE public.trips ADD CONSTRAINT trips_status_check
  CHECK (status IN ('open', 'departed', 'completed', 'cancelled'));

ALTER TABLE public.shipments DROP CONSTRAINT IF EXISTS shipments_status_check;
ALTER TABLE public.shipments ADD CONSTRAINT shipments_status_check
  CHECK (status IN ('packing', 'packed', 'sent', 'received', 'received_with_issues', 'cancelled'));

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS cancelled_by  uuid REFERENCES public.users(id);
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS cancel_reason text;

-- ---------------------------------------------------------------------------
-- mark_ready_checked
--
-- p_rows    = [{plan_id, qty}], qty > 0: units labelled and packed for that store
--             (mark_ready). Ticked rows and "Частично" rows land here.
-- p_signals = [{plan_id, reason, qty_expected, qty_actual, note}] for the "Не е наред" rows
--             other than "Частично". reason: damaged | wrong_label | wrong_product |
--             missing | other ('other' needs a note). The good units of such a row
--             (qty_actual) come in p_rows like any other.
-- At least one of the two must be non-empty. A plan row may appear once in each list.
-- Signals are raised first, then mark_ready checks every ceiling (plan, received, shipped).
-- Returns {ready: units, signals: n}.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_ready_checked(p_user uuid, p_rows jsonb, p_signals jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_rows    jsonb := coalesce(p_rows, '[]'::jsonb);
  v_signals jsonb := coalesce(p_signals, '[]'::jsonb);
  v_sig     record;
  v_n       integer := 0;
  v_units   integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF jsonb_typeof(v_rows) <> 'array' OR jsonb_typeof(v_signals) <> 'array' THEN
    RAISE EXCEPTION 'Редовете и сигналите трябва да са списъци';
  END IF;
  IF jsonb_array_length(v_rows) = 0 AND jsonb_array_length(v_signals) = 0 THEN
    RAISE EXCEPTION 'Нищо не е отметнато: отметнете готовите редове или отбележете „Не е наред“';
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r
             WHERE (r->>'plan_id') IS NULL OR (r->>'qty') IS NULL OR (r->>'qty')::integer <= 0) THEN
    RAISE EXCEPTION 'Всеки готов ред трябва да има ред от плана и количество над 0';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r GROUP BY r->>'plan_id' HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_signals) s GROUP BY s->>'plan_id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Ред от етикетирането се повтаря';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_signals) s
             LEFT JOIN public.delivery_item_plan pl ON pl.id = (s->>'plan_id')::uuid
             WHERE pl.id IS NULL) THEN
    RAISE EXCEPTION 'Ред от плана не е намерен';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_signals) s
             WHERE coalesce(s->>'reason', '') NOT IN ('damaged', 'wrong_label', 'wrong_product', 'missing', 'other')) THEN
    RAISE EXCEPTION 'Непозната причина в „Не е наред“';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_signals) s
             WHERE s->>'reason' = 'other' AND nullif(btrim(s->>'note'), '') IS NULL) THEN
    RAISE EXCEPTION 'За причина „Друго“ напишете кратка бележка';
  END IF;

  -- The signal names the store in its note: delivery_signals has no store column,
  -- and "Крем → Център: повредени 2" is what the admin needs to read.
  FOR v_sig IN
    SELECT pl.delivery_item_id AS item_id, st.name AS store, s->>'reason' AS reason,
           (s->>'qty_expected')::integer AS qty_expected, (s->>'qty_actual')::integer AS qty_actual,
           nullif(btrim(s->>'note'), '') AS note
    FROM jsonb_array_elements(v_signals) WITH ORDINALITY x(s, n)
    JOIN public.delivery_item_plan pl ON pl.id = (x.s->>'plan_id')::uuid
    JOIN public.stores st ON st.id = pl.store_id
    ORDER BY x.n
  LOOP
    PERFORM public.raise_signal(p_user, 'label', v_sig.reason, v_sig.item_id, NULL,
                                v_sig.qty_expected, v_sig.qty_actual,
                                concat_ws(': ', 'За ' || v_sig.store, v_sig.note));
    v_n := v_n + 1;
  END LOOP;

  IF jsonb_array_length(v_rows) > 0 THEN
    PERFORM public.mark_ready(p_user, v_rows);
    SELECT coalesce(sum((r->>'qty')::integer), 0) INTO v_units FROM jsonb_array_elements(v_rows) r;
  END IF;

  RETURN jsonb_build_object('ready', v_units, 'signals', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_ready_checked(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_ready_checked(uuid, jsonb, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- pack_shipment_checked
--
-- p_lines   = [{line_id, qty}] for EVERY line of the shipment: qty = what went into the
--             boxes (the line's qty when ticked, less for "Не е наред", 0 = nothing).
-- p_signals = [{line_id, reason, qty_expected, qty_actual, note}] for the "Не е наред"
--             rows other than "Частично" (which only packs less: the rest stays ready for
--             the next trip). reason: damaged | wrong_label | wrong_product | missing | other.
-- p_box_count >= 1.
--
-- A signalled line's missing units are no longer counted as ready (mark_ready with a
-- negative qty, after packing): they are damaged, mislabelled or not on the shelf, so the
-- next trip must not pick them up again. They show in "Етикетиране" once more.
-- Returns {lines, units, signals, unready}.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pack_shipment_checked(
  p_shipment_id uuid,
  p_user        uuid,
  p_lines       jsonb,
  p_box_count   integer,
  p_signals     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_lines   jsonb := coalesce(p_lines, '[]'::jsonb);
  v_signals jsonb := coalesce(p_signals, '[]'::jsonb);
  v_ship    record;
  v_bad     record;
  v_sig     record;
  v_unready jsonb := '[]'::jsonb;
  v_n       integer := 0;
  v_left    integer;
  v_units   integer;
  v_down    integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF jsonb_typeof(v_lines) <> 'array' OR jsonb_typeof(v_signals) <> 'array' THEN
    RAISE EXCEPTION 'Редовете и сигналите трябва да са списъци';
  END IF;

  SELECT sh.id, sh.number, sh.status, s.name AS store, t.status AS trip_status, t.number AS trip_no INTO v_ship
  FROM public.shipments sh
  JOIN public.stores s ON s.id = sh.store_id
  JOIN public.trips t ON t.id = sh.trip_id
  WHERE sh.id = p_shipment_id
  FOR UPDATE OF sh;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Пратката не е намерена';
  END IF;
  IF v_ship.status = 'cancelled' OR v_ship.trip_status = 'cancelled' THEN
    RAISE EXCEPTION 'Курс К-% е отказан: пратка П-% не се опакова', lpad(v_ship.trip_no::text, 6, '0'), lpad(v_ship.number::text, 6, '0');
  END IF;
  IF v_ship.status <> 'packing' THEN
    RAISE EXCEPTION 'Пратка П-% вече е %', lpad(v_ship.number::text, 6, '0'),
      CASE v_ship.status WHEN 'packed' THEN 'опакована' WHEN 'sent' THEN 'изпратена' ELSE 'получена' END;
  END IF;

  -- The checklist is complete: every line ticked or marked.
  SELECT count(*)::integer AS n, string_agg(p.name, ', ' ORDER BY p.name) AS names INTO v_bad
  FROM public.shipment_lines sl JOIN public.products p ON p.id = sl.product_id
  WHERE sl.shipment_id = p_shipment_id
    AND sl.id NOT IN (SELECT (l->>'line_id')::uuid FROM jsonb_array_elements(v_lines) l
                      WHERE (l->>'line_id') IS NOT NULL);
  IF v_bad.n > 0 THEN
    RAISE EXCEPTION 'Отметнете всеки ред на пратката (неотметнати % бр.: %)', v_bad.n, v_bad.names;
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_signals) s GROUP BY s->>'line_id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Ред от пратката се повтаря';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_signals) s
             LEFT JOIN public.shipment_lines sl ON sl.id = (s->>'line_id')::uuid AND sl.shipment_id = p_shipment_id
             WHERE sl.id IS NULL) THEN
    RAISE EXCEPTION 'Сигнал за ред, който не е от тази пратка';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_signals) s
             WHERE coalesce(s->>'reason', '') NOT IN ('damaged', 'wrong_label', 'wrong_product', 'missing', 'other')) THEN
    RAISE EXCEPTION 'Непозната причина в „Не е наред“';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_signals) s
             WHERE s->>'reason' = 'other' AND nullif(btrim(s->>'note'), '') IS NULL) THEN
    RAISE EXCEPTION 'За причина „Друго“ напишете кратка бележка';
  END IF;
  -- A signalled line packs less than it holds; otherwise there is nothing to un-ready.
  SELECT p.name INTO v_bad
  FROM jsonb_array_elements(v_signals) s
  JOIN public.shipment_lines sl ON sl.id = (s->>'line_id')::uuid
  JOIN public.products p ON p.id = sl.product_id
  LEFT JOIN jsonb_array_elements(v_lines) l ON (l->>'line_id')::uuid = sl.id
  WHERE coalesce((l->>'qty')::integer, sl.qty) >= sl.qty
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'При „Не е наред“ за „%“ опакованите са по-малко от реда', v_bad.name;
  END IF;

  -- What the signalled lines leave behind, read before pack_shipment changes them.
  SELECT coalesce(jsonb_agg(jsonb_build_object('plan_id', sl.plan_id, 'qty', -(sl.qty - (l->>'qty')::integer))), '[]'::jsonb)
    INTO v_unready
  FROM jsonb_array_elements(v_signals) s
  JOIN public.shipment_lines sl ON sl.id = (s->>'line_id')::uuid
  JOIN jsonb_array_elements(v_lines) l ON (l->>'line_id')::uuid = sl.id;

  FOR v_sig IN
    SELECT (s->>'line_id')::uuid AS line_id, s->>'reason' AS reason,
           (s->>'qty_expected')::integer AS qty_expected, (s->>'qty_actual')::integer AS qty_actual,
           nullif(btrim(s->>'note'), '') AS note
    FROM jsonb_array_elements(v_signals) WITH ORDINALITY x(s, n)
    ORDER BY x.n
  LOOP
    PERFORM public.raise_signal(p_user, 'pack', v_sig.reason, NULL, v_sig.line_id,
                                v_sig.qty_expected, v_sig.qty_actual, v_sig.note);
    v_n := v_n + 1;
  END LOOP;

  PERFORM public.pack_shipment(p_shipment_id, p_user, v_lines, p_box_count);

  IF jsonb_array_length(v_unready) > 0 THEN
    PERFORM public.mark_ready(p_user, v_unready);
    SELECT -coalesce(sum((u->>'qty')::integer), 0) INTO v_down FROM jsonb_array_elements(v_unready) u;
  END IF;

  SELECT count(*), coalesce(sum(qty), 0) INTO v_left, v_units
  FROM public.shipment_lines WHERE shipment_id = p_shipment_id;

  RETURN jsonb_build_object('lines', v_left, 'units', v_units, 'signals', v_n, 'unready', v_down);
END;
$$;

REVOKE ALL ON FUNCTION public.pack_shipment_checked(uuid, uuid, jsonb, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pack_shipment_checked(uuid, uuid, jsonb, integer, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- cancel_trip
--
-- Only a trip that has not left ('open'). Its shipments become 'cancelled' and their
-- lines are removed (a pack signal on a line keeps its shipment and item, as in
-- pack_shipment), so the ready units are free for the next trip. Nothing moves in stock:
-- an open trip has taken nothing out of Офис. The trip keeps its number and log; the
-- event 'cancelled' (trip_id set, no delivery) records what the shipments held.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_trip(p_trip_id uuid, p_user uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_trip    record;
  v_held    jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Напишете причина';
  END IF;

  SELECT id, number, status INTO v_trip FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Курсът не е намерен';
  END IF;
  IF v_trip.status <> 'open' THEN
    RAISE EXCEPTION 'Курс К-% не може да се откаже: той е %', lpad(v_trip.number::text, 6, '0'),
      CASE v_trip.status WHEN 'departed' THEN 'тръгнал' WHEN 'completed' THEN 'завършен' ELSE 'отказан' END;
  END IF;

  PERFORM 1 FROM public.shipments WHERE trip_id = p_trip_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.shipment_lines sl JOIN public.shipments sh ON sh.id = sl.shipment_id
    WHERE sh.trip_id = p_trip_id ORDER BY sl.id FOR UPDATE OF sl;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'shipment_id', sh.id, 'number', sh.number, 'store_id', sh.store_id, 'status', sh.status,
           'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object('plan_id', sl.plan_id, 'product_id', sl.product_id, 'qty', sl.qty)
                                               ORDER BY sl.id), '[]'::jsonb)
                     FROM public.shipment_lines sl WHERE sl.shipment_id = sh.id)) ORDER BY sh.number), '[]'::jsonb)
    INTO v_held
  FROM public.shipments sh WHERE sh.trip_id = p_trip_id;

  UPDATE public.delivery_signals SET shipment_line_id = NULL
  WHERE shipment_line_id IN (SELECT sl.id FROM public.shipment_lines sl
                             JOIN public.shipments sh ON sh.id = sl.shipment_id WHERE sh.trip_id = p_trip_id);
  DELETE FROM public.shipment_lines
  WHERE shipment_id IN (SELECT id FROM public.shipments WHERE trip_id = p_trip_id);

  UPDATE public.shipments SET status = 'cancelled' WHERE trip_id = p_trip_id;
  UPDATE public.trips
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = p_user, cancel_reason = btrim(p_reason)
  WHERE id = p_trip_id;

  INSERT INTO public.delivery_events (trip_id, type, details, created_by)
  VALUES (p_trip_id, 'cancelled',
          jsonb_build_object('kind', 'trip', 'number', v_trip.number, 'reason', btrim(p_reason), 'shipments', v_held),
          p_user);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_trip(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_trip(uuid, uuid, text) TO service_role;
