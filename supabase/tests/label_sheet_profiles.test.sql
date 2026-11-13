-- Tests for migration 20261111_label_sheet_profiles. Run against STAGING only, after the
-- migration (SQL Editor). Every insert runs in its own sub-transaction that is rolled
-- back, so nothing stays. Every row should read passed = true.

-- 'ok' when the statements run (then rolled back), the SQLSTATE when they fail.
create or replace function pg_temp.lp_try(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  raise exception 'ROLLBACK';
exception when others then
  if sqlerrm = 'ROLLBACK' then return 'ok'; end if;
  return sqlstate;
end $$;

create or replace function pg_temp.lp_row(p_name text, p_cols int, p_rows int, p_w numeric, p_h numeric,
                                          p_top numeric default 0, p_left numeric default 0,
                                          p_gx numeric default 0, p_ox numeric default 0)
returns text language sql as $$
  select format('insert into public.label_sheet_profiles (name, cols, rows, width_mm, height_mm, top_mm, left_mm, gap_x_mm, offset_x_mm) values (%L, %s, %s, %s, %s, %s, %s, %s, %s)',
                p_name, p_cols, p_rows, p_w, p_h, p_top, p_left, p_gx, p_ox) $$;

select * from (values
  ('P1 a 24 a sheet profile with an offset goes in',
   pg_temp.lp_try(pg_temp.lp_row('TEST 24 Офис', 3, 8, 70, 37, 0.5, 0, 0, -1.5)) = 'ok'),
  ('P2 the 65 sheet with gaps fits',
   pg_temp.lp_try(pg_temp.lp_row('TEST 65', 5, 13, 38.1, 21.2, 10.7, 4.75, 2.5)) = 'ok'),
  ('P3 labels wider than A4 are refused',
   pg_temp.lp_try(pg_temp.lp_row('TEST wide', 4, 8, 70, 37)) = '23514'),
  ('P4 labels taller than A4 are refused',
   pg_temp.lp_try(pg_temp.lp_row('TEST tall', 3, 9, 70, 37)) = '23514'),
  ('P5 an empty name is refused',
   pg_temp.lp_try(pg_temp.lp_row('   ', 3, 8, 70, 37)) = '23514'),
  ('P6 an offset over 20 mm is refused',
   pg_temp.lp_try(pg_temp.lp_row('TEST off', 3, 8, 70, 37, 0, 0, 0, 25)) = '23514'),
  ('P7 the same name twice (case, spaces) is refused',
   pg_temp.lp_try(pg_temp.lp_row('TEST twice', 3, 8, 70, 37) || '; ' || pg_temp.lp_row(' test TWICE ', 3, 8, 70, 37)) = '23505'),
  ('P8 signed-in users and anon cannot write',
   not has_table_privilege('authenticated', 'public.label_sheet_profiles', 'INSERT')
   and not has_table_privilege('authenticated', 'public.label_sheet_profiles', 'UPDATE')
   and not has_table_privilege('authenticated', 'public.label_sheet_profiles', 'DELETE')
   and not has_table_privilege('anon', 'public.label_sheet_profiles', 'SELECT')),
  ('P9 row level security is on',
   (select relrowsecurity from pg_class where oid = 'public.label_sheet_profiles'::regclass)),
  ('P10 nothing was left behind',
   not exists (select 1 from public.label_sheet_profiles where name ilike 'TEST%'))
) as t(test, passed);
