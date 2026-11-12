-- Доставки: every received unit is labelled, also the units that stay in Офис (Офис
-- sells too, online). On top of 20261111_deliveries_label_pack_trip.
--
-- Before: "Етикетиране" listed plan rows "product → store" and a tick made those units
-- ready for that store; what stayed in Офис was never labelled. Now the checklist is per
-- delivery line: a tick says "these N units are labelled", whatever store they go to.
-- The labelled units then go by themselves to the stores of the plan that still need
-- some (in store-name order), and are ready for the next trip; the rest stay labelled in
-- Офис. A plan change after labelling moves labelled units between stores the same way.
--
--   delivery_items.labelled_qty    units of the line labelled (or needing no label)
--   delivery_items.unlabelled_qty  received − labelled, generated, for the list query
--   _auto_ready_item               labelled units not yet set aside → plan rows
--   label_items_checked            the new "Етикетиране" checklist (signed)
--   update_plan                    (replaced) a plan row may go below its ready units,
--                                  down to what has left or sits on a trip; then
--                                  _auto_ready_item
--   pack_shipment_checked          (replaced) units missing at packing are also no
--                                  longer labelled: they show in "Етикетиране" again
--
-- Products marked "Без етикет": their units count as labelled when received (trigger).
-- Invariant kept by a trigger: labelled_qty >= Σ ready_qty of the line, so the older
-- mark_ready / mark_ready_checked keep working (they also make units labelled).
-- A delivery still completes when everything planned is shipped and received; units in
-- Офис still waiting for a label keep showing in "Етикетиране" after that.
--
-- Additive; prod has no deliveries yet. Re-runnable. Same rules as before: SECURITY
-- INVOKER, empty search_path, Bulgarian messages, service_role only.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

ALTER TABLE public.delivery_items ADD COLUMN IF NOT EXISTS labelled_qty integer NOT NULL DEFAULT 0;

-- Existing lines: no-label products count as labelled when received; the others as far
-- as they were made ready for stores.
UPDATE public.delivery_items i
SET labelled_qty = GREATEST(
      CASE WHEN p.needs_label THEN 0 ELSE i.received_qty END,
      coalesce((SELECT sum(pl.ready_qty) FROM public.delivery_item_plan pl WHERE pl.delivery_item_id = i.id), 0))
FROM public.products p
WHERE p.id = i.product_id
  AND i.labelled_qty < GREATEST(
      CASE WHEN p.needs_label THEN 0 ELSE i.received_qty END,
      coalesce((SELECT sum(pl.ready_qty) FROM public.delivery_item_plan pl WHERE pl.delivery_item_id = i.id), 0));

ALTER TABLE public.delivery_items DROP CONSTRAINT IF EXISTS delivery_items_labelled_qty_check;
ALTER TABLE public.delivery_items ADD CONSTRAINT delivery_items_labelled_qty_check
  CHECK (labelled_qty >= 0 AND labelled_qty <= received_qty);

ALTER TABLE public.delivery_items ADD COLUMN IF NOT EXISTS unlabelled_qty integer
  GENERATED ALWAYS AS (received_qty - labelled_qty) STORED;
CREATE INDEX IF NOT EXISTS delivery_items_unlabelled_idx ON public.delivery_items (delivery_id) WHERE unlabelled_qty > 0;

ALTER TABLE public.delivery_events DROP CONSTRAINT IF EXISTS delivery_events_type_check;
ALTER TABLE public.delivery_events ADD CONSTRAINT delivery_events_type_check
  CHECK (type IN ('created', 'saved', 'received', 'plan_changed', 'ready', 'trip_created',
                  'packed', 'sent', 'store_received', 'signal_raised', 'signal_resolved',
                  'cancelled', 'completed', 'labelled'));

-- No-label products: received units are labelled units.
CREATE OR REPLACE FUNCTION public.delivery_items_no_label_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.received_qty > OLD.received_qty
     AND EXISTS (SELECT 1 FROM public.products WHERE id = NEW.product_id AND NOT needs_label) THEN
    NEW.labelled_qty := NEW.labelled_qty + (NEW.received_qty - OLD.received_qty);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.delivery_items_no_label_received() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS delivery_items_no_label_received ON public.delivery_items;
CREATE TRIGGER delivery_items_no_label_received
  BEFORE UPDATE OF received_qty ON public.delivery_items
  FOR EACH ROW EXECUTE FUNCTION public.delivery_items_no_label_received();

