CREATE TABLE labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_labels_product ON labels(product_id);
ALTER TABLE labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_labels" ON labels FOR ALL TO authenticated USING (
  (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
);

CREATE POLICY "seller_view_labels" ON labels FOR SELECT TO authenticated USING (
  (SELECT role FROM users WHERE id = auth.uid()) IN ('admin', 'seller')
);
