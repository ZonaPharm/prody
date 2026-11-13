-- Tasks and notifications along the Deliveries chain.
--
-- 1. A trip gets its driver and day when it is made ("Нов курс"), not only when the
--    driver signs at departure: trips.planned_driver_id / planned_date / planned_time.
--    send_trip still writes trips.driver_id (who actually signed); the two may differ
--    when another person takes the trip.
-- 2. public.notifications: short messages to one person ("Имаш курс К-27 в четвъртък",
--    "Идва към вас П-35"). Written only by the server (service role) from the API
--    routes; a signed-in user reads only their own. Marking as read also goes through
--    the server, so there is no UPDATE policy.
--
-- Nothing here changes stock or any delivery function. Safe to run more than once.
-- Run in STAGING first, then production (before merging the PR that uses it).

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS planned_driver_id uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS planned_date date,
  ADD COLUMN IF NOT EXISTS planned_time time;

COMMENT ON COLUMN public.trips.planned_driver_id IS
  'Who is to drive the trip, chosen when it is made; driver_id is who signed at departure';
COMMENT ON COLUMN public.trips.planned_date IS 'The day the trip is to leave Офис (Europe/Sofia)';
COMMENT ON COLUMN public.trips.planned_time IS 'Optional hour the trip is to leave';

CREATE INDEX IF NOT EXISTS trips_planned_driver_idx ON public.trips (planned_driver_id)
  WHERE planned_driver_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind        text NOT NULL CONSTRAINT notifications_kind_check CHECK (kind IN (
                'trip_assigned', 'trip_unassigned', 'trip_changed', 'trip_cancelled',
                'shipment_coming', 'shipment_sent', 'shipment_removed',
                'shipment_issue')),
  title       text NOT NULL CONSTRAINT notifications_title_check CHECK (length(title) BETWEEN 1 AND 300),
  body        text CONSTRAINT notifications_body_check CHECK (body IS NULL OR length(body) <= 2000),
  link        text CONSTRAINT notifications_link_check CHECK (link IS NULL OR (link LIKE '/%' AND length(link) <= 300)),
  trip_id     uuid REFERENCES public.trips(id) ON DELETE CASCADE,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON public.notifications (user_id)
  WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Signed-in users only read (their own rows, by the policy); the server writes.
REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;
