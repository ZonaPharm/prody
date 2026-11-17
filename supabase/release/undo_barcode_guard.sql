-- АВАРИЙНО, само ако след пускането запис на продукт (нов или редакция) спре с грешка,
-- която идва от базата (например „Баркодът … вече е на друг продукт“ там, където не трябва).
-- Маха новата проверка на баркодовете от миграция 12. Колоните и данните остават,
-- нищо не се трие. Старият и новият код продължават да работят; новият просто не получава
-- вътрешен баркод за продукти, създадени след това (може да се даде по-късно).
-- Тригерът за вида етикет (миграция 10) остава: той само попълва label_kind и не отказва нищо.
-- Обратно: пуснете отново 12_ (дава код на продуктите без такъв).

BEGIN;
DROP TRIGGER IF EXISTS products_barcodes_guard ON public.products;
ALTER TABLE public.products ALTER COLUMN internal_barcode DROP NOT NULL;
-- Два продукта отново могат да имат един и същ фабричен баркод, както преди пускането.
DROP INDEX IF EXISTS public.products_barcode_key;
COMMIT;

SELECT tgname AS останали_тригери_на_products
FROM pg_trigger
WHERE tgrelid = 'public.products'::regclass AND NOT tgisinternal
ORDER BY tgname;
