-- Shop copy and sync bookkeeping for WooCommerce.
--
-- Prody is the source of truth for products on the shop: a product is written
-- here, pushed once to create it, and pushed again to update the same record.
-- wp_product_id is what makes the second push an update instead of a duplicate.
--
-- Ingredients, usage and warnings are separate columns rather than one blob
-- because the shop displays them separately. Collapsing them later is easy;
-- splitting a combined column after it holds data is not.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS wp_title             text,
  ADD COLUMN IF NOT EXISTS wp_description       text,
  ADD COLUMN IF NOT EXISTS wp_short_description text,
  ADD COLUMN IF NOT EXISTS wp_ingredients       text,
  ADD COLUMN IF NOT EXISTS wp_usage             text,
  ADD COLUMN IF NOT EXISTS wp_warnings          text,
  ADD COLUMN IF NOT EXISTS wp_product_id        bigint,
  ADD COLUMN IF NOT EXISTS wp_synced_at         timestamptz;

COMMENT ON COLUMN public.products.wp_product_id IS
  'WooCommerce product id. NULL means never pushed; set on the first successful push and used to update in place afterwards.';

COMMENT ON COLUMN public.products.wp_synced_at IS
  'Time of the last successful push. Written by the application only.';

-- A product maps to at most one shop record, and two Prody products must never
-- claim the same one — that would make each push overwrite the other.
CREATE UNIQUE INDEX IF NOT EXISTS products_wp_product_id_key
  ON public.products (wp_product_id)
  WHERE wp_product_id IS NOT NULL;
