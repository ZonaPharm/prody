-- 00022_fix_security_revoke_public
-- Fix: revoke from PUBLIC, then grant only to required roles

-- handle_new_user: only needed by auth trigger (supabase_auth_admin)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;

-- is_admin: needed by RLS policies (authenticated) and admin API (service_role)
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;
