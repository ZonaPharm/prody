-- Снимка на прода точно преди пускането (Free план: Supabase не пази бекъпи, от които да се възстанови).
-- Копира ВСЯКА таблица от public в отделна схема before_release, в същата база.
-- Не пипа нищо в public. Пуска се в SQL Editor на прода, след "Създай бекъп сега" и преди 01_.
--
-- Защита: схемата не се вижда от приложението (API-то вижда само public), затворена е за
-- anon/authenticated, а на всяка копирана таблица е включен RLS без политики и правата са отнети.
-- Така копието се чете само от SQL Editor.
--
-- Ако схемата вече съществува, файлът спира с грешка и не презаписва старата снимка.
-- ПРЕСНИМАНЕ (например ако е пусната по-рано и искате нова в самата вечер): първо пуснете САМО
--     DROP SCHEMA before_release CASCADE;
-- и после целия този файл отново.
-- Изтрива се ръчно след 2–3 спокойни седмици със същия ред.
--
-- Резултат: една таблица с всички копирани таблици и броя редове (трябва да съвпада с public).

CREATE SCHEMA before_release;
REVOKE ALL ON SCHEMA before_release FROM PUBLIC, anon, authenticated;

CREATE TABLE before_release._summary (
  table_name text PRIMARY KEY,
  rows_copied bigint NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE before_release._summary ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE before_release._summary FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t record;
  n bigint;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    EXECUTE format('CREATE TABLE before_release.%I AS TABLE public.%I', t.relname, t.relname);
    EXECUTE format('ALTER TABLE before_release.%I ENABLE ROW LEVEL SECURITY', t.relname);
    EXECUTE format('REVOKE ALL ON TABLE before_release.%I FROM PUBLIC, anon, authenticated', t.relname);
    EXECUTE format('SELECT count(*) FROM before_release.%I', t.relname) INTO n;
    INSERT INTO before_release._summary (table_name, rows_copied) VALUES (t.relname, n);
  END LOOP;

  -- Поредните номера (продажби, партиди…), за да се върнат и те при нужда.
  CREATE TABLE before_release._sequences AS
  SELECT s.schemaname, s.sequencename, s.last_value
  FROM pg_sequences s
  WHERE s.schemaname = 'public';
  ALTER TABLE before_release._sequences ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE before_release._sequences FROM PUBLIC, anon, authenticated;
END $$;

-- Проверка: всяка таблица в копието е с RLS (rls_off трябва да е 0).
SELECT table_name, rows_copied, taken_at,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = 'before_release' AND c.relkind = 'r' AND NOT c.relrowsecurity) AS rls_off
FROM before_release._summary
ORDER BY table_name;
