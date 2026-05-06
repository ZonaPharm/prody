ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_group_id uuid;
CREATE INDEX IF NOT EXISTS idx_sales_sale_group ON sales(sale_group_id);
