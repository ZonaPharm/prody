-- Tests for migration 20261112_deliveries_tasks_notifications (trip driver and day,
-- notifications). Run against STAGING only (SQL Editor), after the migration.
-- Every change happens inside a block that is rolled back, so nothing stays.
-- Needs at least two rows in public.users. Every row should read passed = true.

-- 'ok' when the statement runs (then rolled back), the SQLSTATE when it fails.
create or replace function pg_temp.nt_try(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  raise exception 'ROLLBACK';
exception when others then
  if sqlerrm = 'ROLLBACK' then return 'ok'; end if;
  return sqlstate;
end $$;

-- How many notifications p_uid sees as a signed-in user.
create or replace function pg_temp.nt_visible(p_uid uuid)
returns text language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.notifications;
  reset role;
  return n::text;
exception when others then
  reset role;
  return 'error ' || sqlstate;
end $$;

-- Whether a signed-in user can mark their own notification read (they must not: the server does).
create or replace function pg_temp.nt_update_own(p_uid uuid)
returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.notifications set read_at = now() where user_id = p_uid;
  reset role;
  return 'updated';
exception when others then
  reset role;
  return sqlstate;
end $$;

create or replace function pg_temp.nt_tests()
returns table(test text, passed boolean, detail text) language plpgsql as $$
declare
  v_a uuid; v_b uuid; v_trip uuid;
  r_test text[] := '{}'; r_ok boolean[] := '{}'; r_detail text[] := '{}';
  v text;
begin
  select id into v_a from public.users order by id limit 1;
  select id into v_b from public.users where id <> v_a order by id limit 1;

  begin
    insert into public.trips (created_by, planned_driver_id, planned_date, planned_time)
    values (v_a, v_b, date '2026-11-13', time '09:30')
    returning id into v_trip;

    r_test := r_test || text 'N1 a trip keeps its driver, day and hour';
    r_ok := r_ok || exists (select 1 from public.trips where id = v_trip and planned_driver_id = v_b
                            and planned_date = date '2026-11-13' and planned_time = time '09:30' and driver_id is null);
    r_detail := r_detail || ''::text;

    insert into public.notifications (user_id, kind, title, link, trip_id)
    values (v_a, 'shipment_coming', 'TEST идва към вас', '/my-tasks', v_trip),
           (v_b, 'trip_assigned', 'TEST имаш курс', '/my-tasks', v_trip),
           (v_b, 'trip_changed', 'TEST курсът е преместен', null, v_trip);

    v := pg_temp.nt_visible(v_a);
    r_test := r_test || text 'N2 a signed-in user sees only their own notifications';
    r_ok := r_ok || (v = '1' and pg_temp.nt_visible(v_b) = '2');
    r_detail := r_detail || ('a sees ' || v);

    v := pg_temp.nt_update_own(v_b);
    r_test := r_test || text 'N3 a signed-in user cannot change a notification (the server marks it read)';
    r_ok := r_ok || (v = '42501' and not exists (select 1 from public.notifications where user_id = v_b and read_at is not null));
    r_detail := r_detail || v;

    r_test := r_test || text 'N4 an unknown kind is refused';
    r_ok := r_ok || (pg_temp.nt_try(format('insert into public.notifications (user_id, kind, title) values (%L, %L, %L)', v_a, 'spam', 'x')) = '23514');
    r_detail := r_detail || ''::text;

    r_test := r_test || text 'N5 a link outside the app is refused';
    r_ok := r_ok || (pg_temp.nt_try(format('insert into public.notifications (user_id, kind, title, link) values (%L, %L, %L, %L)', v_a, 'trip_assigned', 'x', 'https://evil.example')) = '23514');
    r_detail := r_detail || ''::text;

    r_test := r_test || text 'N6 an empty title is refused';
    r_ok := r_ok || (pg_temp.nt_try(format('insert into public.notifications (user_id, kind, title) values (%L, %L, %L)', v_a, 'trip_assigned', '')) = '23514');
    r_detail := r_detail || ''::text;

    delete from public.notifications where trip_id = v_trip and user_id = v_a;
    delete from public.trips where id = v_trip;
    r_test := r_test || text 'N7 deleting a trip takes its notifications with it';
    r_ok := r_ok || not exists (select 1 from public.notifications where trip_id = v_trip);
    r_detail := r_detail || ''::text;

    raise exception 'ROLLBACK';
  exception when others then
    if sqlerrm <> 'ROLLBACK' then
      r_test := r_test || text 'N0 the scenario ran'; r_ok := r_ok || false; r_detail := r_detail || (sqlstate || ' ' || sqlerrm);
    end if;
  end;

  r_test := r_test || text 'N8 signed-in users only read; anon reads nothing';
  r_ok := r_ok || (has_table_privilege('authenticated', 'public.notifications', 'SELECT')
    and not has_table_privilege('authenticated', 'public.notifications', 'INSERT')
    and not has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.notifications', 'DELETE')
    and not has_table_privilege('anon', 'public.notifications', 'SELECT'));
  r_detail := r_detail || ''::text;

  r_test := r_test || text 'N9 row level security is on';
  r_ok := r_ok || (select relrowsecurity from pg_class where oid = 'public.notifications'::regclass);
  r_detail := r_detail || ''::text;

  r_test := r_test || text 'N10 nothing was left behind';
  r_ok := r_ok || not exists (select 1 from public.notifications where title like 'TEST %');
  r_detail := r_detail || ''::text;

  return query select r_test[i], r_ok[i], r_detail[i] from generate_subscripts(r_test, 1) as i;
end $$;

select * from pg_temp.nt_tests();
