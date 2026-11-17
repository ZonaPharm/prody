-- What label a product needs (Владимир, 2026-11-12). Until now a product had only
-- needs_label (yes/no, "Без етикет"). Now one of three:
--
--   full   "Пълен етикет": no barcode, description or price of its own. Goes through
--          "Етикетиране" (repacked where needed, labelled, signed).
--   price  "Само цена": has a factory barcode, gets only a price sticker. Does NOT go
--          through "Етикетиране".
--   none   "Готов": comes ready as it is (e.g. the teas). Does not go through it either.
--
-- needs_label stays and every delivery function keeps reading it: a trigger keeps
-- needs_label = (label_kind = 'full'). Code that still writes only needs_label (the app
-- before this change, save_delivery_draft) keeps working: true → full, false → none,
-- or stays price when the product already is price.
--
-- Existing products: "Без етикет" → none, the rest → full. Their updated_at is not
-- touched. Re-runnable. Run in staging first, then production, BEFORE the app that
-- writes label_kind.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS label_kind text;

-- Fill once, without bumping updated_at for every product (the trigger below and
-- products_updated_at stay out of the backfill).
ALTER TABLE public.products DISABLE TRIGGER products_updated_at;
UPDATE public.products
SET label_kind = CASE WHEN needs_label THEN 'full' ELSE 'none' END
WHERE label_kind IS NULL;
ALTER TABLE public.products ENABLE TRIGGER products_updated_at;

ALTER TABLE public.products ALTER COLUMN label_kind DROP DEFAULT;
ALTER TABLE public.products ALTER COLUMN label_kind SET NOT NULL;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_label_kind_check;
ALTER TABLE public.products ADD CONSTRAINT products_label_kind_check
  CHECK (label_kind IN ('full', 'price', 'none'));

COMMENT ON COLUMN public.products.label_kind IS
  'full = Пълен етикет (goes through Етикетиране), price = Само цена (factory barcode, price sticker only), '
  'none = Готов. needs_label is derived from it by products_sync_label_kind.';

CREATE OR REPLACE FUNCTION public.products_sync_label_kind()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.label_kind IS NULL THEN
      NEW.label_kind := CASE WHEN coalesce(NEW.needs_label, true) THEN 'full' ELSE 'none' END;
    END IF;
  ELSIF NEW.label_kind IS NULL THEN
    NEW.label_kind := OLD.label_kind;
  ELSIF NEW.label_kind IS NOT DISTINCT FROM OLD.label_kind
        AND NEW.needs_label IS DISTINCT FROM OLD.needs_label THEN
    -- Code that knows only needs_label changed it.
    NEW.label_kind := CASE WHEN NEW.needs_label THEN 'full'
                           WHEN OLD.label_kind = 'price' THEN 'price'
                           ELSE 'none' END;
  END IF;
  NEW.needs_label := NEW.label_kind = 'full';
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.products_sync_label_kind() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS products_sync_label_kind ON public.products;
CREATE TRIGGER products_sync_label_kind
  BEFORE INSERT OR UPDATE OF needs_label, label_kind ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_sync_label_kind();
