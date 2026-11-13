-- Is "Доставки" installed in this database, and safely? READ-ONLY: it changes nothing,
-- so it can be run in production before and after the delivery migrations.
--
--   Before the migrations: the rows read present = false (expected), and the
--   "Офис" row must already read true.
--   After all of them (phase 1, 2, 3, in the order of PR #7): every row reads
--   ok = true.
--
-- Rows: what is checked, ok, and a detail where there is one.

with
tables(name) as (values
  ('suppliers'), ('deliveries'), ('delivery_items'), ('delivery_item_plan'), ('trips'),
  ('shipments'), ('shipment_lines'), ('delivery_signals'), ('delivery_events'),
  ('label_sheet_profiles')),
cols(tbl, col) as (values
  ('products', 'needs_label'), ('stock_batches', 'delivery_item_id'),
  ('stock_movements', 'delivery_id'), ('stock_movements', 'shipment_id'),
  ('delivery_items', 'labelled_qty'), ('delivery_items', 'unlabelled_qty'),
  ('trips', 'cancelled_at'), ('trips', 'cancelled_by'), ('trips', 'cancel_reason')),
funcs(sig) as (values
  ('public.transfer_stock(uuid, uuid, uuid, integer, uuid, text)'),
  ('public._complete_delivery_if_done(uuid, uuid)'),
  ('public.save_delivery(uuid, uuid)'),
  ('public.receive_delivery(uuid, uuid, jsonb)'),
  ('public.update_plan(uuid, uuid, jsonb)'),
  ('public.mark_ready(uuid, jsonb)'),
  ('public.create_trip(uuid, uuid[], text)'),
  ('public.pack_shipment(uuid, uuid, jsonb, integer)'),
  ('public.send_trip(uuid, uuid)'),
  ('public.confirm_shipment(uuid, uuid, jsonb)'),
  ('public.raise_signal(uuid, text, text, uuid, uuid, integer, integer, text)'),
  ('public.resolve_signal(uuid, uuid, text, text)'),
  ('public.cancel_delivery(uuid, uuid, text)'),
  ('public.save_delivery_draft(uuid, uuid, timestamptz, jsonb)'),
  ('public.receive_delivery_checked(uuid, uuid, jsonb, jsonb)'),
  ('public.mark_ready_checked(uuid, jsonb, jsonb)'),
  ('public.pack_shipment_checked(uuid, uuid, jsonb, integer, jsonb)'),
  ('public.cancel_trip(uuid, uuid, text)'),
  ('public._auto_ready_item(uuid, uuid)'),
  ('public.label_items_checked(uuid, jsonb, jsonb)'),
  ('public.add_to_trip(uuid, uuid, uuid[])'),
  ('public.remove_shipment(uuid, uuid, text)'),
  ('public.reopen_packing(uuid, uuid)')),
checks as (
  -- Stock leaves from exactly one active warehouse (send_trip refuses otherwise).
  select 0 as ord, 'Офис: точно един активен склад' as what,
         (select count(*) = 1 from public.stores where is_warehouse and is_active) as ok,
         (select string_agg(name, ', ') from public.stores where is_warehouse and is_active) as detail
  union all
  select 1, 'таблица ' || t.name, to_regclass('public.' || t.name) is not null, null
  from tables t
  union all
  select 2, 'колона ' || c.tbl || '.' || c.col,
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = c.tbl and column_name = c.col), null
  from cols c
  union all
  -- Present, and callable only by the service role (Supabase grants anon and
  -- authenticated directly, so REVOKE ... FROM PUBLIC alone would leave them open).
  select 3, 'функция ' || f.sig,
         coalesce(to_regprocedure(f.sig) is not null
           and not has_function_privilege('anon', to_regprocedure(f.sig), 'EXECUTE')
           and not has_function_privilege('authenticated', to_regprocedure(f.sig), 'EXECUTE')
           and has_function_privilege('service_role', to_regprocedure(f.sig), 'EXECUTE'), false),
         case when to_regprocedure(f.sig) is null then 'липсва'
              when has_function_privilege('anon', to_regprocedure(f.sig), 'EXECUTE')
                or has_function_privilege('authenticated', to_regprocedure(f.sig), 'EXECUTE') then 'отворена за anon/authenticated'
              else null end
  from funcs f
  union all
  -- The last migration of the chain: the event types it adds.
  select 4, 'последната миграция (trip_edit) е пусната',
         coalesce((select pg_get_constraintdef(oid) like '%unpacked%' from pg_constraint
                   where conname = 'delivery_events_type_check'), false), null
  union all
  -- RLS on every new table (read through the user's session only where a policy allows).
  select 5, 'RLS включен: ' || t.name,
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.' || t.name)), false), null
  from tables t
)
select what, ok, detail from checks order by ord, what;
