-- Deduct sold units from products.quantity_on_hand in one statement.
--
-- The sale route used to read quantity_on_hand, subtract in JS and write the
-- result back. Two sales of the same product overlapping in time both read the
-- same starting value and both wrote their own result, so one of the two
-- deductions was lost. It also cannot be reasoned about from the ledger
-- afterwards, because the read and the write are separate round trips.
--
-- Doing the arithmetic inside the UPDATE makes it atomic: the row is locked for
-- the duration, so concurrent sales queue rather than overwrite each other.
--
-- GREATEST(0, ...) preserves the previous behaviour of never going negative.

CREATE OR REPLACE FUNCTION public.decrement_product_stock(
  p_product_id uuid,
  p_quantity   integer
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $$
  UPDATE public.products
  SET quantity_on_hand = GREATEST(0, quantity_on_hand - p_quantity)
  WHERE id = p_product_id
  RETURNING quantity_on_hand;
$$;

REVOKE ALL ON FUNCTION public.decrement_product_stock(uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.decrement_product_stock(uuid, integer) TO service_role;
