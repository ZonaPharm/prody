-- Снимка на прода точно преди пускането (Free план: Supabase не пази бекъпи, от които да се възстанови).
-- Копира ВСЯКА таблица от public в отделна схема before_release, в същата база.
-- Не пипа нищо в public. Пуска се в SQL Editor на прода, след "Създай бекъп сега" и преди 01_.
--
-- Схемата не се вижда от приложението (API-то вижда само public) и е затворена за anon/authenticated.
-- Ако схемата вече съществува, файлът спира с грешка и не презаписва старата снимка.
-- Изтрива се ръчно след 2–3 спокойни седмици:  DROP SCHEMA before_release CASCADE;
--
-- Резултат: една таблица с всички копирани таблици и броя редове (трябва да съвпада с public).

CREATE SCHEMA before_release;
REVOKE ALL ON SCHEMA before_release FROM PUBLIC, anon, authenticated;

CREATE TABLE before_release._summary (
  table_name text PRIMARY KEY,
  rows_copied bigint NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now()
);

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
    EXECUTE format('SELECT count(*) FROM before_release.%I', t.relname) INTO n;
    INSERT INTO before_release._summary (table_name, rows_copied) VALUES (t.relname, n);
  END LOOP;

  -- Поредните номера (продажби, партиди…), за да се върнат и те при нужда.
  CREATE TABLE before_release._sequences AS
  SELECT s.schemaname, s.sequencename, s.last_value
  FROM pg_sequences s
  WHERE s.schemaname = 'public';
END $$;

SELECT table_name, rows_copied, taken_at
FROM before_release._summary
ORDER BY table_name;
