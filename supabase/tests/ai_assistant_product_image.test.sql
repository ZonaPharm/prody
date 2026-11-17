-- Проверка след 20261117_ai_assistant_product_image.sql. Само чете.
-- Очаквано: 3 реда, всички с ok = true.
SELECT 'kind_check allows product_image' AS check_name,
       pg_get_constraintdef(oid) LIKE '%product_image%' AS ok
FROM pg_constraint WHERE conname = 'ai_actions_kind_check' AND conrelid = 'public.ai_actions'::regclass
UNION ALL
SELECT 'kind_check still allows the old kinds',
       pg_get_constraintdef(oid) LIKE '%delivery_draft%' AND pg_get_constraintdef(oid) LIKE '%product_update%'
       AND pg_get_constraintdef(oid) LIKE '%document%'
FROM pg_constraint WHERE conname = 'ai_actions_kind_check' AND conrelid = 'public.ai_actions'::regclass
UNION ALL
SELECT 'only one kind check',
       count(*) = 1
FROM pg_constraint WHERE conname = 'ai_actions_kind_check' AND conrelid = 'public.ai_actions'::regclass;
