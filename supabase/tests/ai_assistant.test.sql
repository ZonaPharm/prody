-- Tests for migration 20261113_ai_assistant. Run against STAGING only, after the
-- migration (SQL Editor). Read-only except A9/A10, which run inside a
-- sub-transaction that is rolled back. Every row should read passed = true (10 rows).

-- Runs p_setup, then p_probe (one value), and rolls both back.
-- Returns the probe's value as text, or 'ERR <sqlstate>' when something fails.
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
  ('A1 all five tables exist',
   (select count(*) from pg_tables where schemaname = 'public' and tablename in
     ('ai_assistant_access', 'ai_assistant_settings', 'ai_conversations', 'ai_messages', 'ai_usage')) = 5),
  ('A2 RLS is on for all five',
   (select count(*) from pg_tables where schemaname = 'public' and rowsecurity and tablename in
     ('ai_assistant_access', 'ai_assistant_settings', 'ai_conversations', 'ai_messages', 'ai_usage')) = 5),
  ('A3 no policies: the browser reads nothing',
   not exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'ai\_%')),
  ('A4 anon and authenticated have no rights on them',
   not exists (select 1 from information_schema.role_table_grants
               where table_schema = 'public' and table_name like 'ai\_%'
                 and grantee in ('anon', 'authenticated', 'PUBLIC'))),
  ('A5 service_role can read and write them',
   (select bool_and(has_table_privilege('service_role', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE'))
    from unnest(array['ai_assistant_access', 'ai_assistant_settings', 'ai_conversations', 'ai_messages', 'ai_usage']) t)),
  ('A6 the settings row is there, exactly one',
   (select count(*) = 1 and min(monthly_cap_usd) >= 0 from public.ai_assistant_settings)),
  ('A7 everyone with access is an active admin',
   not exists (select 1 from public.ai_assistant_access a join public.users u on u.id = a.user_id
               where u.role <> 'admin' or u.is_active = false)),
  ('A8 one message per place in a conversation',
   exists (select 1 from pg_constraint where conname = 'ai_messages_conversation_seq_key')),
  ('A9 a second settings row is refused',
   pg_temp.ai_probe('insert into public.ai_assistant_settings (id) values (2)', 'select 1') = 'ERR 23514'),
  ('A10 a message with an unknown role is refused',
   pg_temp.ai_probe(
     'insert into public.ai_conversations (id, user_id) select ''00000000-0000-0000-0000-0000000000a1'', id from public.users limit 1;
      insert into public.ai_messages (conversation_id, seq, role, content)
      values (''00000000-0000-0000-0000-0000000000a1'', 1, ''system'', ''[]'')',
     'select 1') = 'ERR 23514')
) as t(test, passed);
