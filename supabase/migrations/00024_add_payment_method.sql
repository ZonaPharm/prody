-- 00024_add_payment_method
-- Add payment_method column that was added manually to live DB but never migrated

ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'cash';
