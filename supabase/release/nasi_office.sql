-- Наси: само Офис (Владимир, 2026-11-17: „да“). Пуска се в production СЛЕД миграция 13
-- (колоната roles) и СЛЕД като имейлът му е в DELIVERIES_ENABLED във Vercel; иначе той няма
-- Задачи/Доставки и влиза в „Моите продажби“ без нищо за правене.
--
-- Какво губи: Табло, Продажби, Отчети, Настройки, Каталог, Инвентаризация и старите Заявки
-- (одобряване и пращане на заявки е само за админ). Какво получава: Задачи и Доставки като Офис
-- (етикетиране, опаковане, курсове). Връща се назад от Настройки → Потребители (отметка
-- Администратор) или с долния ред за връщане.
--
-- Тригерът users_sync_role прави role = 'seller' (не е админ); store_id остава празен, защото
-- Офис без Продавач не принадлежи на обект.
--
-- Резултат: един ред за Наси с roles = {office}, role = seller, ok = true.
-- Връщане назад:  UPDATE public.users SET roles = ARRAY['admin'] WHERE email = 'nasi.ofis@prody.local';

BEGIN;

DO $$
DECLARE
  n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'roles') THEN
    RAISE EXCEPTION 'Първо миграция 13 (20261112_user_roles): няма колона users.roles';
  END IF;

  UPDATE public.users
  SET roles = ARRAY['office'], store_id = NULL
  WHERE email = 'nasi.ofis@prody.local';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Очаквах точно един потребител nasi.ofis@prody.local, намерих %', n;
  END IF;
END $$;

COMMIT;

SELECT display_name, email, roles, role, store_id,
       roles = ARRAY['office'] AND role = 'seller' AND store_id IS NULL AS ok
FROM public.users
WHERE email = 'nasi.ofis@prody.local';
