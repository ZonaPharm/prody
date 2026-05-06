-- Add inactive_reason column
ALTER TABLE products ADD COLUMN IF NOT EXISTS inactive_reason text;

-- Drop old constraint, migrate data, add new constraint
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_status_check;

UPDATE products SET inactive_reason = status WHERE status NOT IN ('active', 'inactive');
UPDATE products SET status = 'active' WHERE status = 'listed';
UPDATE products SET status = 'inactive' WHERE status NOT IN ('active', 'inactive');

ALTER TABLE products ADD CONSTRAINT products_status_check CHECK (status IN ('active', 'inactive'));

-- Update RLS for sellers
DROP POLICY IF EXISTS "Sellers read listed products" ON products;
CREATE POLICY "Sellers read active products" ON products
  FOR SELECT USING (status = 'active');

DROP POLICY IF EXISTS "Sellers read images of listed" ON product_images;
CREATE POLICY "Sellers read images of active" ON product_images
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM products p WHERE p.id = product_images.product_id AND p.status = 'active'
  ));
