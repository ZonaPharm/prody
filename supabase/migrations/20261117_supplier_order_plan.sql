-- Distribution per store already in the order to the supplier (Владимир 2026-11-17:
-- „Трябва да вкараме разпределението в поръчката още. Не в получаването.“).
--
-- Until now an order (ПР-…) held only products and quantities; the split between the
-- stores was typed into the draft delivery that "Пристигна" makes. Now each order line
-- carries its plan per store (what is not planned stays in Офис, as in a delivery),
-- and "Пристигна" copies it into the draft delivery. There it can still be changed,
-- and after receiving too (the existing "План").
--
--   supplier_order_plan         one row per order line and store, planned_qty > 0
--   supplier_order_plan_problem the checks, shared by the two writers below
--   save_supplier_order         (replaced) also takes items[].plan, a draft only
--   save_supplier_order_plan    the plan alone, for a draft or a SENT order: the
--                               supplier never sees it, so it may change until the
--                               goods arrive
--   supplier_order_to_delivery  (replaced) the draft delivery gets the plan
--
-- The supplier does not see the plan: the e-mail, the copied text and the print are
-- built from products and quantities only, as before.
--
-- Rules for a plan: stores exist and are not the warehouse; a store at most once per
-- line; whole numbers 0 or more (0 rows are dropped); together not more than the line.
-- When fewer units come than were ordered, the draft delivery keeps the plan: the
-- Офис share shrinks first, and a line whose stores no longer fit turns red there
-- until the admin lowers the stores (Владимир chose this on 2026-11-17).
--
-- Additive: one new table, one new function, two functions replaced with the same
-- signatures (old callers keep working; a call without "plan" saves an empty plan).
-- No stock moves. Safe while the shops sell. Re-runnable. STAGING first, production
-- before merging the PR.

BEGIN;

