-- Sync products with quantity_on_hand > 0 but no stock_batches into warehouse
DO $$
DECLARE
  warehouse_id uuid;
  orphan RECORD;
  synced_count int := 0;
BEGIN
  SELECT id INTO warehouse_id FROM stores WHERE is_warehouse = true AND is_active = true LIMIT 1;
  IF warehouse_id IS NULL THEN
    SELECT id INTO warehouse_id FROM stores WHERE is_active = true ORDER BY name LIMIT 1;
  END IF;
  IF warehouse_id IS NULL THEN
    RAISE NOTICE 'No active stores — skipping';
    RETURN;
  END IF;

  FOR orphan IN
    SELECT p.id, p.quantity_on_hand
    FROM products p
    LEFT JOIN (SELECT product_id, SUM(quantity_remaining) as total FROM stock_batches GROUP BY product_id) sb
      ON sb.product_id = p.id
    WHERE p.quantity_on_hand > 0 AND COALESCE(sb.total, 0) = 0
  LOOP
    INSERT INTO stock_batches (product_id, store_id, quantity_remaining, unit_cost, created_at)
    VALUES (orphan.id, warehouse_id, orphan.quantity_on_hand, 0, now());
    INSERT INTO stock_movements (product_id, store_id, type, quantity, unit_cost, notes, created_at)
    VALUES (orphan.id, warehouse_id, 'restock', orphan.quantity_on_hand, 0, 'Синхронизиране на наличности', now());
    synced_count := synced_count + 1;
  END LOOP;

  RAISE NOTICE 'Synced % products', synced_count;
END $$;
