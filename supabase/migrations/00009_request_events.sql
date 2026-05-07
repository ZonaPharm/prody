-- Request events table for audit trail
CREATE TABLE IF NOT EXISTS request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES stock_requests(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  user_id uuid REFERENCES auth.users(id),
  notes text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_request_events_request ON request_events(request_id, created_at);
ALTER TABLE request_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access events" ON request_events;
CREATE POLICY "Admins full access events" ON request_events FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Backfill: create events for existing requests
INSERT INTO request_events (request_id, status, notes, created_at)
SELECT s.id, s.status, 'Заявката е създадена', s.created_at
FROM stock_requests s
LEFT JOIN request_events e ON e.request_id = s.id
WHERE e.id IS NULL;

-- Backfill fulfilled events
INSERT INTO request_events (request_id, status, notes, created_at)
SELECT s.id, s.status, 'Заявката е изпълнена', s.updated_at
FROM stock_requests s
WHERE s.status IN ('fulfilled', 'confirmed', 'partial')
AND s.updated_at IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM request_events WHERE request_id = s.id AND status = s.status);
