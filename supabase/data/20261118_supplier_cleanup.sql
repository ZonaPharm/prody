-- One-off cleanup of suppliers, by Владимир's list of 18.11.2026. Run AFTER
-- migration 20261118_product_supplier, first in staging, then in production.
-- Re-runnable: a second run changes nothing.
--
-- 1. Suppliers that are missing are added: Ана (Чай), Farer (зеолит),
--    Cudo (Корейска козметика).
-- 2. Duplicates and brands are merged into the real supplier. Products,
--    delivery lines and supplier orders move over; the duplicate is hidden
--    (is_active = false), not deleted:
--      Ааксон, Аксом                              -> Аксон
--      ЗЕЙН ФАРМА, Zein Pharma, Nature's Plus, РААБ -> Витамаг (brands of Витамаг)
--      Cubo                                       -> Cudo
--      Родосорб                                   -> Farer
--      Sadoer, Тему Sadoer, Temu/ MERCILEN, FIRMOYO -> Temu (Владимир, 18.11 13:20)
--    The Temu spellings (Тему, тему, ТЕМУ) were already joined by the migration.
--    Ербозета stays as it is.
-- 3. Products with no supplier get the supplier of their category:
--      Арома -> Арома, Витамаг -> Витамаг, Панацея -> Панацея 2001,
--      Зонафарм -> Зонафарм, Корейска козметика -> Cudo, Чай -> Ана,
--      Зеолитни продукти -> Farer, Durex/ Bilka -> Аксон,
--      Лабораторни консумативи -> Химтекс, Медицински изделия -> Temu.
--    A product that already has a supplier keeps it (e.g. the Зонафарм
--    products made by Панацея 2001, the Смарт Карго medical products).
--
-- products.updated_at is not touched. Products, stock, batches, movements and
-- sales are compared before and after; any difference undoes everything.
-- Ends with a table of what each step did.

BEGIN;
SET LOCAL lock_timeout = '3s';

-- Kept after COMMIT, so the table below is the last thing the SQL Editor shows.
DROP TABLE IF EXISTS pg_temp.cleanup_log;
CREATE TEMP TABLE cleanup_log (step text, what text, n int);

-- What must not change: products, stock, batches, sales. Compared at the end;
-- any difference undoes the whole run.
CREATE TEMP TABLE cleanup_guard ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.products)                                   AS products,
       (SELECT md5(string_agg(id || name || coalesce(price::text, '') || quantity_on_hand
                              || coalesce(category_id::text, ''), ',' ORDER BY id))
          FROM public.products)                                                 AS products_hash,
       (SELECT coalesce(sum(quantity_on_hand), 0) FROM public.products)         AS on_hand,
       (SELECT count(*) FROM public.stock_batches)                              AS batches,
       (SELECT coalesce(sum(quantity_remaining), 0) FROM public.stock_batches)            AS batch_qty,
       (SELECT count(*) FROM public.stock_movements)                            AS movements,
       (SELECT count(*) FROM public.sales)                                      AS sales;

ALTER TABLE public.products DISABLE TRIGGER products_updated_at;

DO $$
DECLARE
  r record;
  v_from uuid;
  v_to uuid;
  v_n int;
  v_m int;
