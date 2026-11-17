-- Доставки, фаза 2: two functions the screens need on top of 20261110_deliveries_functions.
--
--   save_delivery_draft      — the entry screen autosaves the whole draft (header, lines, plan)
--                              in one transaction, so a failed write never leaves half a draft.
--   receive_delivery_checked — one signed receiving checklist: the "Не е наред" signals and the
--                              received units go in together or not at all.
--
-- Additive only: two new functions, nothing existing changes. Safe to run while the
-- shops sell. Re-runnable (CREATE OR REPLACE). Staging first, production only together
-- with the phase 2/3 release.
--
-- Same rules as the phase 1 functions: SECURITY INVOKER, empty search_path, fully
-- qualified names, Bulgarian messages for anything the user can fix, service_role only.

-- ---------------------------------------------------------------------------
-- save_delivery_draft
--
-- p_delivery_id         null creates a new draft (event 'created'); otherwise the draft to
--                       overwrite, which must still be a draft.
-- p_expected_updated_at the updated_at the screen last saw. When another admin saved the same
--                       draft in between, it differs and the save is refused instead of one
--                       admin silently overwriting the other. Null skips the check.
-- p_draft               {order_ref, notes, items: [{id?, key?, product_id, supplier_id?,
--                       doc_number?, pack_size?, quantity, unit_cost, needs_label?,
--                       plan: [{store_id, planned_qty}]}]}
--
-- The draft's lines become exactly p_draft.items, in that order: lines with an id are updated,
-- lines without one are inserted, lines of the draft not listed are deleted (with their plan).
-- A line's plan is replaced by its listed rows with planned_qty > 0. Over-planning is allowed
-- in a draft (it is refused by save_delivery), so an autosave never loses what was typed.
-- needs_label, when given, is remembered on the product.
--
-- Returns {id, updated_at, items: [{key, id}]}, so the screen can keep the new line ids.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_delivery_draft(
  p_delivery_id         uuid,
  p_user                uuid,
  p_expected_updated_at timestamptz,
  p_draft               jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_id      uuid := p_delivery_id;
  v_status  text;
  v_updated timestamptz;
  v_items   jsonb;
  v_item    record;
  v_item_id uuid;
  v_out     jsonb := '[]'::jsonb;
  v_bad     text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF p_draft IS NULL OR jsonb_typeof(p_draft) <> 'object' THEN
    RAISE EXCEPTION 'Черновата трябва да е обект';
  END IF;
  v_items := coalesce(p_draft->'items', '[]'::jsonb);
  IF jsonb_typeof(v_items) <> 'array' THEN
    RAISE EXCEPTION 'Редовете на черновата трябва да са списък';
  END IF;

  -- Validate every line before writing anything.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e
             WHERE (e->>'product_id') IS NULL
                OR (e->>'quantity') IS NULL OR (e->>'quantity')::integer <= 0
                OR (e->>'unit_cost') IS NULL OR (e->>'unit_cost')::numeric < 0
                OR coalesce((e->>'pack_size')::integer, 1) <= 0) THEN
    RAISE EXCEPTION 'Всеки ред трябва да има продукт, количество над 0 и доставна цена 0 или повече';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e
             LEFT JOIN public.products p ON p.id = (e->>'product_id')::uuid
             WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Продукт от черновата не е намерен';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e
             LEFT JOIN public.suppliers s ON s.id = (e->>'supplier_id')::uuid
             WHERE (e->>'supplier_id') IS NOT NULL AND s.id IS NULL) THEN
    RAISE EXCEPTION 'Доставчик от черновата не е намерен';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e, jsonb_array_elements(coalesce(e->'plan', '[]'::jsonb)) pl
             WHERE (pl->>'store_id') IS NULL OR (pl->>'planned_qty') IS NULL OR (pl->>'planned_qty')::integer < 0) THEN
    RAISE EXCEPTION 'Всеки ред от плана трябва да има обект и количество 0 или повече';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e, jsonb_array_elements(coalesce(e->'plan', '[]'::jsonb)) pl
             LEFT JOIN public.stores s ON s.id = (pl->>'store_id')::uuid
             WHERE s.id IS NULL) THEN
    RAISE EXCEPTION 'Обект от плана не е намерен';
  END IF;
  SELECT s.name INTO v_bad
  FROM jsonb_array_elements(v_items) e, jsonb_array_elements(coalesce(e->'plan', '[]'::jsonb)) pl
  JOIN public.stores s ON s.id = (pl->>'store_id')::uuid
  WHERE s.is_warehouse AND (pl->>'planned_qty')::integer > 0
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Складът % не може да е в плана: неразпределеното остава там', v_bad;
  END IF;
  SELECT p.name INTO v_bad
  FROM jsonb_array_elements(v_items) WITH ORDINALITY e(val, n)
  JOIN public.products p ON p.id = (e.val->>'product_id')::uuid,
       jsonb_array_elements(coalesce(e.val->'plan', '[]'::jsonb)) pl
  GROUP BY e.n, p.name, pl->>'store_id'
  HAVING count(*) > 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Обект се повтаря в плана на „%“', v_bad;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.deliveries (created_by, order_ref, notes)
    VALUES (p_user, nullif(btrim(p_draft->>'order_ref'), ''), nullif(btrim(p_draft->>'notes'), ''))
    RETURNING id INTO v_id;

    INSERT INTO public.delivery_events (delivery_id, type, created_by)
    VALUES (v_id, 'created', p_user);
  ELSE
    SELECT status, updated_at INTO v_status, v_updated FROM public.deliveries WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Доставката не е намерена';
    END IF;
    IF v_status <> 'draft' THEN
      RAISE EXCEPTION 'Доставката вече не е чернова и не може да се редактира тук';
    END IF;
    IF p_expected_updated_at IS NOT NULL AND v_updated <> p_expected_updated_at THEN
      RAISE EXCEPTION 'Черновата е променена от друг човек след като я отворихте. Презаредете страницата.';
    END IF;

    -- Touching the row moves updated_at (trigger), which is what the next save compares.
    UPDATE public.deliveries
    SET order_ref = nullif(btrim(p_draft->>'order_ref'), ''),
        notes     = nullif(btrim(p_draft->>'notes'), '')
    WHERE id = v_id;
  END IF;

  -- A line id must belong to this draft.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e
             LEFT JOIN public.delivery_items i ON i.id = (e->>'id')::uuid AND i.delivery_id = v_id
             WHERE (e->>'id') IS NOT NULL AND i.id IS NULL) THEN
    RAISE EXCEPTION 'Ред от черновата не е от тази доставка';
  END IF;

  DELETE FROM public.delivery_items i
  WHERE i.delivery_id = v_id
    AND i.id NOT IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(v_items) e WHERE (e->>'id') IS NOT NULL);

  FOR v_item IN
    SELECT e.val, e.n FROM jsonb_array_elements(v_items) WITH ORDINALITY e(val, n) ORDER BY e.n
  LOOP
    v_item_id := (v_item.val->>'id')::uuid;
    IF v_item_id IS NULL THEN
      INSERT INTO public.delivery_items
        (delivery_id, product_id, supplier_id, doc_number, pack_size, quantity, unit_cost, sort_order)
      VALUES
        (v_id, (v_item.val->>'product_id')::uuid, (v_item.val->>'supplier_id')::uuid,
         nullif(btrim(v_item.val->>'doc_number'), ''), coalesce((v_item.val->>'pack_size')::integer, 1),
         (v_item.val->>'quantity')::integer, (v_item.val->>'unit_cost')::numeric, v_item.n::integer)
      RETURNING id INTO v_item_id;
    ELSE
      UPDATE public.delivery_items
      SET product_id  = (v_item.val->>'product_id')::uuid,
          supplier_id = (v_item.val->>'supplier_id')::uuid,
          doc_number  = nullif(btrim(v_item.val->>'doc_number'), ''),
          pack_size   = coalesce((v_item.val->>'pack_size')::integer, 1),
          quantity    = (v_item.val->>'quantity')::integer,
          unit_cost   = (v_item.val->>'unit_cost')::numeric,
          sort_order  = v_item.n::integer
      WHERE id = v_item_id;
    END IF;

    DELETE FROM public.delivery_item_plan WHERE delivery_item_id = v_item_id;
    INSERT INTO public.delivery_item_plan (delivery_item_id, store_id, planned_qty)
    SELECT v_item_id, (pl->>'store_id')::uuid, (pl->>'planned_qty')::integer
    FROM jsonb_array_elements(coalesce(v_item.val->'plan', '[]'::jsonb)) pl
    WHERE (pl->>'planned_qty')::integer > 0;

    IF (v_item.val->>'needs_label') IS NOT NULL THEN
      UPDATE public.products
      SET needs_label = (v_item.val->>'needs_label')::boolean
      WHERE id = (v_item.val->>'product_id')::uuid
        AND needs_label IS DISTINCT FROM (v_item.val->>'needs_label')::boolean;
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object('key', v_item.val->'key', 'id', v_item_id));
  END LOOP;

  SELECT updated_at INTO v_updated FROM public.deliveries WHERE id = v_id;

  RETURN jsonb_build_object('id', v_id, 'updated_at', v_updated, 'items', v_out);