-- ---------------------------------------------------------------------------
-- The plan of an order line. Keyed by (order, product) like the line itself, so the
-- line can be rewritten by save_supplier_order and the plan goes with it (CASCADE).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.supplier_order_plan (
  order_id    uuid    NOT NULL,
  product_id  uuid    NOT NULL,
  store_id    uuid    NOT NULL REFERENCES public.stores(id),
  planned_qty integer NOT NULL
              CONSTRAINT supplier_order_plan_qty_check CHECK (planned_qty > 0 AND planned_qty <= 1000000),
  CONSTRAINT supplier_order_plan_pkey PRIMARY KEY (order_id, product_id, store_id),
  CONSTRAINT supplier_order_plan_item_fkey FOREIGN KEY (order_id, product_id)
    REFERENCES public.supplier_order_items (order_id, product_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS supplier_order_plan_store_idx ON public.supplier_order_plan (store_id);

COMMENT ON TABLE public.supplier_order_plan IS
  'Per-store split of an order line to a supplier; the rest stays in Офис. Copied into the draft delivery on "Пристигна".';

ALTER TABLE public.supplier_order_plan ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read supplier order plan" ON public.supplier_order_plan;
CREATE POLICY "Admins read supplier order plan" ON public.supplier_order_plan
  FOR SELECT TO authenticated USING (public.is_admin());

REVOKE ALL ON TABLE public.supplier_order_plan FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.supplier_order_plan FROM authenticated;

-- ---------------------------------------------------------------------------
-- supplier_order_plan_problem: the plan checks for a list of lines
--   [{product_id, quantity, plan: [{store_id, planned_qty}]}]
-- Returns the message to show, or null when all is well. "plan" may be missing.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.supplier_order_plan_problem(p_items jsonb)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_bad text;
BEGIN
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
             WHERE e ? 'plan' AND jsonb_typeof(e->'plan') NOT IN ('array', 'null')) THEN
    RETURN 'Разпределението на ред трябва да е списък';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e,
                  jsonb_array_elements(CASE WHEN jsonb_typeof(e->'plan') = 'array' THEN e->'plan' ELSE '[]'::jsonb END) pl
             WHERE jsonb_typeof(pl) <> 'object'
                OR (pl->>'store_id') IS NULL
                OR (pl->>'planned_qty') IS NULL
                OR jsonb_typeof(pl->'planned_qty') <> 'number'
                OR (pl->>'planned_qty')::numeric <> trunc((pl->>'planned_qty')::numeric)
                OR (pl->>'planned_qty')::numeric < 0
                OR (pl->>'planned_qty')::numeric > 1000000) THEN
    RETURN 'Всеки магазин в разпределението трябва да има цяло число бройки, 0 или повече';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e,
                  jsonb_array_elements(CASE WHEN jsonb_typeof(e->'plan') = 'array' THEN e->'plan' ELSE '[]'::jsonb END) pl
             LEFT JOIN public.stores s ON s.id = (pl->>'store_id')::uuid
             WHERE s.id IS NULL) THEN
    RETURN 'Магазин от разпределението не е намерен';
  END IF;
  SELECT s.name INTO v_bad
  FROM jsonb_array_elements(p_items) e,
       jsonb_array_elements(CASE WHEN jsonb_typeof(e->'plan') = 'array' THEN e->'plan' ELSE '[]'::jsonb END) pl
  JOIN public.stores s ON s.id = (pl->>'store_id')::uuid
  WHERE s.is_warehouse AND (pl->>'planned_qty')::integer > 0
  LIMIT 1;
  IF FOUND THEN
    RETURN format('%s не може да е в разпределението: каквото не е разпределено, остава там', v_bad);
  END IF;
  SELECT p.name INTO v_bad
  FROM jsonb_array_elements(p_items) WITH ORDINALITY e(val, n)
  JOIN public.products p ON p.id = (e.val->>'product_id')::uuid,
       jsonb_array_elements(CASE WHEN jsonb_typeof(e.val->'plan') = 'array' THEN e.val->'plan' ELSE '[]'::jsonb END) pl
  GROUP BY e.n, p.name, pl->>'store_id'
  HAVING count(*) > 1
  LIMIT 1;
  IF FOUND THEN
    RETURN format('Магазин се повтаря в разпределението на „%s“', v_bad);
  END IF;
  SELECT format('„%s“: разпределени са %s бр., а се поръчват %s', p.name, sum((pl->>'planned_qty')::integer), (e.val->>'quantity')::integer)
    INTO v_bad
  FROM jsonb_array_elements(p_items) WITH ORDINALITY e(val, n)
  JOIN public.products p ON p.id = (e.val->>'product_id')::uuid,
       jsonb_array_elements(CASE WHEN jsonb_typeof(e.val->'plan') = 'array' THEN e.val->'plan' ELSE '[]'::jsonb END) pl
  GROUP BY e.n, p.name, e.val->>'quantity'
  HAVING sum((pl->>'planned_qty')::integer) > (e.val->>'quantity')::integer
  LIMIT 1;
  IF FOUND THEN
    RETURN v_bad;
  END IF;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- save_supplier_order (replaced): as in 20261112_supplier_orders, plus items[].plan.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_supplier_order(
  p_order_id            uuid,
  p_user                uuid,
  p_expected_updated_at timestamptz,
  p_order               jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_id       uuid := p_order_id;
  v_status   text;
  v_updated  timestamptz;
  v_items    jsonb;
  v_supplier uuid;
  v_bad      text;
  v_row      record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF p_order IS NULL OR jsonb_typeof(p_order) <> 'object' THEN
    RAISE EXCEPTION 'Поръчката трябва да е обект';
  END IF;

  v_supplier := nullif(p_order->>'supplier_id', '')::uuid;
  IF v_supplier IS NULL THEN
    RAISE EXCEPTION 'Изберете доставчик';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = v_supplier) THEN
    RAISE EXCEPTION 'Доставчикът не е намерен';
  END IF;

  v_items := coalesce(p_order->'items', '[]'::jsonb);
  IF jsonb_typeof(v_items) <> 'array' THEN
    RAISE EXCEPTION 'Редовете на поръчката трябва да са списък';
  END IF;
  IF jsonb_array_length(v_items) > 500 THEN
    RAISE EXCEPTION 'Най-много 500 реда в една поръчка';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e
             WHERE (e->>'product_id') IS NULL
                OR (e->>'quantity') IS NULL
                OR (e->>'quantity')::numeric <> trunc((e->>'quantity')::numeric)
                OR (e->>'quantity')::numeric <= 0
                OR (e->>'quantity')::numeric > 1000000) THEN
    RAISE EXCEPTION 'Всеки ред трябва да има продукт и цяло количество над 0';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e
             LEFT JOIN public.products p ON p.id = (e->>'product_id')::uuid
             WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'Продукт от поръчката не е намерен';
  END IF;
  SELECT p.name INTO v_bad
  FROM jsonb_array_elements(v_items) e
  JOIN public.products p ON p.id = (e->>'product_id')::uuid
  GROUP BY p.id, p.name
  HAVING count(*) > 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '„%“ е на повече от един ред', v_bad;
  END IF;
  v_bad := public.supplier_order_plan_problem(v_items);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', v_bad;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.supplier_orders (supplier_id, notes, created_by)
    VALUES (v_supplier, nullif(btrim(p_order->>'notes'), ''), p_user)
    RETURNING id INTO v_id;
  ELSE
    SELECT status, updated_at INTO v_status, v_updated
    FROM public.supplier_orders WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Поръчката не е намерена';
    END IF;
    IF v_status <> 'draft' THEN
      RAISE EXCEPTION 'Поръчката вече е изпратена и не може да се променя';
    END IF;
    IF p_expected_updated_at IS NOT NULL AND v_updated <> p_expected_updated_at THEN
      RAISE EXCEPTION 'Поръчката е променена от друг човек след като я отворихте. Презаредете страницата.';
    END IF;
    UPDATE public.supplier_orders
    SET supplier_id = v_supplier,
        notes       = nullif(btrim(p_order->>'notes'), '')
    WHERE id = v_id;
    DELETE FROM public.supplier_order_items WHERE order_id = v_id;  -- the plan goes with it
  END IF;

  INSERT INTO public.supplier_order_items (order_id, product_id, quantity, note, sort_order)
  SELECT v_id, (e.val->>'product_id')::uuid, (e.val->>'quantity')::integer,
         nullif(btrim(left(e.val->>'note', 300)), ''), e.n::integer
  FROM jsonb_array_elements(v_items) WITH ORDINALITY e(val, n);

  INSERT INTO public.supplier_order_plan (order_id, product_id, store_id, planned_qty)
  SELECT v_id, (e->>'product_id')::uuid, (pl->>'store_id')::uuid, (pl->>'planned_qty')::integer
  FROM jsonb_array_elements(v_items) e,
       jsonb_array_elements(CASE WHEN jsonb_typeof(e->'plan') = 'array' THEN e->'plan' ELSE '[]'::jsonb END) pl
  WHERE (pl->>'planned_qty')::integer > 0;

  SELECT id, number, updated_at INTO v_row FROM public.supplier_orders WHERE id = v_id;
  RETURN jsonb_build_object('id', v_row.id, 'number', v_row.number, 'updated_at', v_row.updated_at);
