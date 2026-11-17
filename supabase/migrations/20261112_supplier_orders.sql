-- Orders to suppliers ("Поръчки"), Владимир 2026-11-12.
--
-- An admin picks a supplier, the products and how many, and sends the order to the
-- supplier (e-mail through the existing SMTP, or "ordered by phone" for suppliers
-- without e-mail). When the goods come, "Пристигна" turns the order into a DRAFT
-- delivery filled from the order; what really came often differs (other quantities,
-- other products), so the admin corrects the draft against the invoice before saving.
--
--   suppliers            + order_emails, contact_name, phone
--   email_settings       + order_signature (the text at the end of every order e-mail)
--   supplier_orders      one order (ПР-000012): draft → sent → received, or cancelled
--   supplier_order_items its lines: product and quantity in units, one line per product
--   deliveries           + supplier_order_id, so a delivery shows "поръчани: N" per line
--
--   save_supplier_order        the whole draft in one call (lines replaced)
--   send_supplier_order        marks it sent (e-mail or by hand); sending again is allowed
--   supplier_order_to_delivery creates the draft delivery (save_delivery_draft) and links it
--   cancel_supplier_order      with a reason, from draft or sent
--
-- Additive only, nothing existing changes behaviour. No stock moves. Safe while the
-- shops sell. Re-runnable. STAGING first, production before merging the PR.

BEGIN;

-- ---------------------------------------------------------------------------
-- Supplier contact and the order signature
-- ---------------------------------------------------------------------------

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS order_emails text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS phone        text;

ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_order_emails_check;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_order_emails_check
  CHECK (cardinality(order_emails) <= 5);

COMMENT ON COLUMN public.suppliers.order_emails IS 'Where orders go by e-mail; empty = the supplier is ordered from by phone';

ALTER TABLE public.email_settings
  ADD COLUMN IF NOT EXISTS order_signature text;

COMMENT ON COLUMN public.email_settings.order_signature IS
  'Company, delivery address and phone, printed at the end of every order to a supplier';

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.supplier_order_number_seq;

CREATE TABLE IF NOT EXISTS public.supplier_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number        integer NOT NULL UNIQUE DEFAULT nextval('public.supplier_order_number_seq'),
  supplier_id   uuid NOT NULL REFERENCES public.suppliers(id),
  status        text NOT NULL DEFAULT 'draft'
                CONSTRAINT supplier_orders_status_check
                CHECK (status IN ('draft', 'sent', 'received', 'cancelled')),
  notes         text CONSTRAINT supplier_orders_notes_check CHECK (notes IS NULL OR length(notes) <= 2000),
  created_by    uuid NOT NULL REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  sent_by       uuid REFERENCES public.users(id),
  sent_via      text CONSTRAINT supplier_orders_sent_via_check CHECK (sent_via IS NULL OR sent_via IN ('email', 'manual')),
  sent_to       text[] NOT NULL DEFAULT '{}',
  send_count    integer NOT NULL DEFAULT 0,
  -- SET NULL: if the delivery goes away (or is cancelled), the order can make a new one.
  delivery_id   uuid REFERENCES public.deliveries(id) ON DELETE SET NULL,
  received_at   timestamptz,
  received_by   uuid REFERENCES public.users(id),
  cancelled_at  timestamptz,
  cancelled_by  uuid REFERENCES public.users(id),
  cancel_reason text
);
ALTER SEQUENCE public.supplier_order_number_seq OWNED BY public.supplier_orders.number;

CREATE INDEX IF NOT EXISTS supplier_orders_supplier_idx ON public.supplier_orders (supplier_id);
CREATE INDEX IF NOT EXISTS supplier_orders_status_idx   ON public.supplier_orders (status);
CREATE INDEX IF NOT EXISTS supplier_orders_delivery_idx ON public.supplier_orders (delivery_id) WHERE delivery_id IS NOT NULL;

DROP TRIGGER IF EXISTS supplier_orders_updated_at ON public.supplier_orders;
CREATE TRIGGER supplier_orders_updated_at
  BEFORE UPDATE ON public.supplier_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.supplier_order_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES public.supplier_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity   integer NOT NULL CONSTRAINT supplier_order_items_quantity_check CHECK (quantity > 0 AND quantity <= 1000000),
  note       text CONSTRAINT supplier_order_items_note_check CHECK (note IS NULL OR length(note) <= 300),
  sort_order integer NOT NULL DEFAULT 0,
  CONSTRAINT supplier_order_items_product_key UNIQUE (order_id, product_id)
);
CREATE INDEX IF NOT EXISTS supplier_order_items_product_idx ON public.supplier_order_items (product_id);

