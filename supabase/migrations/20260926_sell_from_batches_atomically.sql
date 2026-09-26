-- Deduct a sale from a product's batches in one transaction, with the batches
-- locked for its duration.
--
-- executeSaleFIFO in src/lib/inventory.ts read each batch's quantity_remaining,
-- subtracted in JS and wrote the result back, one round trip each. Two sales of
-- the same product in the same store overlapping in time both read the same
-- starting value and both wrote their own result, so one deduction was lost —
-- the same lost update 20260830_decrement_stock_atomically fixed for
-- products.quantity_on_hand, but here on the batches, which are the source of
-- truth for stock. Each step's error was also ignored, so a movement could be
-- written for a batch that had not been reduced.
--
-- Here the batches are selected FOR UPDATE in FIFO order, so a concurrent sale
-- of the same product waits and then sees the reduced quantities. Every batch
-- update and every 'sell' movement belongs to the one transaction: if the store
-- does not hold enough, the function raises and nothing is changed, which is
-- what the JS version did when its up-front check fell short.
--
-- SECURITY INVOKER: the only caller is the sales route through the
-- service-role client. EXECUTE is revoked from anon and authenticated
-- explicitly, because Supabase grants it to them directly on new functions and
-- revoking from PUBLIC alone does not remove those grants.

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

  RETURN v_touched;
END;
$$;

REVOKE ALL ON FUNCTION public.sell_from_batches(uuid, uuid, integer, numeric, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sell_from_batches(uuid, uuid, integer, numeric, uuid, uuid) TO service_role;
