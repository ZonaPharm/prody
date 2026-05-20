-- 00023_sync_quantity_on_hand
-- One-time sync: set quantity_on_hand to actual stock_batches sum

UPDATE products p
SET quantity_on_hand = COALESCE((
  SELECT SUM(sb.quantity_remaining)
  FROM stock_batches sb
  WHERE sb.product_id = p.id
), 0);