-- Ready units are labelled units: whoever raises ready_qty (mark_ready included) raises
-- labelled_qty with it when needed.
CREATE OR REPLACE FUNCTION public.delivery_plan_keep_labelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_ready integer;
BEGIN
  SELECT coalesce(sum(ready_qty), 0) INTO v_ready
  FROM public.delivery_item_plan WHERE delivery_item_id = NEW.delivery_item_id;
  -- Never above what was received: mark_ready refuses that itself, with its own message.
  UPDATE public.delivery_items SET labelled_qty = LEAST(v_ready, received_qty)
  WHERE id = NEW.delivery_item_id AND labelled_qty < LEAST(v_ready, received_qty);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.delivery_plan_keep_labelled() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS delivery_plan_keep_labelled ON public.delivery_item_plan;
CREATE TRIGGER delivery_plan_keep_labelled
  AFTER INSERT OR UPDATE OF ready_qty ON public.delivery_item_plan
  FOR EACH ROW EXECUTE FUNCTION public.delivery_plan_keep_labelled();

-- ---------------------------------------------------------------------------
-- _auto_ready_item: labelled units of one line that no store has yet go to the plan rows
-- that still need ready units, in store-name order. The caller holds the line's lock.
-- Returns the units made ready.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._auto_ready_item(p_item_id uuid, p_user uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_item  record;
  v_plan  record;
  v_avail integer;
  v_add   integer;
  v_total integer := 0;
BEGIN
  SELECT id, delivery_id, labelled_qty INTO v_item FROM public.delivery_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  PERFORM 1 FROM public.delivery_item_plan WHERE delivery_item_id = p_item_id ORDER BY id FOR UPDATE;
  SELECT v_item.labelled_qty - coalesce(sum(ready_qty), 0) INTO v_avail
  FROM public.delivery_item_plan WHERE delivery_item_id = p_item_id;

  FOR v_plan IN
    SELECT pl.id, pl.store_id, pl.planned_qty - pl.ready_qty AS open_qty
    FROM public.delivery_item_plan pl
    JOIN public.stores s ON s.id = pl.store_id
    WHERE pl.delivery_item_id = p_item_id AND pl.ready_qty < pl.planned_qty
    ORDER BY s.name, pl.id
  LOOP
    EXIT WHEN v_avail <= 0;
    v_add := LEAST(v_plan.open_qty, v_avail);
    UPDATE public.delivery_item_plan SET ready_qty = ready_qty + v_add WHERE id = v_plan.id;
    INSERT INTO public.delivery_events
      (delivery_id, delivery_item_id, plan_id, type, store_id, qty, details, created_by)
    VALUES
      (v_item.delivery_id, p_item_id, v_plan.id, 'ready', v_plan.store_id, v_add, jsonb_build_object('auto', 'label'), p_user);
    v_total := v_total + v_add;
    v_avail := v_avail - v_add;
  END LOOP;
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION public._auto_ready_item(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._auto_ready_item(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- label_items_checked: the signed "Етикетиране" checklist.
--
-- p_rows    = [{item_id, qty}], qty > 0: units of the line labelled now (a ticked row is
--             all that waits; "Частично" and the good units of a "Не е наред" row less).
-- p_signals = [{item_id, reason, qty_expected, qty_actual, note}] for "Не е наред" rows
--             other than "Частично". reason: damaged | wrong_label | wrong_product |
--             missing | other ('other' needs a note). Their units stay in the list.
-- At least one of the two must be non-empty; a line appears once in each list.
-- Any delivery that is not a draft or cancelled: labelling of Офис units goes on after
-- the stores have their shipments. Returns {labelled, ready, signals}.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.label_items_checked(p_user uuid, p_rows jsonb, p_signals jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_rows    jsonb := coalesce(p_rows, '[]'::jsonb);
  v_signals jsonb := coalesce(p_signals, '[]'::jsonb);
  v_row     record;
  v_sig     record;
  v_bad     record;
  v_item    uuid;
  v_n       integer := 0;
  v_units   integer := 0;
  v_ready   integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF jsonb_typeof(v_rows) <> 'array' OR jsonb_typeof(v_signals) <> 'array' THEN
    RAISE EXCEPTION 'Редовете и сигналите трябва да са списъци';
  END IF;
  IF jsonb_array_length(v_rows) = 0 AND jsonb_array_length(v_signals) = 0 THEN
    RAISE EXCEPTION 'Нищо не е отметнато: отметнете етикетираните редове или отбележете „Не е наред“';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r
             WHERE (r->>'item_id') IS NULL OR (r->>'qty') IS NULL OR (r->>'qty')::integer <= 0) THEN
    RAISE EXCEPTION 'Всеки етикетиран ред трябва да има ред от доставката и количество над 0';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r GROUP BY r->>'item_id' HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_signals) s GROUP BY s->>'item_id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Ред от етикетирането се повтаря';
  END IF;
  IF EXISTS (SELECT 1 FROM (SELECT r->>'item_id' AS id FROM jsonb_array_elements(v_rows) r
                            UNION SELECT s->>'item_id' FROM jsonb_array_elements(v_signals) s) x
             LEFT JOIN public.delivery_items i ON i.id = x.id::uuid
             WHERE i.id IS NULL) THEN
    RAISE EXCEPTION 'Редът от доставката не е намерен';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_signals) s
             WHERE coalesce(s->>'reason', '') NOT IN ('damaged', 'wrong_label', 'wrong_product', 'missing', 'other')) THEN
    RAISE EXCEPTION 'Непозната причина в „Не е наред“';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_signals) s
             WHERE s->>'reason' = 'other' AND nullif(btrim(s->>'note'), '') IS NULL) THEN
    RAISE EXCEPTION 'За причина „Друго“ напишете кратка бележка';
  END IF;

  -- Lock the lines, in one order.
  PERFORM 1 FROM public.delivery_items
  WHERE id IN (SELECT (r->>'item_id')::uuid FROM jsonb_array_elements(v_rows) r)
  ORDER BY id FOR UPDATE;

  SELECT p.name, d.status, d.number INTO v_bad
  FROM jsonb_array_elements(v_rows) r
  JOIN public.delivery_items i ON i.id = (r->>'item_id')::uuid
  JOIN public.deliveries d ON d.id = i.delivery_id
  JOIN public.products p ON p.id = i.product_id
  WHERE d.status IN ('draft', 'cancelled')
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Доставка Д-% е %: „%“ не се етикетира', lpad(coalesce(v_bad.number::text, '-'), 6, '0'),
      CASE v_bad.status WHEN 'draft' THEN 'чернова' ELSE 'отказана' END, v_bad.name;
  END IF;

  SELECT p.name, i.received_qty - i.labelled_qty AS free, (r->>'qty')::integer AS qty INTO v_bad
  FROM jsonb_array_elements(v_rows) r
  JOIN public.delivery_items i ON i.id = (r->>'item_id')::uuid
  JOIN public.products p ON p.id = i.product_id
  WHERE (r->>'qty')::integer > i.received_qty - i.labelled_qty
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'За „%“ чакат етикет % бр., а отметнатите са % бр.', v_bad.name, v_bad.free, v_bad.qty;
  END IF;

  FOR v_sig IN
    SELECT (s->>'item_id')::uuid AS item_id, s->>'reason' AS reason,
           (s->>'qty_expected')::integer AS qty_expected, (s->>'qty_actual')::integer AS qty_actual,
           nullif(btrim(s->>'note'), '') AS note
    FROM jsonb_array_elements(v_signals) WITH ORDINALITY x(s, n)
    ORDER BY x.n
  LOOP
    PERFORM public.raise_signal(p_user, 'label', v_sig.reason, v_sig.item_id, NULL,
                                v_sig.qty_expected, v_sig.qty_actual, v_sig.note);
    v_n := v_n + 1;
  END LOOP;

  FOR v_row IN
    SELECT i.id, i.delivery_id, (r->>'qty')::integer AS qty
    FROM jsonb_array_elements(v_rows) r
    JOIN public.delivery_items i ON i.id = (r->>'item_id')::uuid
    ORDER BY i.id
  LOOP
    UPDATE public.delivery_items SET labelled_qty = labelled_qty + v_row.qty WHERE id = v_row.id;
    INSERT INTO public.delivery_events (delivery_id, delivery_item_id, type, qty, created_by)
    VALUES (v_row.delivery_id, v_row.id, 'labelled', v_row.qty, p_user);
    v_units := v_units + v_row.qty;
    v_ready := v_ready + public._auto_ready_item(v_row.id, p_user);
  END LOOP;

  RETURN jsonb_build_object('labelled', v_units, 'ready', v_ready, 'signals', v_n);
