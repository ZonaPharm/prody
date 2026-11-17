-- АВАРИЙНО, само ако след пускането смяна на потребител или заявка от магазин спре с грешка,
-- която идва от базата. Връща поведението отпреди миграция 13 (user_roles):
--   * маха тригера, който държи users.role и users.roles в синхрон (role остава истината,
--     както в стария код);
--   * връща старото правило за заявки: продавачът записва заявка от свое име
--     (без проверката, че обектът е неговият).
-- Колоната roles, функцията has_role и правилата „Office reads …“ остават: старият код не ги
-- ползва, а без тях хората от Офис не биха виждали Доставки.
-- Обратно: пуснете отново 13_.

BEGIN;
DROP TRIGGER IF EXISTS users_sync_role ON public.users;
DROP POLICY IF EXISTS "Sellers insert own requests" ON public.stock_requests;
CREATE POLICY "Sellers insert own requests" ON public.stock_requests
  FOR INSERT
  WITH CHECK (requested_by = auth.uid());
COMMIT;

SELECT polname AS правило, pg_get_expr(polwithcheck, polrelid) AS проверка
FROM pg_policy
WHERE polrelid = 'public.stock_requests'::regclass AND polname = 'Sellers insert own requests';
