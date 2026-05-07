CREATE TABLE IF NOT EXISTS stock_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) NOT NULL,
  store_id uuid REFERENCES stores(id) NOT NULL,
  quantity_remaining int NOT NULL CHECK (quantity_remaining >= 0),
  unit_cost decimal(10,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_batches_product_store ON stock_batches(product_id, store_id);
CREATE INDEX IF NOT EXISTS idx_batches_remaining ON stock_batches(product_id, store_id, quantity_remaining) WHERE quantity_remaining > 0;

CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) NOT NULL,
  store_id uuid REFERENCES stores(id) NOT NULL,
  batch_id uuid REFERENCES stock_batches(id),
  type text NOT NULL CHECK (type IN ('restock', 'sell', 'transfer_in', 'transfer_out')),
  quantity int NOT NULL,
  unit_cost decimal(10,2),
  unit_price decimal(10,2),
  source_store_id uuid REFERENCES stores(id),
  sale_id uuid REFERENCES sales(id),
  notes text,
  created_by uuid REFERENCES users(id) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_movements_store ON stock_movements(store_id);
CREATE INDEX IF NOT EXISTS idx_movements_type ON stock_movements(type);
CREATE INDEX IF NOT EXISTS idx_movements_created ON stock_movements(created_at);

ALTER TABLE stores ADD COLUMN IF NOT EXISTS is_warehouse boolean DEFAULT false;
UPDATE stores SET is_warehouse = true WHERE name ILIKE '%офис%';

ALTER TABLE stock_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access batches" ON stock_batches;
CREATE POLICY "Admins full access batches" ON stock_batches FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
);

DROP POLICY IF EXISTS "Sellers read own batches" ON stock_batches;
CREATE POLICY "Sellers read own batches" ON stock_batches FOR SELECT USING (
  store_id = (SELECT store_id FROM users WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "Admins full access movements" ON stock_movements;
CREATE POLICY "Admins full access movements" ON stock_movements FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
);

DROP POLICY IF EXISTS "Sellers read own movements" ON stock_movements;
CREATE POLICY "Sellers read own movements" ON stock_movements FOR SELECT USING (
  store_id = (SELECT store_id FROM users WHERE id = auth.uid())
);
