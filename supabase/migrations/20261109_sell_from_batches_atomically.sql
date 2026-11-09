-- Deduct a sale from stock in one transaction: the product's batches, the
-- 'sell' movements, and products.quantity_on_hand, all or nothing.
--
-- Until now the sales route made two separate calls per item and executeSaleFIFO
-- (src/lib/inventory.ts) did its part in JS, with three defects:
--
-- 1. Lost updates on the batches. Each batch's quantity_remaining was read,
--    reduced in JS and written back. Two sales of the same product in the same
--    store overlapping in time both started from the same value, so one
--    deduction was lost — on the batches, which are the source of truth for
--    stock. (20260830_decrement_stock_atomically fixed the same race for
--    products.quantity_on_hand only.)
-- 2. Ignored errors. The batch update and the movement insert never checked
--    their result, so a movement could be written for a batch that was not
--    reduced, or a batch reduced with no movement behind it.
-- 3. A failed counter skipped the batches. The counter was decremented first,
--    and when that call failed the batch deduction was skipped with it. A sale
--    on 12 September 2026 at Заимов left its store one unit above the shelf
--    this way — the only sale since 30 August without a stock movement.
--
-- Here the batches are selected FOR UPDATE, oldest first, so a concurrent sale
-- of the same product waits and then sees the reduced quantities. Locks are
-- always taken in (created_at, id) order, so two sales cannot deadlock on them.
-- The counter is decremented in the same transaction, as quantity_on_hand - n
-- rather than recomputed from the batches: a recount in a second, concurrent
-- sale would read its snapshot from before the first committed and undo it.
-- If the store holds too little, the function raises and nothing changes.
--
-- Based on ae7d9df (fix: deduct a sale from its batches in one locked
-- transaction), which covered 1 and 2 but left the counter as a separate call.
--
-- SECURITY INVOKER, callable by service_role only. EXECUTE is revoked from anon
-- and authenticated explicitly: Supabase grants it to them directly on new
-- functions, and revoking from PUBLIC alone leaves those grants in place — the
-- hole closed on decrement_product_stock on 9 November 2026.

CREATE OR REPLACE FUNCTION public.sell_from_batches(
  p_product_id uuid,
  p_store_id   uuid,
  p_quantity   integer,
  p_unit_price numeric,
  p_sale_id    uuid,
  p_user_id    uuid
)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_remaining integer := p_quantity;
  v_take      integer;
  v_batch     record;
  v_touched   integer := 0;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive, got %', p_quantity;
  END IF;

  FOR v_batch IN
    SELECT id, quantity_remaining, unit_cost
    FROM public.stock_batches
    WHERE product_id = p_product_id
      AND store_id = p_store_id
      AND quantity_remaining > 0
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining = 0;
    v_take := LEAST(v_remaining, v_batch.quantity_remaining);

    UPDATE public.stock_batches
    SET quantity_remaining = quantity_remaining - v_take
    WHERE id = v_batch.id;

    INSERT INTO public.stock_movements
      (product_id, store_id, batch_id, type, quantity, unit_cost, unit_price, sale_id, created_by)
    VALUES
      (p_product_id, p_store_id, v_batch.id, 'sell', -v_take, v_batch.unit_cost, p_unit_price, p_sale_id, p_user_id);

    v_remaining := v_remaining - v_take;
    v_touched := v_touched + 1;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Недостатъчна наличност: липсват % бр.', v_remaining;
  END IF;

  -- GREATEST(0, ...) keeps decrement_product_stock's rule of never going negative.
  UPDATE public.products
  SET quantity_on_hand = GREATEST(0, quantity_on_hand - p_quantity)
  WHERE id = p_product_id;

  RETURN v_touched;
END;
$$;

REVOKE ALL ON FUNCTION public.sell_from_batches(uuid, uuid, integer, numeric, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sell_from_batches(uuid, uuid, integer, numeric, uuid, uuid) TO service_role;
