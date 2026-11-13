-- Готов ли е продът за доставките (PR #5…#16)? САМО ЧЕТЕНЕ: нищо не променя, затова
-- се пуска в production преди миграциите, между тях и след тях.
--
-- Един резултат с колони: група, какво, ok, подробности.
--   1 миграции   — коя от 16-те миграции вече е пусната (по нещо, което само тя създава).
--                  Преди пускането всички са false; след него всички true.
--   2 права      — новите функции се викат само от service_role (не от anon/authenticated).
--   3 RLS        — RLS е включен на новите таблици и на email_settings (пощата).
--   4 Офис       — точно един активен склад (курсовете тръгват от него).
--   5 потребители — всеки човек с ролята си. ok = false на ред, който е админ, а по име е
--                  от Офис (Наси, Ивайло): трябва да е само Офис. Останалите редове са за преглед.
--
-- Не пускай *.test.sql в production: те са за staging и, макар да връщат всичко
-- назад, хабят поредните номера (Д-, ПР-, вътрешни баркодове).

with
migrations(ord, name, present) as (values
  (1,  '20261110_deliveries_schema',            to_regclass('public.deliveries') is not null),
  (2,  '20261110_deliveries_functions',         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'transfer_stock')),
  (3,  '20261111_deliveries_draft_receive',     exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'save_delivery_draft')),
  (4,  '20261111_deliveries_label_pack_trip',   exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'trips' and column_name = 'cancelled_at')),
  (5,  '20261111_deliveries_label_items',       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'delivery_items' and column_name = 'labelled_qty')),
  (6,  '20261111_label_sheet_profiles',         to_regclass('public.label_sheet_profiles') is not null),
  (7,  '20261111_deliveries_label_split',       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'label_items_checked' and p.prosrc like '%split%')),
  (8,  '20261111_deliveries_trip_edit',         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'add_to_trip')),
  (9,  '20261112_deliveries_office_stock',      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'add_office_stock')),
  (10, '20261112_product_label_kind',           exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'label_kind')),
  (11, '20261112_deliveries_tasks_notifications', to_regclass('public.notifications') is not null),
  (12, '20261112_product_internal_barcode',     exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'internal_barcode')),
  (13, '20261112_user_roles',                   exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'roles')),
  (14, '20261112_supplier_orders',              to_regclass('public.supplier_orders') is not null),
  (15, '20261113_ai_assistant',                 to_regclass('public.ai_assistant_access') is not null),
  (16, '20261113_ai_assistant_actions',         to_regclass('public.ai_actions') is not null)),
new_funcs(name) as (values
  ('transfer_stock'), ('_complete_delivery_if_done'), ('save_delivery'), ('receive_delivery'), ('update_plan'),
  ('mark_ready'), ('create_trip'), ('pack_shipment'), ('send_trip'), ('confirm_shipment'), ('raise_signal'),
  ('resolve_signal'), ('cancel_delivery'), ('save_delivery_draft'), ('receive_delivery_checked'),
  ('mark_ready_checked'), ('pack_shipment_checked'), ('cancel_trip'), ('_auto_ready_item'),
  ('label_items_checked'), ('add_to_trip'), ('remove_shipment'), ('reopen_packing'), ('add_office_stock'),
  ('office_free_stock'), ('next_internal_barcode'), ('save_supplier_order'), ('send_supplier_order'),
  ('supplier_order_to_delivery'), ('cancel_supplier_order')),
funcs as (
  select f.name, p.oid
  from new_funcs f
  join pg_proc p on p.proname = f.name
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'),
new_tables(name) as (values
  ('suppliers'), ('deliveries'), ('delivery_items'), ('delivery_item_plan'), ('trips'), ('shipments'),
  ('shipment_lines'), ('delivery_signals'), ('delivery_events'), ('label_sheet_profiles'), ('notifications'),
  ('supplier_orders'), ('supplier_order_items'), ('ai_assistant_access'), ('ai_assistant_settings'),
  ('ai_conversations'), ('ai_messages'), ('ai_usage'), ('ai_actions'), ('email_settings')),
checks as (
  select 1 as grp, m.ord as ord, 'миграция ' || m.name as what, m.present as ok, null::text as detail
  from migrations m
  union all
  select 2, 0, 'функция ' || f.name || ' само за service_role',
         not has_function_privilege('anon', f.oid, 'EXECUTE')
           and not has_function_privilege('authenticated', f.oid, 'EXECUTE')
           and has_function_privilege('service_role', f.oid, 'EXECUTE'),
         case when has_function_privilege('anon', f.oid, 'EXECUTE')
                or has_function_privilege('authenticated', f.oid, 'EXECUTE') then 'отворена за anon/authenticated' end
  from funcs f
  union all
  select 3, 0, 'RLS включен: ' || t.name,
         (select relrowsecurity from pg_class where oid = to_regclass('public.' || t.name)),
         case when t.name = 'email_settings' then
           (select string_agg(pol.polname || ' → ' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), 'true'), '; ')
            from pg_policy pol where pol.polrelid = 'public.email_settings'::regclass) end
  from new_tables t
  where to_regclass('public.' || t.name) is not null
  union all
  select 4, 0, 'Офис: точно един активен склад',
         (select count(*) = 1 from public.stores where is_warehouse and is_active),
         (select string_agg(name, ', ') from public.stores where is_warehouse and is_active)
  union all
  select 5, 0, 'потребител: ' || coalesce(u.display_name, u.email),
         case when u.role = 'admin'
                and (u.display_name ilike 'наси%' or u.display_name ilike 'ивайло%') then false end,
         'role=' || coalesce(u.role, '-')
           || ', roles=' || coalesce(to_jsonb(u) ->> 'roles', '(няма колона)')
           || ', обект=' || coalesce(s.name, '-')
           || case when u.is_active = false then ', ДЕАКТИВИРАН' else '' end
           || ', ' || u.email
  from public.users u
  left join public.stores s on s.id = u.store_id
)
select case grp when 1 then '1 миграции' when 2 then '2 права' when 3 then '3 RLS'
                when 4 then '4 Офис' else '5 потребители' end as група,
       what as какво, ok, detail as подробности
from checks
order by grp, ord, what;
