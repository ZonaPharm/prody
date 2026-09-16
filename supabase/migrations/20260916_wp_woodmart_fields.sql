-- The shop's theme (Woodmart) renders two per-product tabs whose titles are
-- editable, and its categories are health concerns rather than Prody's
-- suppliers. Both are therefore per-product choices, not derivable.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS wp_usage_tab_title text,
  ADD COLUMN IF NOT EXISTS wp_category_ids    integer[];

COMMENT ON COLUMN public.products.wp_usage_tab_title IS
  'Title of the shop''s second product tab. NULL means use the default "Указания за употреба"; the shop is inconsistent about this wording, so it is editable per product.';

COMMENT ON COLUMN public.products.wp_category_ids IS
  'WooCommerce product category ids. Prody categories are suppliers and the shop''s are health concerns, so this is chosen per product, never derived.';
