-- ============================================================================
-- PRODUCTION migration for the WooCommerce product fields
-- Run this in the Supabase Dashboard SQL editor, on the PRODUCTION project
-- (ocvmqlbfkloskabicxuw), BEFORE the branch reaches main.
--
-- Why before: main auto-deploys. If the code arrives first, every push writes
-- to columns that do not exist.
--
-- Safety: this only ADDs nullable columns and one partial index. It writes no
-- rows, drops nothing, and changes no existing column. Every statement uses
-- IF NOT EXISTS, so running it twice is harmless.
--
-- This is the combined content of:
--   supabase/migrations/20260915_wp_product_fields.sql
--   supabase/migrations/20260916_wp_woodmart_fields.sql
-- ============================================================================

BEGIN;

-- --- Step 1 of 2: the shop copy and the sync bookkeeping -------------------

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

-- Two Prody products must never claim the same shop record, or each push would
-- overwrite the other.
CREATE UNIQUE INDEX IF NOT EXISTS products_wp_product_id_key
  ON public.products (wp_product_id)
  WHERE wp_product_id IS NOT NULL;

-- --- Step 2 of 2: the theme's editable tab title and the shop categories ---

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS wp_usage_tab_title text,
  ADD COLUMN IF NOT EXISTS wp_category_ids    integer[];

COMMENT ON COLUMN public.products.wp_usage_tab_title IS
  'Title of the shop''s second product tab. NULL means use the default "Указания за употреба"; the shop is inconsistent about this wording, so it is editable per product.';

COMMENT ON COLUMN public.products.wp_category_ids IS
  'WooCommerce product category ids. Prody categories are suppliers and the shop''s are health concerns, so this is chosen per product, never derived.';

COMMIT;

-- ============================================================================
-- VERIFY — run this separately after the above, and read the output.
--
-- Expect exactly:
--   wp_columns   = 10
--   has_index    = true
--   total        = your real product count, UNCHANGED from before
--   synced       = 0   (production has pushed nothing yet)
-- ============================================================================

SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'products'
       AND column_name LIKE 'wp\_%')                          AS wp_columns,
  (SELECT EXISTS (SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'products'
       AND indexname = 'products_wp_product_id_key'))         AS has_index,
  (SELECT count(*) FROM public.products)                      AS total,
  (SELECT count(wp_product_id) FROM public.products)          AS synced;
