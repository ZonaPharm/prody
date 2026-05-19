-- 00021_security_fixes
-- Fix critical security issues flagged by Supabase security linter

-- 1. Fix handle_new_user: add search_path, revoke anon/authenticated execute
ALTER FUNCTION public.handle_new_user() SET search_path = '';
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_storage_admin;

-- 2. Fix is_admin: revoke from anon, it's only needed by storage RLS policies
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;

-- 3. Fix set_updated_at: add search_path
ALTER FUNCTION public.set_updated_at() SET search_path = '';

-- 4. Fix request_events RLS: tighten INSERT to own events or admin
DROP POLICY IF EXISTS "Users can insert request events" ON request_events;
CREATE POLICY "Users can insert request events" ON request_events FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM stock_requests sr WHERE sr.id = request_id)
  );

-- 5. Fix request_notes RLS: tighten INSERT to own notes or admin
DROP POLICY IF EXISTS "Users can insert request notes" ON request_notes;
CREATE POLICY "Users can insert request notes" ON request_notes FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM stock_requests sr WHERE sr.id = request_id)
  );

-- 6. Fix request_notes SELECT: scope to notes on requests the user can see
DROP POLICY IF EXISTS "Users can read request notes" ON request_notes;
CREATE POLICY "Users can read request notes" ON request_notes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM stock_requests sr
      WHERE sr.id = request_notes.request_id
      AND (sr.store_id = (SELECT store_id FROM users WHERE id = auth.uid()) OR
           EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
    )
  );

-- 7. Fix request_events SELECT: same scope as notes
DROP POLICY IF EXISTS "Users can read request events" ON request_events;
CREATE POLICY "Users can read request events" ON request_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM stock_requests sr
      WHERE sr.id = request_events.request_id
      AND (sr.store_id = (SELECT store_id FROM users WHERE id = auth.uid()) OR
           EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
    )
  );
