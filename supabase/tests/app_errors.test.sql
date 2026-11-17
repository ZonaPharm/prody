-- Tests for migration 20261117_app_errors. Run in the SQL Editor after the
-- migration, first on STAGING, then on production. E4-E12 write inside a
-- sub-transaction that is rolled back, so nothing stays behind.
-- Every row should read passed = true (12 rows).

create or replace function pg_temp.err_probe(p_setup text, p_probe text)
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
  ('E1 app_errors exists with RLS on and no policies',
   exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'app_errors' and rowsecurity)
   and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_errors')),
  ('E2 anon and authenticated have no rights on the table',
   not exists (select 1 from information_schema.role_table_grants
               where table_schema = 'public' and table_name = 'app_errors'
                 and grantee in ('anon', 'authenticated', 'PUBLIC'))),
  ('E3 only service_role may run the two functions',
   has_function_privilege('service_role', 'public.report_app_error(text, text, text, text, text, text, text, text, text, uuid, text, text)', 'EXECUTE')
   and has_function_privilege('service_role', 'public.claim_app_error_alert(interval)', 'EXECUTE')
   and not has_function_privilege('anon', 'public.report_app_error(text, text, text, text, text, text, text, text, text, uuid, text, text)', 'EXECUTE')
   and not has_function_privilege('authenticated', 'public.report_app_error(text, text, text, text, text, text, text, text, text, uuid, text, text)', 'EXECUTE')
   and not has_function_privilege('anon', 'public.claim_app_error_alert(interval)', 'EXECUTE')
   and not has_function_privilege('authenticated', 'public.claim_app_error_alert(interval)', 'EXECUTE')),
  ('E4 a new error is stored once and asks for an e-mail',
   pg_temp.err_probe(
     $s$create temp table r on commit drop as
        select public.report_app_error('test-fp-0001', 'server', 'route', 'проба') as alert$s$,
     $p$select (select alert from r)::text || '/' || count(*) || '/' || min(count)
          from public.app_errors where fingerprint = 'test-fp-0001'$p$) = 'true/1/1'),
  ('E5 the same error again is counted, not repeated',
   pg_temp.err_probe(
     $s$select public.report_app_error('test-fp-0002', 'server', 'route', 'проба');
        select public.report_app_error('test-fp-0002', 'server', 'route', 'проба 2', null, '/x');$s$,
     $p$select count(*) || '/' || min(count) || '/' || min(message) || '/' || min(path)
          from public.app_errors where fingerprint = 'test-fp-0002'$p$) = '1/2/проба 2//x'),
  ('E6 an e-mail is claimed, then nothing more within the hour',
   pg_temp.err_probe(
     $s$update public.app_errors set notified_at = now() - interval '2 hours' where notified_at > now() - interval '1 hour';
        select public.report_app_error('test-fp-0003', 'browser', 'window', 'проба');
        create temp table c1 on commit drop as select fingerprint from public.claim_app_error_alert();
        select public.report_app_error('test-fp-0004', 'browser', 'window', 'проба');
        create temp table c2 on commit drop as select fingerprint from public.claim_app_error_alert();$s$,
     $p$select (select count(*) from c1 where fingerprint = 'test-fp-0003') || '/' || (select count(*) from c2)
          || '/' || (select count(*) from public.app_errors where fingerprint = 'test-fp-0004' and notified_at is null)$p$) = '1/0/1'),
  ('E7 an error already told about does not ask again',
   pg_temp.err_probe(
     $s$select public.report_app_error('test-fp-0005', 'server', 'log', 'проба');
        update public.app_errors set notified_at = now() where fingerprint = 'test-fp-0005';$s$,
     $p$select public.report_app_error('test-fp-0005', 'server', 'log', 'проба')::text$p$) = 'false'),
  ('E8 an error marked fixed opens again when it comes back, and asks again',
   pg_temp.err_probe(
     $s$select public.report_app_error('test-fp-0006', 'server', 'log', 'проба');
        update public.app_errors set notified_at = now(), resolved_at = now() where fingerprint = 'test-fp-0006';
        create temp table r on commit drop as
        select public.report_app_error('test-fp-0006', 'server', 'log', 'проба') as alert;$s$,
     $p$select (select alert from r)::text || '/' || (resolved_at is null)::text || '/' || (notified_at is null)::text
          from public.app_errors where fingerprint = 'test-fp-0006'$p$) = 'true/true/true'),
  ('E9 an unknown source is refused',
   pg_temp.err_probe(
     $s$select public.report_app_error('test-fp-0007', 'mars', 'route', 'проба')$s$,
     $p$select 'stored'$p$) = 'ERR 23514'),
  ('E10 an empty message is refused',
   pg_temp.err_probe(
     $s$select public.report_app_error('test-fp-0008', 'server', 'route', '')$s$,
     $p$select 'stored'$p$) = 'ERR 23514'),
  ('E11 a user id that does not exist does not lose the error',
   pg_temp.err_probe(
     $s$select public.report_app_error('test-fp-0009', 'server', 'route', 'проба', null, null, null, null, null,
                                      '00000000-0000-0000-0000-000000000000'::uuid, 'Някой')$s$,
     $p$select count(*)::text from public.app_errors where fingerprint = 'test-fp-0009' and user_id is null and user_name = 'Някой'$p$) = '1'),
  ('E12 email_settings has the alert recipients column, empty by default',
   exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'email_settings'
             and column_name = 'error_alert_to' and data_type = 'jsonb' and is_nullable = 'NO'))
) as t(test, passed);
