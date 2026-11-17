-- AI асистент: карта „Снимка за продукт“ (propose_product_image).
-- Само разширява позволените видове карти в ai_actions с 'product_image'.
-- Нищо друго не се променя; безопасно е да се пусне повторно.

BEGIN;

ALTER TABLE public.ai_actions DROP CONSTRAINT IF EXISTS ai_actions_kind_check;
ALTER TABLE public.ai_actions ADD CONSTRAINT ai_actions_kind_check CHECK (kind IN
  ('delivery_draft', 'supplier_order', 'product_create', 'product_update', 'product_image', 'excel', 'document'));

COMMIT;
