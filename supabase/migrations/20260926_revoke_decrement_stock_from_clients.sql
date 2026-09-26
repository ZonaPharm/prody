-- Only the server may call decrement_product_stock.
--
-- 20260830_decrement_stock_atomically revoked EXECUTE from PUBLIC and granted
-- it to service_role, meaning to leave the function server-only. It did not:
-- Supabase's default privileges grant EXECUTE on new functions in public
-- directly to anon and authenticated, and revoking from PUBLIC does not touch
-- those explicit grants. Anyone holding the anon key — which ships in the
-- browser bundle — could call /rest/v1/rpc/decrement_product_stock and, being
-- SECURITY DEFINER, change quantity_on_hand on any product, up as well as down
-- with a negative quantity.
--
-- The only caller is src/app/api/sales/group/route.ts, through the service-role
-- client, which keeps its grant.

REVOKE EXECUTE ON FUNCTION public.decrement_product_stock(uuid, integer) FROM anon, authenticated;