END;
$$;

-- ---------------------------------------------------------------------------
-- save_supplier_order_plan: only the split, for a draft or a sent order (until the
-- goods arrive; then it is changed in the delivery).
--
-- p_items [{product_id, plan: [{store_id, planned_qty}]}]: each listed line gets
--         exactly this plan; lines not listed keep theirs.
-- Returns {updated_at}.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_supplier_order_plan(
  p_order_id            uuid,
  p_user                uuid,
  p_expected_updated_at timestamptz,
  p_items               jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_status  text;
  v_updated timestamptz;
  v_items   jsonb;
  v_bad     text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Редовете трябва да са списък';
  END IF;

  SELECT status, updated_at INTO v_status, v_updated
  FROM public.supplier_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Поръчката не е намерена';
  END IF;
  IF v_status = 'received' THEN
    RAISE EXCEPTION 'Стоката вече пристигна: сменете разпределението в доставката';
  END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'Поръчката е отказана';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_updated <> p_expected_updated_at THEN
    RAISE EXCEPTION 'Поръчката е променена от друг човек след като я отворихте. Презаредете страницата.';
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
             LEFT JOIN public.supplier_order_items i
               ON i.order_id = p_order_id AND i.product_id = nullif(e->>'product_id', '')::uuid
             WHERE i.product_id IS NULL) THEN
    RAISE EXCEPTION 'Продуктът не е в тази поръчка';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e GROUP BY e->>'product_id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Продукт се повтаря';
  END IF;

  -- The checks need each line's quantity: take it from the order, not from the caller.
  SELECT coalesce(jsonb_agg(e.val || jsonb_build_object('quantity', i.quantity) ORDER BY e.n), '[]'::jsonb)
    INTO v_items
  FROM jsonb_array_elements(p_items) WITH ORDINALITY e(val, n)
  JOIN public.supplier_order_items i
    ON i.order_id = p_order_id AND i.product_id = (e.val->>'product_id')::uuid;

  v_bad := public.supplier_order_plan_problem(v_items);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', v_bad;
  END IF;

  DELETE FROM public.supplier_order_plan
  WHERE order_id = p_order_id
    AND product_id IN (SELECT (e->>'product_id')::uuid FROM jsonb_array_elements(v_items) e);

  INSERT INTO public.supplier_order_plan (order_id, product_id, store_id, planned_qty)
  SELECT p_order_id, (e->>'product_id')::uuid, (pl->>'store_id')::uuid, (pl->>'planned_qty')::integer
  FROM jsonb_array_elements(v_items) e,
       jsonb_array_elements(CASE WHEN jsonb_typeof(e->'plan') = 'array' THEN e->'plan' ELSE '[]'::jsonb END) pl
  WHERE (pl->>'planned_qty')::integer > 0;

  -- A change of plan is a change of the order: another open screen must reload.
  UPDATE public.supplier_orders SET updated_at = now() WHERE id = p_order_id
  RETURNING updated_at INTO v_updated;

  RETURN jsonb_build_object('updated_at', v_updated);
