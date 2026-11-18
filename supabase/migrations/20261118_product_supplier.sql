-- The product's own supplier (Владимир, 2026-11-18). Until now a product had
-- only the free-text "Източник" (products.source), half of them empty and the
-- same supplier written several ways (Тему / тему / Temu, Аксон / Аксом ...).
-- Deliveries and supplier orders work with the suppliers table, so the app had
-- to guess a product's supplier from that text.
--
-- Now products.supplier_id points at public.suppliers. source stays and is
-- kept equal to the supplier's name by a trigger, so code that still reads
-- source (exports, the AI assistant, the app before this change) sees the same
-- name, and code that still writes only source (the app before this change,
-- the assistant) sets supplier_id through the same trigger:
--
--   supplier_id set or changed  -> source := the supplier's name (null if none)
--   only source changed         -> supplier_id := the supplier of that name,
--                                  the same way the app matches it
--                                  (trimmed, case-insensitive, Тему -> Temu,
--                                  Панацея -> Панацея 2001), else null
--   a supplier renamed          -> its products' source follows
--
-- Existing products: supplier_id from source by the same match, which also
-- writes the supplier's spelling into source (Тему -> Temu). updated_at is not
-- touched. Products whose source matches no supplier keep their text and no
-- supplier. Filling the empty ones by category is a separate, one-off data
-- step (Владимир's list), not part of this migration.
--
-- Additive and re-runnable. Run in staging first, then production, BEFORE the
-- app that writes supplier_id.

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id);
CREATE INDEX IF NOT EXISTS products_supplier_id_idx ON public.products (supplier_id);

COMMENT ON COLUMN public.products.supplier_id IS
  'The product''s supplier. products.source mirrors its name (products_sync_supplier).';

-- The supplier a free-text name means, the way src/lib/deliveries/suppliers.ts
-- matches it. Active suppliers first, so a merged (hidden) duplicate is never
-- chosen over the one it was merged into.
CREATE OR REPLACE FUNCTION public.supplier_for_name(p_name text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  WITH k AS (
    SELECT CASE lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'))
             WHEN 'тему' THEN 'temu'
             WHEN 'панацея' THEN 'панацея 2001'
             ELSE lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'))
           END AS key
  )
  SELECT s.id
  FROM public.suppliers s, k
  WHERE k.key <> ''
    AND lower(regexp_replace(btrim(s.name), '\s+', ' ', 'g')) = k.key
  ORDER BY s.is_active DESC, s.created_at
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.supplier_for_name(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_for_name(text) TO service_role;

CREATE OR REPLACE FUNCTION public.products_sync_supplier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.supplier_id IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.supplier_id IS DISTINCT FROM OLD.supplier_id) THEN
    NEW.source := (SELECT s.name FROM public.suppliers s WHERE s.id = NEW.supplier_id);
  ELSIF TG_OP = 'INSERT' OR NEW.source IS DISTINCT FROM OLD.source THEN
    -- Code that knows only the text wrote it.
    NEW.supplier_id := public.supplier_for_name(NEW.source);
    IF NEW.supplier_id IS NOT NULL THEN
      NEW.source := (SELECT s.name FROM public.suppliers s WHERE s.id = NEW.supplier_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.products_sync_supplier() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS products_sync_supplier ON public.products;
CREATE TRIGGER products_sync_supplier
  BEFORE INSERT OR UPDATE OF supplier_id, source ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_sync_supplier();

-- A renamed supplier: its products show the new name.
CREATE OR REPLACE FUNCTION public.suppliers_rename_products()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.products SET source = NEW.name
    WHERE supplier_id = NEW.id AND source IS DISTINCT FROM NEW.name;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.suppliers_rename_products() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS suppliers_rename_products ON public.suppliers;
CREATE TRIGGER suppliers_rename_products
  AFTER UPDATE OF name ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.suppliers_rename_products();

-- Fill once from source, without bumping updated_at. Setting supplier_id makes
-- the trigger above write the supplier's own spelling into source.
ALTER TABLE public.products DISABLE TRIGGER products_updated_at;
UPDATE public.products p
SET supplier_id = public.supplier_for_name(p.source)
WHERE p.supplier_id IS NULL
  AND public.supplier_for_name(p.source) IS NOT NULL;
ALTER TABLE public.products ENABLE TRIGGER products_updated_at;
