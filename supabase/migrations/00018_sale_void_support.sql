ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided boolean DEFAULT false;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES users(id);
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check CHECK (type IN ('restock', 'sell', 'transfer_in', 'transfer_out', 'void'));
