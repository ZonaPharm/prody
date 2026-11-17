-- Отказ на доставка, когато част от нея вече е изпратена към обектите (Владимир, 2026-11-17).
-- On top of every delivery migration up to 20261112_deliveries_office_stock.
--
-- Until now cancel_delivery refused as soon as anything of the delivery had left Офис
-- ("вече е изпратена към обектите"), and also when Офис no longer held every received
-- unit in the delivery's own batches. A delivery that was entered by mistake, or came
-- back from the supplier, could then never be cancelled once one box had gone out.
--
-- Now cancel_delivery takes the delivery's units back from wherever they went:
--
--   where        what this delivery still adds to each store, per product: the sum of
--                its stock movements there (delivery_id = this delivery). In Офис that is
--                restock − what the trips took out; in a store it is what came in −
--                what the store reported missing + what was found again. Sales, other
--                transfers and Office lines carry no delivery_id, so they do not count.
--   take back    those units leave each store with delivery_cancel movements: the
--                delivery's own batches first, then the store's other batches FIFO (stock
--                is the same goods; a shipment from Офис may have carried older units).
--   short        when a store holds fewer units than that (part was sold), the rest
--                cannot be taken back. Without p_accept_short the call refuses and names
--                the store, the product and the numbers. With it, what is there is taken,
--                and the shortfall is written in the log ('cancelled' event, details.short)
--                for the next inventory.
--   refused      a shipment of the delivery that is on a trip that has not left
--                (packing, packed: remove it first, as before), or that is on the road
--                and the store has not accepted yet (sent: accept it first, otherwise the
--                store's later acceptance would take the same units out a second time).
--   signals      open signals of the delivery are closed as 'other' with the reason, so
--                nothing (like "Намерени") can put units back into a cancelled delivery.
--
-- cancel_delivery_preview(p_delivery_id) returns the same per-store numbers for the
-- screen, before the person confirms. The old three-argument cancel_delivery is
-- replaced: p_accept_short defaults to false, so a call without it behaves as before
-- for a delivery that was never shipped. Re-runnable. Same rules as the other delivery
-- functions: SECURITY INVOKER, empty search_path, fully qualified names, Bulgarian
-- messages, service_role only.

-- ---------------------------------------------------------------------------
-- cancel_delivery_preview: per store and product, what a cancel would take back.
--   to_take    what the delivery still adds there (> 0 only)
--   on_hand    what the store holds of the product now, in all batches
--   short      GREATEST(to_take − on_hand, 0): units that cannot be taken back
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_delivery_preview(p_delivery_id uuid)
RETURNS TABLE (store_id uuid, store_name text, is_warehouse boolean, product_id uuid, product_name text,
               to_take integer, on_hand integer, short integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  WITH net AS (
    SELECT m.store_id, m.product_id, sum(m.quantity)::integer AS to_take
    FROM public.stock_movements m
    WHERE m.delivery_id = p_delivery_id
    GROUP BY m.store_id, m.product_id
    HAVING sum(m.quantity) > 0
  )
  SELECT n.store_id, s.name, coalesce(s.is_warehouse, false), n.product_id, p.name, n.to_take,
         coalesce(h.on_hand, 0), GREATEST(n.to_take - coalesce(h.on_hand, 0), 0)
  FROM net n
  JOIN public.stores s ON s.id = n.store_id
  JOIN public.products p ON p.id = n.product_id
  LEFT JOIN LATERAL (
    SELECT sum(b.quantity_remaining)::integer AS on_hand
    FROM public.stock_batches b
    WHERE b.product_id = n.product_id AND b.store_id = n.store_id AND b.quantity_remaining > 0
  ) h ON true
  ORDER BY coalesce(s.is_warehouse, false) DESC, s.name, p.name;
$$;

-- ---------------------------------------------------------------------------
-- cancel_delivery (replaced, one more argument)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.cancel_delivery(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.cancel_delivery(p_delivery_id uuid, p_user uuid, p_reason text,
                                                  p_accept_short boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_d        record;
  v_wh       uuid;
  v_wh_count integer;
  v_bad      record;
  v_prod     record;
  v_row      record;
  v_batch    record;
  v_rem      integer;
  v_take     integer;
  v_prod_out integer;
  v_total    integer := 0;
  v_short    integer := 0;
  v_removed  jsonb := '[]'::jsonb;
  v_shorts   jsonb := '[]'::jsonb;
  v_signals  integer := 0;
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

  SELECT count(*), (array_agg(id))[1] INTO v_wh_count, v_wh
  FROM public.stores WHERE is_warehouse AND is_active;
  IF v_wh_count <> 1 THEN
    RAISE EXCEPTION 'Трябва да има точно един активен склад (обект с is_warehouse), а има %', v_wh_count;
  END IF;

  PERFORM 1 FROM public.delivery_items WHERE delivery_id = p_delivery_id ORDER BY product_id, id FOR UPDATE;
  PERFORM 1 FROM public.delivery_item_plan pl
    JOIN public.delivery_items i ON i.id = pl.delivery_item_id
    WHERE i.delivery_id = p_delivery_id ORDER BY pl.id FOR UPDATE OF pl;

  -- On a trip that has not left: as before, take it out of the shipment first.
  SELECT t.number INTO v_bad
  FROM public.shipment_lines sl
  JOIN public.delivery_items i ON i.id = sl.delivery_item_id
  JOIN public.shipments sh ON sh.id = sl.shipment_id
  JOIN public.trips t ON t.id = sh.trip_id
  WHERE i.delivery_id = p_delivery_id AND sh.status IN ('packing', 'packed')
  ORDER BY t.number
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Доставката е в курс К-%, който още не е тръгнал: първо я махнете от пратките', lpad(v_bad.number::text, 6, '0');
  END IF;

  -- On the road: the store accepts first, so its acceptance cannot take the units twice.
  SELECT sh.number, s.name AS store INTO v_bad
  FROM public.shipment_lines sl
  JOIN public.delivery_items i ON i.id = sl.delivery_item_id
  JOIN public.shipments sh ON sh.id = sl.shipment_id
  JOIN public.stores s ON s.id = sh.store_id
  WHERE i.delivery_id = p_delivery_id AND sh.status = 'sent'
  ORDER BY sh.number
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Пратка П-% до % е на път и още не е приета. Нека обектът я приеме (или я приемете от „Пратки“), после откажете доставката.',
      lpad(v_bad.number::text, 6, '0'), v_bad.store;
  END IF;

  -- Per product (product_id order): lock its batches in every store the delivery
  -- reached, then take the units back store by store.
  FOR v_prod IN
    SELECT DISTINCT m.product_id
    FROM public.stock_movements m
    WHERE m.delivery_id = p_delivery_id
    ORDER BY m.product_id
  LOOP
    PERFORM 1 FROM public.stock_batches b
    WHERE b.product_id = v_prod.product_id AND b.quantity_remaining > 0
      AND b.store_id IN (SELECT m.store_id FROM public.stock_movements m
                         WHERE m.delivery_id = p_delivery_id AND m.product_id = v_prod.product_id)
    ORDER BY b.created_at, b.id
    FOR UPDATE;

    v_prod_out := 0;

    FOR v_row IN
      SELECT * FROM public.cancel_delivery_preview(p_delivery_id) x
      WHERE x.product_id = v_prod.product_id
    LOOP
      IF v_row.short > 0 AND NOT p_accept_short THEN
        RAISE EXCEPTION 'Доставката не може да се откаже: от „%“ трябва да се приберат % бр. от %, а там има само % бр. (част е продадена). Потвърдете отказа без липсващите % бр.',
          v_row.product_name, v_row.to_take, v_row.store_name, v_row.on_hand, v_row.short;
      END IF;

      v_rem := v_row.to_take - v_row.short;

      -- The delivery's own batches first, then the store's others FIFO.
      FOR v_batch IN
        SELECT b.id, b.quantity_remaining, b.unit_cost
        FROM public.stock_batches b
        LEFT JOIN public.delivery_items i ON i.id = b.delivery_item_id
        WHERE b.product_id = v_row.product_id AND b.store_id = v_row.store_id AND b.quantity_remaining > 0
        ORDER BY (i.delivery_id IS NOT DISTINCT FROM p_delivery_id) DESC, b.created_at, b.id
      LOOP
        EXIT WHEN v_rem = 0;
        v_take := LEAST(v_rem, v_batch.quantity_remaining);
        UPDATE public.stock_batches SET quantity_remaining = quantity_remaining - v_take WHERE id = v_batch.id;
        INSERT INTO public.stock_movements
          (product_id, store_id, batch_id, type, quantity, unit_cost, delivery_id, notes, created_by)
        VALUES
          (v_row.product_id, v_row.store_id, v_batch.id, 'delivery_cancel', -v_take, v_batch.unit_cost,
           p_delivery_id, p_reason, p_user);
        v_rem := v_rem - v_take;
      END LOOP;

      IF v_rem > 0 THEN
        -- Cannot happen after the preview's on_hand under these locks; kept so a bug
        -- cannot leave the counter and the batches apart.
        RAISE EXCEPTION 'Недостатъчна наличност в % за „%“: липсват % бр.', v_row.store_name, v_row.product_name, v_rem;
      END IF;

      v_prod_out := v_prod_out + (v_row.to_take - v_row.short);
      v_total := v_total + (v_row.to_take - v_row.short);
      v_removed := v_removed || jsonb_build_array(jsonb_build_object(
        'store_id', v_row.store_id, 'product_id', v_row.product_id, 'qty', v_row.to_take - v_row.short));
      IF v_row.short > 0 THEN
        v_short := v_short + v_row.short;
        v_shorts := v_shorts || jsonb_build_array(jsonb_build_object(
          'store_id', v_row.store_id, 'store', v_row.store_name, 'product_id', v_row.product_id,
          'product', v_row.product_name, 'qty', v_row.short));
      END IF;
    END LOOP;

    IF v_prod_out > 0 THEN
      UPDATE public.products SET quantity_on_hand = quantity_on_hand - v_prod_out WHERE id = v_prod.product_id;
    END IF;
  END LOOP;

  -- Open signals: closed with the reason, so nothing puts units back later.
  WITH closed AS (
    UPDATE public.delivery_signals
    SET status = 'resolved', resolution = 'other', resolution_note = 'Доставката е отказана: ' || p_reason,
        resolved_by = p_user, resolved_at = now()
    WHERE delivery_id = p_delivery_id AND status = 'open'
    RETURNING id, delivery_item_id, shipment_id
  ), logged AS (
    INSERT INTO public.delivery_events (delivery_id, delivery_item_id, shipment_id, signal_id, type, qty, details, created_by)
    SELECT p_delivery_id, c.delivery_item_id, c.shipment_id, c.id, 'signal_resolved', 0,
           jsonb_build_object('resolution', 'other', 'note', 'Доставката е отказана: ' || p_reason, 'returned_to_store', 0),
           p_user
    FROM closed c
    RETURNING 1
  )
  SELECT count(*) INTO v_signals FROM logged;

  UPDATE public.deliveries
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = p_user, cancel_reason = p_reason
  WHERE id = p_delivery_id;

  INSERT INTO public.delivery_events (delivery_id, type, store_id, qty, details, created_by)
  VALUES (p_delivery_id, 'cancelled', v_wh, v_total,
          jsonb_build_object('reason', p_reason, 'previous_status', v_d.status, 'removed', v_removed,
                             'short', v_shorts, 'short_units', v_short, 'signals_closed', v_signals),
          p_user);

  RETURN jsonb_build_object('removed', v_total, 'short', v_short, 'short_lines', v_shorts,
                            'signals_closed', v_signals);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_delivery_preview(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_delivery_preview(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.cancel_delivery(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_delivery(uuid, uuid, text, boolean) TO service_role;