END;
$$;

-- ---------------------------------------------------------------------------
-- receive_delivery_checked
--
-- One signed receiving checklist.
-- p_lines   = [{item_id, qty}]: units that arrived and go into Офис (receive_delivery).
-- p_signals = [{item_id, reason, qty_expected, qty_actual, note}]: the "Не е наред" rows.
--             reason: short | damaged | wrong_product | missing | other ('other' needs a note).
-- At least one of the two must be non-empty. Signals are raised first, so a receipt that
-- would otherwise complete the delivery sees them open and leaves it open.
-- Returns {received, auto_ready, signals}.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.receive_delivery_checked(
  p_delivery_id uuid,
  p_user        uuid,
  p_lines       jsonb,
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
  v_status  text;
  v_sig     record;
  v_n       integer := 0;
  v_res     jsonb := jsonb_build_object('received', 0, 'auto_ready', 0);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF jsonb_typeof(v_lines) <> 'array' OR jsonb_typeof(v_signals) <> 'array' THEN
    RAISE EXCEPTION 'Редовете и сигналите трябва да са списъци';
  END IF;
  IF jsonb_array_length(v_lines) = 0 AND jsonb_array_length(v_signals) = 0 THEN
    RAISE EXCEPTION 'Нищо не е отметнато: отметнете получените редове или отбележете „Не е наред“';
  END IF;

  SELECT status INTO v_status FROM public.deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Доставката не е намерена';
  END IF;
  IF v_status NOT IN ('expected', 'in_progress') THEN
    RAISE EXCEPTION 'Доставката не може да се приема: тя е %',
      CASE v_status WHEN 'draft' THEN 'чернова (първо я запишете)' WHEN 'completed' THEN 'приключена'
                    WHEN 'cancelled' THEN 'отказана' ELSE v_status END;
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_signals) s
             LEFT JOIN public.delivery_items i ON i.id = (s->>'item_id')::uuid AND i.delivery_id = p_delivery_id
             WHERE i.id IS NULL) THEN
    RAISE EXCEPTION 'Сигнал за ред, който не е от тази доставка';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_signals) s
             WHERE coalesce(s->>'reason', '') NOT IN ('short', 'damaged', 'wrong_product', 'missing', 'other')) THEN
    RAISE EXCEPTION 'Непозната причина в „Не е наред“';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_signals) s
             WHERE s->>'reason' = 'other' AND nullif(btrim(s->>'note'), '') IS NULL) THEN
    RAISE EXCEPTION 'За причина „Друго“ напишете кратка бележка';
  END IF;

  FOR v_sig IN
    SELECT (s->>'item_id')::uuid AS item_id, s->>'reason' AS reason,
           (s->>'qty_expected')::integer AS qty_expected, (s->>'qty_actual')::integer AS qty_actual,
           nullif(btrim(s->>'note'), '') AS note
    FROM jsonb_array_elements(v_signals) WITH ORDINALITY x(s, n)
    ORDER BY x.n
  LOOP
    PERFORM public.raise_signal(p_user, 'receive', v_sig.reason, v_sig.item_id, NULL,
                                v_sig.qty_expected, v_sig.qty_actual, v_sig.note);
    v_n := v_n + 1;
  END LOOP;

  IF jsonb_array_length(v_lines) > 0 THEN
    v_res := public.receive_delivery(p_delivery_id, p_user, v_lines);
  END IF;

  RETURN v_res || jsonb_build_object('signals', v_n);
END;
$$;

-- ---------------------------------------------------------------------------
-- Access: service_role only (Supabase grants EXECUTE to anon and authenticated directly).
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.save_delivery_draft(uuid, uuid, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_delivery_draft(uuid, uuid, timestamptz, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.receive_delivery_checked(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_delivery_checked(uuid, uuid, jsonb, jsonb) TO service_role;
