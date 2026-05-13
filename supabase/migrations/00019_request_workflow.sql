-- 00019_request_workflow
-- Adds: request_notes table, new status columns, fixes RLS for request_events

-- 1. request_notes table for comments between seller and admin
CREATE TABLE IF NOT EXISTS request_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES stock_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_request_notes_request ON request_notes(request_id, created_at);
ALTER TABLE request_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read request notes" ON request_notes;
CREATE POLICY "Users can read request notes" ON request_notes FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS "Users can insert request notes" ON request_notes;
CREATE POLICY "Users can insert request notes" ON request_notes FOR INSERT TO authenticated
  WITH CHECK (true);

-- 2. New status columns on stock_requests (all nullable)
ALTER TABLE stock_requests ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE stock_requests ADD COLUMN IF NOT EXISTS in_transit_at timestamptz;
ALTER TABLE stock_requests ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- 3. Fix request_events RLS — allow insert + read for all authenticated
DROP POLICY IF EXISTS "Admins full access events" ON request_events;
CREATE POLICY "Users can read request events" ON request_events FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Users can insert request events" ON request_events FOR INSERT TO authenticated
  WITH CHECK (true);