END;
$$;

-- ---------------------------------------------------------------------------
-- supplier_order_to_delivery (replaced): as in 20261112_supplier_orders, but each
-- line of the draft delivery gets the order's plan. A store that has since become
-- the warehouse is left out (its units stay in Офис anyway).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.supplier_order_to_delivery(
  p_order_id uuid,
  p_user     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_order    record;
  v_items    jsonb;
  v_result   jsonb;
  v_delivery uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;

  SELECT * INTO v_order FROM public.supplier_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Поръчката не е намерена';
  END IF;
  IF v_order.status = 'received' AND v_order.delivery_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.deliveries WHERE id = v_order.delivery_id AND status <> 'cancelled') THEN
    RETURN jsonb_build_object('delivery_id', v_order.delivery_id, 'created', false);
  END IF;
  IF v_order.status = 'draft' THEN
    RAISE EXCEPTION 'Поръчката още не е изпратена. Изпратете я или отбележете „Поръчах по телефона“.';
  END IF;
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'Поръчката е отказана';
  END IF;

  WITH last_line AS (
    SELECT DISTINCT ON (di.product_id) di.product_id, di.unit_cost, di.pack_size
    FROM public.delivery_items di
    JOIN public.deliveries d ON d.id = di.delivery_id
    WHERE d.status NOT IN ('draft', 'cancelled')
      AND di.product_id IN (SELECT product_id FROM public.supplier_order_items WHERE order_id = p_order_id)
    ORDER BY di.product_id, (di.supplier_id IS NOT DISTINCT FROM v_order.supplier_id) DESC, di.created_at DESC
  ),
  plan AS (
    SELECT sp.product_id,
           jsonb_agg(jsonb_build_object('store_id', sp.store_id, 'planned_qty', sp.planned_qty) ORDER BY s.name) AS rows
    FROM public.supplier_order_plan sp
    JOIN public.stores s ON s.id = sp.store_id
    WHERE sp.order_id = p_order_id AND NOT coalesce(s.is_warehouse, false)
    GROUP BY sp.product_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'product_id',  i.product_id,
           'supplier_id', v_order.supplier_id,
           'quantity',    i.quantity,
           'pack_size',   coalesce(l.pack_size, 1),
           'unit_cost',   coalesce(l.unit_cost, p.cost_price, 0),
           'plan',        coalesce(pl.rows, '[]'::jsonb)
         ) ORDER BY i.sort_order), '[]'::jsonb)
  INTO v_items
  FROM public.supplier_order_items i
  JOIN public.products p ON p.id = i.product_id
  LEFT JOIN last_line l ON l.product_id = i.product_id
  LEFT JOIN plan pl ON pl.product_id = i.product_id
  WHERE i.order_id = p_order_id;

  v_result := public.save_delivery_draft(
    NULL, p_user, NULL,
    jsonb_build_object(
      'order_ref', 'ПР-' || lpad(v_order.number::text, 6, '0'),
      'notes',     v_order.notes,
      'items',     v_items));
  v_delivery := (v_result->>'id')::uuid;

  UPDATE public.deliveries SET supplier_order_id = p_order_id WHERE id = v_delivery;
  UPDATE public.supplier_orders
  SET status      = 'received',
      delivery_id = v_delivery,
      received_at = coalesce(received_at, now()),
      received_by = coalesce(received_by, p_user)
  WHERE id = p_order_id;

  RETURN jsonb_build_object('delivery_id', v_delivery, 'created', true);
END;
$$;

REVOKE ALL ON FUNCTION public.supplier_order_plan_problem(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_order_plan_problem(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.save_supplier_order(uuid, uuid, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_supplier_order(uuid, uuid, timestamptz, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.save_supplier_order_plan(uuid, uuid, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_supplier_order_plan(uuid, uuid, timestamptz, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.supplier_order_to_delivery(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_order_to_delivery(uuid, uuid) TO service_role;

COMMIT;
