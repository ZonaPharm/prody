-- Tests for migration 20261113_ai_assistant_actions. Run against STAGING only,
-- after the migration (SQL Editor). B4-B6 run inside a sub-transaction that is
-- rolled back, so nothing stays behind. Every row should read passed = true (6 rows).

create or replace function pg_temp.ai_probe(p_setup text, p_probe text)
returns text language plpgsql as $$
declare v text;
begin
  execute p_setup;
  execute p_probe into v;
  raise exception 'ROLLBACK:%', coalesce(v, '<null>');
exception when others then
  if sqlerrm like 'ROLLBACK:%' then return substr(sqlerrm, 10); end if;
  return 'ERR ' || sqlstate;
end $$;

select * from (values
  ('B1 ai_actions exists with RLS on and no policies',
   exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'ai_actions' and rowsecurity)
   and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_actions')),
  ('B2 anon and authenticated have no rights on it',
   not exists (select 1 from information_schema.role_table_grants
               where table_schema = 'public' and table_name = 'ai_actions'
                 and grantee in ('anon', 'authenticated', 'PUBLIC'))),
  ('B3 service_role can read and write it',
   has_table_privilege('service_role', 'public.ai_actions', 'SELECT, INSERT, UPDATE, DELETE')),
  ('B4 a proposal can be stored',
   pg_temp.ai_probe(
     $s$insert into public.ai_actions (user_id, kind, title, payload)
        select id, 'product_update', 'проба', '{}'::jsonb from public.users limit 1$s$,
     $p$select count(*)::text from public.ai_actions where title = 'проба' and status = 'proposed'$p$) = '1'),
  ('B5 an unknown kind is refused',
   pg_temp.ai_probe(
     $s$insert into public.ai_actions (user_id, kind, title, payload)
        select id, 'delete_everything', 'проба', '{}'::jsonb from public.users limit 1$s$,
     $p$select 'stored'$p$) = 'ERR 23514'),
  ('B6 done without a time is refused',
   pg_temp.ai_probe(
     $s$insert into public.ai_actions (user_id, kind, title, payload, status)
        select id, 'excel', 'проба', '{}'::jsonb, 'done' from public.users limit 1$s$,
     $p$select 'stored'$p$) = 'ERR 23514')
) as t(test, passed);
