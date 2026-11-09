-- products, product_images, categories and stores: signed-in users only.
--
-- Their policies were written for role {public}, which includes anon. What kept
-- anonymous visitors out of products (cost_price included) and product_images
-- was an accident: the admin policy calls is_admin(), anon may not execute it
-- (00021), so an anonymous read failed with "permission denied for function
-- is_admin". stores and categories have a `true` policy that never reaches
-- is_admin(), and on 9 November 2026 production served all 6 stores (with
-- addresses) and all 10 categories to an anonymous request.
--
-- Recreating is_admin() with DROP + CREATE would have handed EXECUTE back to
-- anon (Supabase grants it on every new function) and opened every active
-- product's cost_price to anyone with the public key. Nothing in the app reads
-- these tables without a session: /login, /auth and /api/cron never touch them,
-- and /api/images reads Storage, not tables.
--
-- The conditions themselves are unchanged; only who they apply to. Signed-in
-- admins and sellers see exactly what they saw before.

-- ALTER POLICY takes a brief exclusive lock on each table, and every sale
-- updates products. Should a long transaction hold one, give up (all of it)
-- rather than queue sales behind the wait.
SET LOCAL lock_timeout = '3s';

ALTER POLICY "Admins full access products"      ON public.products       TO authenticated;
ALTER POLICY "Sellers read active products"     ON public.products       TO authenticated;
ALTER POLICY "Admins full access images"        ON public.product_images TO authenticated;
ALTER POLICY "Sellers read images of active"    ON public.product_images TO authenticated;
ALTER POLICY "Admins full access categories"    ON public.categories     TO authenticated;
ALTER POLICY "Sellers read categories"          ON public.categories     TO authenticated;
ALTER POLICY "Admins full access stores"        ON public.stores         TO authenticated;
ALTER POLICY "Sellers read stores"              ON public.stores         TO authenticated;

-- And anon loses the table privileges, so a future policy written without a
-- role cannot reopen them either.
REVOKE ALL ON TABLE public.products, public.product_images, public.categories, public.stores FROM anon;
