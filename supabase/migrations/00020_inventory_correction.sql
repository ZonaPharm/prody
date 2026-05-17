-- Add correction support to stock tracking

-- 1. Update stock_movements type check to include 'correction'
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN ('restock', 'sell', 'transfer_in', 'transfer_out', 'void', 'correction'));

-- 2. Create stock_corrections table
CREATE TABLE IF NOT EXISTS stock_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) NOT NULL,
  store_id uuid REFERENCES stores(id) NOT NULL,
  movement_id uuid REFERENCES stock_movements(id),
  old_quantity int NOT NULL,
  new_quantity int NOT NULL,
  difference int NOT NULL,
  reason text NOT NULL CHECK (reason IN ('wrong_entry', 'damaged', 'expired', 'inventory_count', 'other')),
  notes text,
  created_by uuid REFERENCES users(id) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_corrections_product ON stock_corrections(product_id);
CREATE INDEX IF NOT EXISTS idx_corrections_store ON stock_corrections(store_id);
CREATE INDEX IF NOT EXISTS idx_corrections_created ON stock_corrections(created_at);

-- 3. RLS
ALTER TABLE stock_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access corrections" ON stock_corrections;
CREATE POLICY "Admins full access corrections" ON stock_corrections FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
);