END;
$$;
REVOKE ALL ON FUNCTION public.label_items_checked(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.label_items_checked(uuid, jsonb, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- update_plan (replaced): as in 20261110_deliveries_functions, except that a plan row may
-- go below its ready units (down to what has left plus what sits on a trip that has not
-- left), and labelled units nobody has yet go to the rows that need them.
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
    SELECT x.store_id, x.planned_qty, s.name AS store, s.is_active, pl.id AS plan_id, pl.ready_qty, pl.shipped_qty,
           (SELECT coalesce(sum(sl.qty), 0)::integer
            FROM public.shipment_lines sl JOIN public.shipments sh ON sh.id = sl.shipment_id
            WHERE sl.plan_id = pl.id AND sh.status IN ('packing', 'packed')) AS on_trip
    FROM jsonb_to_recordset(p_rows) AS x(store_id uuid, planned_qty integer)
    JOIN public.stores s ON s.id = x.store_id
    LEFT JOIN public.delivery_item_plan pl ON pl.delivery_item_id = p_item_id AND pl.store_id = x.store_id
    ORDER BY s.name, s.id
  LOOP
    IF v_row.plan_id IS NOT NULL THEN
      IF v_row.planned_qty < v_row.ready_qty THEN
        -- Ready units are labelled units of this line set aside for the store; below
        -- what has left or sits on a trip they cannot go, the rest return to Офис
        -- (still labelled) and _auto_ready_item gives them to the other stores.
        IF v_row.planned_qty < v_row.shipped_qty + v_row.on_trip THEN
          RAISE EXCEPTION 'Планът за „%“ към % не може да е под изпратените и сложените в курс: % бр., нов план % бр.',
            v_item.name, v_row.store, v_row.shipped_qty + v_row.on_trip, v_row.planned_qty;
        END IF;
        UPDATE public.delivery_item_plan SET ready_qty = v_row.planned_qty, planned_qty = v_row.planned_qty
        WHERE id = v_row.plan_id;
        INSERT INTO public.delivery_events
          (delivery_id, delivery_item_id, plan_id, type, store_id, qty, details, created_by)
        VALUES
          (v_delivery_id, p_item_id, v_row.plan_id, 'ready', v_row.store_id, v_row.planned_qty - v_row.ready_qty,
           jsonb_build_object('plan', true), p_user);
      ELSE
        UPDATE public.delivery_item_plan SET planned_qty = v_row.planned_qty WHERE id = v_row.plan_id;
      END IF;
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

  -- Labelled units not yet set aside go to the rows that still need some.
  PERFORM public._auto_ready_item(p_item_id, p_user);

  -- Lowering a plan row to what has already been shipped can be what
  -- completes the delivery.
  PERFORM public._complete_delivery_if_done(v_delivery_id, p_user);
END;
$$;

-- ---------------------------------------------------------------------------
-- pack_shipment_checked (replaced): as in 20261111_deliveries_label_pack_trip, and the
-- missing units of a signalled line are no longer labelled either.
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
    -- The missing units are no longer labelled either: they go back to "Етикетиране".
    UPDATE public.delivery_items i
    SET labelled_qty = i.labelled_qty - x.qty
    FROM (SELECT pl.delivery_item_id AS item_id, -sum((u->>'qty')::integer)::integer AS qty
          FROM jsonb_array_elements(v_unready) u
          JOIN public.delivery_item_plan pl ON pl.id = (u->>'plan_id')::uuid
          GROUP BY pl.delivery_item_id) x
    WHERE i.id = x.item_id;
  END IF;

  SELECT count(*), coalesce(sum(qty), 0) INTO v_left, v_units
  FROM public.shipment_lines WHERE shipment_id = p_shipment_id;

  RETURN jsonb_build_object('lines', v_left, 'units', v_units, 'signals', v_n, 'unready', v_down);
END;
$$;

-- Grants of the replaced functions stay as they were (CREATE OR REPLACE keeps them);
-- restated so a fresh database ends up the same.
REVOKE ALL ON FUNCTION public.update_plan(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_plan(uuid, uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.pack_shipment_checked(uuid, uuid, jsonb, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pack_shipment_checked(uuid, uuid, jsonb, integer, jsonb) TO service_role;