-- The delivery made from an order knows its order (for "поръчани: N" on each line).
ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS supplier_order_id uuid REFERENCES public.supplier_orders(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Row level security: admins read; every write goes through the server.
-- ---------------------------------------------------------------------------

ALTER TABLE public.supplier_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read supplier orders" ON public.supplier_orders;
CREATE POLICY "Admins read supplier orders" ON public.supplier_orders
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins read supplier order items" ON public.supplier_order_items;
CREATE POLICY "Admins read supplier order items" ON public.supplier_order_items
  FOR SELECT TO authenticated USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- save_supplier_order
--
-- p_order_id            null creates a new draft; otherwise the draft to overwrite.
-- p_expected_updated_at what the screen last saw; another admin's save in between
--                       refuses this one instead of silently overwriting it.
-- p_order               {supplier_id, notes, items: [{product_id, quantity, note?}]}
-- Returns {id, number, updated_at}.
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
    DELETE FROM public.supplier_order_items WHERE order_id = v_id;
  END IF;

  INSERT INTO public.supplier_order_items (order_id, product_id, quantity, note, sort_order)
  SELECT v_id, (e.val->>'product_id')::uuid, (e.val->>'quantity')::integer,
         nullif(btrim(left(e.val->>'note', 300)), ''), e.n::integer
  FROM jsonb_array_elements(v_items) WITH ORDINALITY e(val, n);

  SELECT id, number, updated_at INTO v_row FROM public.supplier_orders WHERE id = v_id;
  RETURN jsonb_build_object('id', v_row.id, 'number', v_row.number, 'updated_at', v_row.updated_at);
END;
$$;

-- ---------------------------------------------------------------------------
-- send_supplier_order: the order went out, by e-mail (p_to = the addresses) or by
-- hand ('manual': phone, Viber, printed). Allowed again on a sent order (resent).
-- The server sends the e-mail first and marks it only when the e-mail left.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_supplier_order(
  p_order_id uuid,
  p_user     uuid,
  p_via      text,
  p_to       text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_status text;
  v_row    record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF p_via IS NULL OR p_via NOT IN ('email', 'manual') THEN
    RAISE EXCEPTION 'Непознат начин на изпращане';
  END IF;
  IF p_via = 'email' AND coalesce(cardinality(p_to), 0) = 0 THEN
    RAISE EXCEPTION 'Няма имейл, до който да тръгне поръчката';
  END IF;

  SELECT status INTO v_status FROM public.supplier_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Поръчката не е намерена';
  END IF;
  IF v_status NOT IN ('draft', 'sent') THEN
    RAISE EXCEPTION 'Поръчката е %', CASE v_status WHEN 'received' THEN 'вече пристигнала' ELSE 'отказана' END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.supplier_order_items WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION 'Поръчката е празна: добавете поне един продукт';
  END IF;

  UPDATE public.supplier_orders
  SET status     = 'sent',
      sent_at    = now(),
      sent_by    = p_user,
      sent_via   = p_via,
      sent_to    = CASE WHEN p_via = 'email' THEN p_to ELSE '{}'::text[] END,
      send_count = send_count + 1
  WHERE id = p_order_id
  RETURNING status, sent_at, send_count INTO v_row;

  RETURN jsonb_build_object('status', v_row.status, 'sent_at', v_row.sent_at, 'send_count', v_row.send_count);
END;
$$;

-- ---------------------------------------------------------------------------
-- supplier_order_to_delivery: "Пристигна". Makes a DRAFT delivery from the order
-- (supplier, products, quantities; cost = the last delivered price of the product,
-- from this supplier first, else the catalogue cost, else 0) and links the two.
-- Idempotent: an order that already has its delivery returns it. When that delivery
-- was cancelled (or its draft deleted), "Пристигна" makes a new one.
-- Returns {delivery_id, created}.
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
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'product_id',  i.product_id,
           'supplier_id', v_order.supplier_id,
           'quantity',    i.quantity,
           'pack_size',   coalesce(l.pack_size, 1),
           'unit_cost',   coalesce(l.unit_cost, p.cost_price, 0),
           'plan',        '[]'::jsonb
         ) ORDER BY i.sort_order), '[]'::jsonb)
  INTO v_items
  FROM public.supplier_order_items i
  JOIN public.products p ON p.id = i.product_id
  LEFT JOIN last_line l ON l.product_id = i.product_id
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

-- ---------------------------------------------------------------------------
-- cancel_supplier_order: the supplier will not deliver, or it was a mistake.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_supplier_order(
  p_order_id uuid,
  p_user     uuid,
  p_reason   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'Непознат потребител';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Напишете причина (поне 3 знака)';
  END IF;
  SELECT status INTO v_status FROM public.supplier_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Поръчката не е намерена';
  END IF;
  IF v_status = 'received' THEN
    RAISE EXCEPTION 'Поръчката вече е пристигнала: откажете доставката, ако трябва';
  END IF;
  IF v_status = 'cancelled' THEN
    RETURN;
  END IF;
  UPDATE public.supplier_orders
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = p_user, cancel_reason = btrim(p_reason)
  WHERE id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_supplier_order(uuid, uuid, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_supplier_order(uuid, uuid, timestamptz, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.send_supplier_order(uuid, uuid, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_supplier_order(uuid, uuid, text, text[]) TO service_role;
REVOKE ALL ON FUNCTION public.supplier_order_to_delivery(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_order_to_delivery(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.cancel_supplier_order(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_supplier_order(uuid, uuid, text) TO service_role;

COMMIT;