BEGIN
  -- 1. Missing suppliers.
  FOR r IN SELECT unnest(ARRAY['Ана', 'Farer', 'Cudo', 'Аксон', 'Витамаг', 'Арома', 'Панацея 2001',
                               'Зонафарм', 'Химтекс', 'Temu']) AS name LOOP
    IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE lower(btrim(name)) = lower(r.name)) THEN
      INSERT INTO public.suppliers (name) VALUES (r.name);
      INSERT INTO cleanup_log VALUES ('1 нов доставчик', r.name, 1);
    END IF;
  END LOOP;

  -- 2. Merges.
  FOR r IN SELECT * FROM (VALUES
      ('Ааксон', 'Аксон'), ('Аксом', 'Аксон'),
      ('ЗЕЙН ФАРМА', 'Витамаг'), ('Zein Pharma', 'Витамаг'), ('Nature''s Plus', 'Витамаг'), ('РААБ', 'Витамаг'),
      ('Cubo', 'Cudo'), ('Родосорб', 'Farer'),
      ('Sadoer', 'Temu'), ('Тему Sadoer', 'Temu'), ('Temu/ MERCILEN', 'Temu'), ('FIRMOYO', 'Temu')) AS m(dup, target) LOOP
    SELECT id INTO v_to FROM public.suppliers WHERE lower(btrim(name)) = lower(r.target);
    SELECT id INTO v_from FROM public.suppliers WHERE lower(btrim(name)) = lower(r.dup);

    -- Products that still carry the old spelling as text only.
    UPDATE public.products SET supplier_id = v_to
    WHERE lower(btrim(source)) = lower(r.dup) AND supplier_id IS DISTINCT FROM v_to;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    IF v_from IS NOT NULL AND v_from <> v_to THEN
      UPDATE public.products SET supplier_id = v_to WHERE supplier_id = v_from;
      GET DIAGNOSTICS v_m = ROW_COUNT;
      v_n := v_n + v_m;
      UPDATE public.delivery_items SET supplier_id = v_to WHERE supplier_id = v_from;
      UPDATE public.supplier_orders SET supplier_id = v_to WHERE supplier_id = v_from;
      UPDATE public.suppliers SET is_active = false WHERE id = v_from AND is_active;
    END IF;
    IF v_n > 0 THEN
      INSERT INTO cleanup_log VALUES ('2 слети', r.dup || ' -> ' || r.target, v_n);
    END IF;
  END LOOP;

  -- 3. By category, only where there is no supplier yet.
  FOR r IN SELECT * FROM (VALUES
      ('Арома', 'Арома'), ('Витамаг', 'Витамаг'), ('Панацея', 'Панацея 2001'),
      ('Зонафарм', 'Зонафарм'), ('Корейска козметика', 'Cudo'), ('Чай', 'Ана'),
      ('Зеолитни продукти', 'Farer'), ('Durex/ Bilka', 'Аксон'),
      ('Лабораторни консумативи', 'Химтекс'), ('Медицински изделия', 'Temu')) AS m(category, supplier) LOOP
    SELECT id INTO v_to FROM public.suppliers WHERE lower(btrim(name)) = lower(r.supplier);
    UPDATE public.products p SET supplier_id = v_to
    FROM public.categories c
    WHERE c.id = p.category_id AND lower(btrim(c.name)) = lower(r.category) AND p.supplier_id IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      INSERT INTO cleanup_log VALUES ('3 по категория', r.category || ' -> ' || r.supplier, v_n);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.products ENABLE TRIGGER products_updated_at;

DO $$
DECLARE g record; n record;
BEGIN
  SELECT * INTO g FROM cleanup_guard;
  SELECT (SELECT count(*) FROM public.products) AS products,
         (SELECT md5(string_agg(id || name || coalesce(price::text, '') || quantity_on_hand
                                || coalesce(category_id::text, ''), ',' ORDER BY id))
            FROM public.products) AS products_hash,
         (SELECT coalesce(sum(quantity_on_hand), 0) FROM public.products) AS on_hand,
         (SELECT count(*) FROM public.stock_batches) AS batches,
         (SELECT coalesce(sum(quantity_remaining), 0) FROM public.stock_batches) AS batch_qty,
         (SELECT count(*) FROM public.stock_movements) AS movements,
         (SELECT count(*) FROM public.sales) AS sales
  INTO n;
  IF (g.products, g.products_hash, g.on_hand, g.batches, g.batch_qty, g.movements, g.sales)
     IS DISTINCT FROM (n.products, n.products_hash, n.on_hand, n.batches, n.batch_qty, n.movements, n.sales) THEN
    RAISE EXCEPTION 'Спрях: продуктите или наличностите се промениха (преди %, след %). Нищо не е записано.', g, n;
  END IF;
  INSERT INTO cleanup_log VALUES ('4 проверка', 'продукти, наличности, партиди, продажби: без промяна', n.products);
END $$;

COMMIT;

SELECT * FROM cleanup_log ORDER BY step, what;
