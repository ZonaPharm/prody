-- Several roles for one person (Владимир, 2026-11-12: "няколко роли на един,
-- примерно офис и шофьор, продавач, счетоводител, администратор").
--
-- users.roles (text[]) holds the roles: admin, office, seller, driver, accountant.
-- The old users.role ('admin' | 'seller') stays and is kept in step by a trigger,
-- so is_admin(), every RLS policy and every page that reads users.role keep
-- working unchanged: role = 'admin' when roles hold 'admin', 'seller' otherwise.
--
-- Code that still writes only users.role (the app before this change) keeps
-- working too: a change of role alone swaps admin/seller inside roles and leaves
-- the other roles (driver, office, ...) as they were.
--
-- Also: a seller may file a stock request only for their own store, and Офис
-- reads the delivery tables (see the end).
--
-- Run in staging first, then production, BEFORE the app that reads users.roles.
-- Safe to run twice.

BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS roles text[] NOT NULL DEFAULT '{}';

-- Everybody gets the role they have today.
UPDATE public.users
SET roles = ARRAY[role]
WHERE cardinality(roles) = 0 AND role IN ('admin', 'seller');

-- Whoever has already signed for a trip is a driver.
UPDATE public.users u
SET roles = u.roles || ARRAY['driver']
WHERE NOT ('driver' = ANY (u.roles))
  AND EXISTS (SELECT 1 FROM public.trips t WHERE t.driver_id = u.id);

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_roles_known;
ALTER TABLE public.users ADD CONSTRAINT users_roles_known
  CHECK (roles <@ ARRAY['admin', 'office', 'seller', 'driver', 'accountant']::text[]);

COMMENT ON COLUMN public.users.roles IS
  'Roles of the person: admin, office, seller, driver, accountant (several allowed). '
  'users.role is derived from it by users_sync_role: admin when roles hold admin, seller otherwise.';

CREATE OR REPLACE FUNCTION public.users_sync_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- New account from code that knows only role (or the auth sign-up trigger).
    IF NEW.roles IS NULL OR cardinality(NEW.roles) = 0 THEN
      NEW.roles := ARRAY[coalesce(NEW.role, 'seller')];
    END IF;
  ELSIF NEW.roles IS NOT DISTINCT FROM OLD.roles AND NEW.role IS DISTINCT FROM OLD.role THEN
    -- Old code changed only role: swap admin/seller, keep the other roles.
    NEW.roles := array_remove(array_remove(OLD.roles, 'admin'), 'seller') || ARRAY[coalesce(NEW.role, 'seller')];
  END IF;

  -- No duplicates, fixed order.
  NEW.roles := ARRAY(
    SELECT r FROM unnest(ARRAY['admin', 'office', 'seller', 'driver', 'accountant']) WITH ORDINALITY AS k(r, i)
    WHERE r = ANY (NEW.roles) ORDER BY i
  ) || ARRAY(SELECT DISTINCT r FROM unnest(NEW.roles) AS x(r)
             WHERE r <> ALL (ARRAY['admin', 'office', 'seller', 'driver', 'accountant']));
  -- (an unknown role is kept here so the CHECK refuses it with a clear error)

  IF cardinality(NEW.roles) = 0 THEN
    RAISE EXCEPTION 'Потребителят трябва да има поне една роля' USING ERRCODE = '23514';
  END IF;

  NEW.role := CASE WHEN 'admin' = ANY (NEW.roles) THEN 'admin' ELSE 'seller' END;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.users_sync_role() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_sync_role ON public.users;
CREATE TRIGGER users_sync_role
  BEFORE INSERT OR UPDATE OF role, roles ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_sync_role();

-- For RLS policies: does the signed-in, active person hold this role?
-- Like is_admin() it must be callable by authenticated (policies run as the
-- caller); it only ever tells the caller about their own account.
CREATE OR REPLACE FUNCTION public.has_role(p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT p_role = ANY (u.roles) AND u.is_active IS NOT FALSE FROM public.users u WHERE u.id = auth.uid()),
    false)
$$;

REVOKE ALL ON FUNCTION public.has_role(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(text) TO authenticated, service_role;

-- Access hole found in the review (2026-11-12): a signed-in seller could write a
-- stock request for another store straight through the API (the policy checked
-- only requested_by). Now the store must be their own. Admins keep their own
-- full-access policy ("Admins full access requests").
DROP POLICY IF EXISTS "Sellers insert own requests" ON public.stock_requests;
CREATE POLICY "Sellers insert own requests" ON public.stock_requests
  FOR INSERT
  WITH CHECK (
    requested_by = auth.uid()
    AND store_id = (SELECT u.store_id FROM public.users u WHERE u.id = auth.uid())
  );

-- Офис works with Доставки without being an admin (Владимир, 2026-11-12): it
-- reads what the delivery screens read. The writes go through the server
-- (service role, database functions), as for admins. Resolving a problem stays
-- admin-only (resolve_signal checks it). Офис does not read sales.
-- label_sheet_profiles and notifications may not exist yet (their migrations
-- can run later); they are skipped then and get their policy from their own
-- migration's admin rule, so run this file again after them.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'deliveries', 'delivery_items', 'delivery_item_plan', 'delivery_events', 'delivery_signals',
    'shipments', 'shipment_lines', 'trips', 'suppliers', 'label_sheet_profiles',
    'products', 'product_images', 'users'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Office reads ' || t, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_role(%L))',
        'Office reads ' || t, t, 'office');
    END IF;
  END LOOP;
END $$;

-- „Етикетирай …“ to Офис when an admin receives a delivery: a new kind of
-- notification. The table comes with 20261112_deliveries_tasks_notifications
-- (run that one first); skipped if it is not there yet.
DO $$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
      'trip_assigned', 'trip_unassigned', 'trip_changed', 'trip_cancelled',
      'shipment_coming', 'shipment_sent', 'shipment_removed',
      'shipment_issue', 'label_waiting'));
  END IF;
END $$;

COMMIT;
