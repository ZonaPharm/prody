-- Internal barcode for every product (thread "Генерирай баркодове за продукти без баркод").
--
-- Most products had no barcode in the system, so labels printed without one and the till
-- could not scan. Every product now gets its own code from the database:
--
--   200 + 9-digit sequence number + EAN-13 check digit   e.g. 2000000001234
--
-- 200-299 is the GS1 range for in-store (restricted circulation) numbers, so a code of ours
-- cannot be the factory EAN of a real product. The code is given on every insert, whatever
-- inserts the product (product form, new product from a delivery, import), and never changes
-- afterwards: labels already printed with it keep scanning.
--
-- The factory barcode stays in products.barcode, optional. Labels print the factory barcode
-- when there is one, the internal code otherwise; the till finds a product by either.
-- A barcode is unique across both columns: no two products answer to the same scan.
-- Also adds products.small_item ("Малък продукт") for the barcode card at the till.
--
-- Run in STAGING first (SQL Editor), then supabase/tests/product_internal_barcode.test.sql.

BEGIN;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS internal_barcode text;

-- Small products with no room for a label: they go on the barcode card at the till
-- (/print/barcode-card), where the seller scans them from.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS small_item boolean NOT NULL DEFAULT false;

CREATE SEQUENCE IF NOT EXISTS public.product_internal_barcode_seq
  AS bigint MINVALUE 1 MAXVALUE 999999999 NO CYCLE;
REVOKE ALL ON SEQUENCE public.product_internal_barcode_seq FROM PUBLIC, anon, authenticated;

-- EAN-13 check digit of 12 digits: weights 1,3,1,3… from the left.
CREATE OR REPLACE FUNCTION public.ean13_check_digit(p_code12 text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path = public
AS $$
DECLARE
  s int := 0;
  i int;
BEGIN
  IF p_code12 !~ '^\d{12}$' THEN
    RAISE EXCEPTION 'ean13_check_digit: need 12 digits, got %', p_code12 USING ERRCODE = '22023';
  END IF;
  FOR i IN 1..12 LOOP
    s := s + substr(p_code12, i, 1)::int * CASE WHEN i % 2 = 0 THEN 3 ELSE 1 END;
  END LOOP;
  RETURN ((10 - s % 10) % 10)::text;
END $$;

-- The next free internal code. Owner-only: the trigger below calls it.
CREATE OR REPLACE FUNCTION public.next_internal_barcode()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base text;
BEGIN
  base := '200' || lpad(nextval('public.product_internal_barcode_seq')::text, 9, '0');
  RETURN base || public.ean13_check_digit(base);
END $$;

REVOKE ALL ON FUNCTION public.ean13_check_digit(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_internal_barcode() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ean13_check_digit(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.next_internal_barcode() TO service_role;

-- Before insert/update of a product:
--  * the factory barcode is trimmed; empty becomes NULL;
--  * a new product gets an internal code; an existing one keeps the one it has;
--  * a factory barcode that is another product's barcode or internal code is refused.
CREATE OR REPLACE FUNCTION public.products_barcodes_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.barcode := nullif(btrim(NEW.barcode), '');

  -- The code is the database's to give: a value sent with an insert is ignored, and an
  -- update cannot change it. (OLD is NULL only during the backfill below.)
  IF TG_OP = 'INSERT' THEN
    NEW.internal_barcode := public.next_internal_barcode();
  ELSIF OLD.internal_barcode IS NOT NULL THEN
    NEW.internal_barcode := OLD.internal_barcode;
  ELSIF NEW.internal_barcode IS NULL THEN
    NEW.internal_barcode := public.next_internal_barcode();
  END IF;

  IF NEW.barcode IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.barcode IS DISTINCT FROM OLD.barcode)
     AND EXISTS (
       SELECT 1 FROM public.products p
       WHERE p.id <> NEW.id
         AND (p.barcode = NEW.barcode OR p.internal_barcode = NEW.barcode)
     ) THEN
    RAISE EXCEPTION 'Баркодът % вече е на друг продукт', NEW.barcode
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.products_barcodes_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS products_barcodes_guard ON public.products;
CREATE TRIGGER products_barcodes_guard
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_barcodes_guard();

-- Every existing product gets its code, oldest first. updated_at is left as it was:
-- getting a code is not an edit of the product.
ALTER TABLE public.products DISABLE TRIGGER products_updated_at;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.products WHERE internal_barcode IS NULL ORDER BY created_at, id LOOP
    UPDATE public.products SET internal_barcode = public.next_internal_barcode() WHERE id = r.id;
  END LOOP;
END $$;
ALTER TABLE public.products ENABLE TRIGGER products_updated_at;

ALTER TABLE public.products ALTER COLUMN internal_barcode SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS products_internal_barcode_key
  ON public.products (internal_barcode);
-- Factory barcodes unique too; the till looks products up by it.
CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_key
  ON public.products (barcode) WHERE barcode IS NOT NULL;

COMMIT;
