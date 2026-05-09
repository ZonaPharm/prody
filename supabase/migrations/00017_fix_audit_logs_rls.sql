-- Fix: add WITH CHECK to audit_logs RLS policy so admin users can INSERT
DROP POLICY IF EXISTS "Admins full access audit_logs" ON audit_logs;
CREATE POLICY "Admins full access audit_logs" ON audit_logs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
