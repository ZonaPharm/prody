ALTER TABLE stock_requests ADD COLUMN IF NOT EXISTS received_qty integer;
ALTER TABLE stock_requests ADD COLUMN IF NOT EXISTS fulfilled_by uuid REFERENCES auth.users(id);
ALTER TABLE stock_requests ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz;
ALTER TABLE stock_requests ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES auth.users(id);
ALTER TABLE stock_requests ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
