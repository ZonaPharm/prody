-- Deliveries, labelling in part with a chosen split (on top of 20261111_deliveries_label_items).
--
-- Printing labels marks nothing: a line counts as labelled only when someone signs that
-- the units are repacked where needed and carry their labels. When only part of a line
-- is done, the person says where those units go, inside the original plan:
--
--   label_items_checked (replaced): a row may carry
--     split = [{store_id, qty}]   (store_id null = Офис), adding up to the row's qty.
--   A store gets at most what it still needs (planned − ready); Офис at most its share
--   not yet labelled (received − Σ planned − labelled units no store has). Store parts
--   are ready for those stores at once; the Офис part stays labelled in Офис.
--   A row without split works as before (_auto_ready_item gives the units out).
--
-- Only the function changes; no schema change. Re-runnable. SECURITY INVOKER, empty
-- search_path, Bulgarian messages, service_role only.

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
  v_split   jsonb;
  v_part    record;
  v_info    record;
  v_room    integer;
  v_plan_id uuid;
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
  -- An optional split: [{store_id, qty}] (store_id null = Офис), adding up to qty.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r
             WHERE r ? 'split' AND jsonb_typeof(r->'split') NOT IN ('array', 'null')) THEN
    RAISE EXCEPTION 'Разпределението трябва да е списък';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r, jsonb_array_elements(
               CASE WHEN jsonb_typeof(r->'split') = 'array' THEN r->'split' ELSE '[]'::jsonb END) s
             WHERE (s->>'qty') IS NULL OR (s->>'qty')::integer <= 0) THEN
    RAISE EXCEPTION 'Всяка част от разпределението трябва да е над 0 бр.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r
             WHERE jsonb_typeof(r->'split') = 'array' AND jsonb_array_length(r->'split') > 0
               AND (SELECT sum((s->>'qty')::integer) FROM jsonb_array_elements(r->'split') s) <> (r->>'qty')::integer) THEN
    RAISE EXCEPTION 'Разпределението трябва да е точно колкото етикетираните бройки';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r, jsonb_array_elements(
               CASE WHEN jsonb_typeof(r->'split') = 'array' THEN r->'split' ELSE '[]'::jsonb END) s
             GROUP BY r->>'item_id', coalesce(s->>'store_id', 'office') HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Обект се повтаря в разпределението';
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
  PERFORM 1 FROM public.delivery_item_plan
  WHERE delivery_item_id IN (SELECT (r->>'item_id')::uuid FROM jsonb_array_elements(v_rows) r)
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
    SELECT i.id, i.delivery_id, (r->>'qty')::integer AS qty,
           CASE WHEN jsonb_typeof(r->'split') = 'array' AND jsonb_array_length(r->'split') > 0
                THEN r->'split' END AS split
    FROM jsonb_array_elements(v_rows) r
    JOIN public.delivery_items i ON i.id = (r->>'item_id')::uuid
    ORDER BY i.id
  LOOP
    v_split := v_row.split;
    IF v_split IS NOT NULL THEN
      -- The chosen split must stay inside the plan: a store gets at most what it still
      -- needs (planned − ready), Офис at most its share not yet labelled
      -- (received − Σ planned − labelled units no store has).
      SELECT p.name, i.received_qty, i.labelled_qty,
             coalesce((SELECT sum(GREATEST(pl.planned_qty, pl.ready_qty)) FROM public.delivery_item_plan pl WHERE pl.delivery_item_id = i.id), 0) AS planned,
             coalesce((SELECT sum(pl.ready_qty) FROM public.delivery_item_plan pl WHERE pl.delivery_item_id = i.id), 0) AS ready
      INTO v_info
      FROM public.delivery_items i JOIN public.products p ON p.id = i.product_id
      WHERE i.id = v_row.id;
      FOR v_part IN
        SELECT nullif(s->>'store_id', '')::uuid AS store_id, (s->>'qty')::integer AS qty
        FROM jsonb_array_elements(v_split) s
      LOOP
        IF v_part.store_id IS NULL THEN
          v_room := GREATEST(0, v_info.received_qty - v_info.planned - GREATEST(0, v_info.labelled_qty - v_info.ready));
          IF v_part.qty > v_room THEN
            RAISE EXCEPTION 'За „%“ в Офис остават по план % бр., а са дадени % бр.', v_info.name, v_room, v_part.qty;
          END IF;
        ELSE
          SELECT pl.planned_qty - pl.ready_qty AS open_qty, s.name INTO v_bad
          FROM public.delivery_item_plan pl JOIN public.stores s ON s.id = pl.store_id
          WHERE pl.delivery_item_id = v_row.id AND pl.store_id = v_part.store_id;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'За „%“ няма план към този обект: разпределението остава в първоначалния план', v_info.name;
          END IF;
          IF v_part.qty > v_bad.open_qty THEN
            RAISE EXCEPTION 'За „%“ към % остават по план % бр., а са дадени % бр.', v_info.name, v_bad.name, GREATEST(0, v_bad.open_qty), v_part.qty;
          END IF;
        END IF;
      END LOOP;
    END IF;

    UPDATE public.delivery_items SET labelled_qty = labelled_qty + v_row.qty WHERE id = v_row.id;
    INSERT INTO public.delivery_events (delivery_id, delivery_item_id, type, qty, details, created_by)
    VALUES (v_row.delivery_id, v_row.id, 'labelled', v_row.qty,
            CASE WHEN v_split IS NOT NULL THEN jsonb_build_object('split', v_split) ELSE '{}'::jsonb END, p_user);
    v_units := v_units + v_row.qty;

    IF v_split IS NULL THEN
      v_ready := v_ready + public._auto_ready_item(v_row.id, p_user);
    ELSE
      -- Store parts are ready for those stores now; the Офис part stays labelled in Офис.
      FOR v_part IN
        SELECT (s->>'store_id')::uuid AS store_id, (s->>'qty')::integer AS qty
        FROM jsonb_array_elements(v_split) s
        WHERE nullif(s->>'store_id', '') IS NOT NULL
      LOOP
        UPDATE public.delivery_item_plan SET ready_qty = ready_qty + v_part.qty
        WHERE delivery_item_id = v_row.id AND store_id = v_part.store_id
        RETURNING id INTO v_plan_id;
        INSERT INTO public.delivery_events
          (delivery_id, delivery_item_id, plan_id, type, store_id, qty, details, created_by)
        VALUES
          (v_row.delivery_id, v_row.id, v_plan_id, 'ready', v_part.store_id, v_part.qty, jsonb_build_object('split', true), p_user);
        v_ready := v_ready + v_part.qty;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('labelled', v_units, 'ready', v_ready, 'signals', v_n);
END;
$$;
REVOKE ALL ON FUNCTION public.label_items_checked(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.label_items_checked(uuid, jsonb, jsonb) TO service_role;
