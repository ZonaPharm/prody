-- Rollback inventory correction feature

DROP POLICY IF EXISTS "Admins full access corrections" ON stock_corrections;
DROP TABLE IF EXISTS stock_corrections;

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN ('restock', 'sell', 'transfer_in', 'transfer_out', 'void'));
