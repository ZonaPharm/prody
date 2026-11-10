-- Deliveries, phase 1: the schema (contract: docs/superpowers/specs/2026-11-10-deliveries-phase1-db.md,
-- "Migration A"). Tables only; the functions that write to them are in
-- 20261110_deliveries_functions.sql.
--
-- A delivery (Д-000124) brings stock into the warehouse store (Офис,
-- stores.is_warehouse = true) and is planned per store. A trip (К-000012)
-- carries one shipment (П-000045) per store, each collecting ready plan rows
-- from any number of open deliveries. Anything short at any step raises a
-- signal; every step is signed in delivery_events, which is append-only.
--
-- Additive only: nine new tables, three sequences, nullable or defaulted
-- columns on products, stock_batches and stock_movements, and one widened
-- check. No existing row is rewritten (products.needs_label has a constant
-- default, which Postgres stores in the catalog without touching the rows).
--
-- Idempotent, so it can be re-applied while iterating on staging: IF NOT
-- EXISTS on tables, columns, sequences and indexes; DROP ... IF EXISTS before
-- re-creating policies, triggers and the type check; ON CONFLICT DO NOTHING
-- for the supplier seed. Re-running it does not change a table created by an
-- earlier run.
--
-- Access: RLS on every new table. Signed-in admins read everything; sellers
-- read only their own store's shipments and shipment lines (no deliveries, no
-- costs, no signals). There are no INSERT/UPDATE/DELETE policies: every write
-- goes through the API with the service role and the functions of migration B.
-- anon loses all privileges on the new tables and sequences, which Supabase's
-- default privileges would otherwise grant it.

-- Adding columns to products, stock_batches and stock_movements and replacing
-- the type check on stock_movements take brief exclusive locks on tables that
-- every sale writes to. Should a long transaction hold one of them, give up
-- (all of it) rather than queue sales behind the wait.
SET LOCAL lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- Sequences. The DB stores plain integers; the UI formats Д- / П- / К- plus
-- six digits.
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.delivery_number_seq AS integer START 1;
CREATE SEQUENCE IF NOT EXISTS public.shipment_number_seq AS integer START 1;
CREATE SEQUENCE IF NOT EXISTS public.trip_number_seq     AS integer START 1;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.suppliers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_name_key ON public.suppliers (lower(btrim(name)));

-- number is null while the delivery is a draft; save_delivery assigns it from
-- delivery_number_seq.
CREATE TABLE IF NOT EXISTS public.deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number        integer UNIQUE,
  status        text NOT NULL DEFAULT 'draft'
                CONSTRAINT deliveries_status_check
                CHECK (status IN ('draft', 'expected', 'in_progress', 'completed', 'cancelled')),
  order_ref     text,
  notes         text,
  created_by    uuid NOT NULL REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  cancelled_at  timestamptz,
  cancelled_by  uuid REFERENCES public.users(id),
  cancel_reason text
);

-- quantity is in units; unit_cost is per unit, VAT included. Items cascade with
-- their delivery because only drafts are ever deleted.
CREATE TABLE IF NOT EXISTS public.delivery_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id  uuid NOT NULL REFERENCES public.deliveries(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL REFERENCES public.products(id),
  supplier_id  uuid REFERENCES public.suppliers(id),
  doc_number   text,
  pack_size    integer NOT NULL DEFAULT 1 CONSTRAINT delivery_items_pack_size_check CHECK (pack_size > 0),
  quantity     integer NOT NULL CONSTRAINT delivery_items_quantity_check CHECK (quantity > 0),
  unit_cost    numeric(12,4) NOT NULL CONSTRAINT delivery_items_unit_cost_check CHECK (unit_cost >= 0),
  received_qty integer NOT NULL DEFAULT 0,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_items_received_qty_check CHECK (received_qty >= 0 AND received_qty <= quantity)
);
CREATE INDEX IF NOT EXISTS delivery_items_delivery_id_idx ON public.delivery_items (delivery_id);
CREATE INDEX IF NOT EXISTS delivery_items_product_id_idx  ON public.delivery_items (product_id);

-- One row per item and destination store. The warehouse store may not appear
-- here; the functions of migration B enforce that.
CREATE TABLE IF NOT EXISTS public.delivery_item_plan (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_item_id uuid NOT NULL REFERENCES public.delivery_items(id) ON DELETE CASCADE,
  store_id         uuid NOT NULL REFERENCES public.stores(id),
  planned_qty      integer NOT NULL CONSTRAINT delivery_item_plan_planned_qty_check CHECK (planned_qty >= 0),
  ready_qty        integer NOT NULL DEFAULT 0,
  shipped_qty      integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_item_plan_qty_order_check
    CHECK (shipped_qty >= 0 AND shipped_qty <= ready_qty AND ready_qty <= planned_qty),
  CONSTRAINT delivery_item_plan_item_store_key UNIQUE (delivery_item_id, store_id)
);
CREATE INDEX IF NOT EXISTS delivery_item_plan_store_id_idx ON public.delivery_item_plan (store_id);

CREATE TABLE IF NOT EXISTS public.trips (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number       integer UNIQUE NOT NULL DEFAULT nextval('public.trip_number_seq'),
  status       text NOT NULL DEFAULT 'open'
               CONSTRAINT trips_status_check CHECK (status IN ('open', 'departed', 'completed')),
  driver_id    uuid REFERENCES public.users(id),
  notes        text,
  created_by   uuid NOT NULL REFERENCES public.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  departed_at  timestamptz,
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.shipments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number      integer UNIQUE NOT NULL DEFAULT nextval('public.shipment_number_seq'),
  trip_id     uuid NOT NULL REFERENCES public.trips(id),
  store_id    uuid NOT NULL REFERENCES public.stores(id),
  status      text NOT NULL DEFAULT 'packing'
              CONSTRAINT shipments_status_check
              CHECK (status IN ('packing', 'packed', 'sent', 'received', 'received_with_issues')),
  box_count   integer CONSTRAINT shipments_box_count_check CHECK (box_count > 0),
  packed_by   uuid REFERENCES public.users(id),
  packed_at   timestamptz,
  sent_by     uuid REFERENCES public.users(id),
  sent_at     timestamptz,
  received_by uuid REFERENCES public.users(id),
  received_at timestamptz,
  created_by  uuid NOT NULL REFERENCES public.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipments_trip_store_key UNIQUE (trip_id, store_id)
);
-- The seller read policy filters on store_id.
CREATE INDEX IF NOT EXISTS shipments_store_id_idx ON public.shipments (store_id);

-- received_qty stays null until the store confirms the line.
CREATE TABLE IF NOT EXISTS public.shipment_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id      uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  plan_id          uuid NOT NULL REFERENCES public.delivery_item_plan(id),
  delivery_item_id uuid NOT NULL REFERENCES public.delivery_items(id),
  product_id       uuid NOT NULL REFERENCES public.products(id),
  qty              integer NOT NULL CONSTRAINT shipment_lines_qty_check CHECK (qty > 0),
  received_qty     integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipment_lines_received_qty_check CHECK (received_qty >= 0 AND received_qty <= qty),
  CONSTRAINT shipment_lines_shipment_plan_key UNIQUE (shipment_id, plan_id)
);
CREATE INDEX IF NOT EXISTS shipment_lines_plan_id_idx ON public.shipment_lines (plan_id);

-- delivery_id is always set from the line the signal is about; a store signal
-- never spans deliveries. A resolved signal carries its resolution, who and
-- when; an open one carries none of them.
CREATE TABLE IF NOT EXISTS public.delivery_signals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id      uuid REFERENCES public.deliveries(id),
  delivery_item_id uuid REFERENCES public.delivery_items(id),
  shipment_id      uuid REFERENCES public.shipments(id),
  shipment_line_id uuid REFERENCES public.shipment_lines(id),
  step             text NOT NULL
                   CONSTRAINT delivery_signals_step_check
                   CHECK (step IN ('receive', 'label', 'pack', 'store_receive')),
  reason           text NOT NULL
                   CONSTRAINT delivery_signals_reason_check
                   CHECK (reason IN ('short', 'partial', 'damaged', 'wrong_product', 'wrong_label', 'missing', 'other')),
  qty_expected     integer,
  qty_actual       integer,
  note             text,
  status           text NOT NULL DEFAULT 'open'
                   CONSTRAINT delivery_signals_status_check CHECK (status IN ('open', 'resolved')),
  resolution       text
                   CONSTRAINT delivery_signals_resolution_check
                   CHECK (resolution IN ('corrected', 'returned_to_supplier', 'found', 'other')),
  resolution_note  text,
  created_by       uuid NOT NULL REFERENCES public.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_by      uuid REFERENCES public.users(id),
  resolved_at      timestamptz,
  CONSTRAINT delivery_signals_resolved_check CHECK (
    (status = 'resolved' AND resolution IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
    OR
    (status = 'open' AND resolution IS NULL AND resolved_by IS NULL AND resolved_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS delivery_signals_open_idx
  ON public.delivery_signals (delivery_id) WHERE status = 'open';

-- The signed log: who did what, when. delivery_id is null for trip-level
-- events. Append-only (trigger below).
CREATE TABLE IF NOT EXISTS public.delivery_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id      uuid REFERENCES public.deliveries(id),
  delivery_item_id uuid REFERENCES public.delivery_items(id),
  plan_id          uuid REFERENCES public.delivery_item_plan(id),
  trip_id          uuid REFERENCES public.trips(id),
  shipment_id      uuid REFERENCES public.shipments(id),
  signal_id        uuid REFERENCES public.delivery_signals(id),
  type             text NOT NULL
                   CONSTRAINT delivery_events_type_check
                   CHECK (type IN ('created', 'saved', 'received', 'plan_changed', 'ready', 'trip_created',
                                   'packed', 'sent', 'store_received', 'signal_raised', 'signal_resolved',
                                   'cancelled', 'completed')),
  store_id         uuid REFERENCES public.stores(id),
  qty              integer,
  details          jsonb NOT NULL DEFAULT '{}',
  created_by       uuid NOT NULL REFERENCES public.users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_events_delivery_id_idx ON public.delivery_events (delivery_id);
CREATE INDEX IF NOT EXISTS delivery_events_created_by_idx  ON public.delivery_events (created_by);
CREATE INDEX IF NOT EXISTS delivery_events_created_at_idx  ON public.delivery_events (created_at);

-- The trip and shipment numbers come from their sequences as column defaults;
-- the delivery number is taken by save_delivery. Tie each sequence to its column.
ALTER SEQUENCE public.delivery_number_seq OWNED BY public.deliveries.number;
ALTER SEQUENCE public.shipment_number_seq OWNED BY public.shipments.number;
ALTER SEQUENCE public.trip_number_seq     OWNED BY public.trips.number;

-- deliveries.updated_at, kept by the existing helper (as on products).
DROP TRIGGER IF EXISTS deliveries_updated_at ON public.deliveries;
CREATE TRIGGER deliveries_updated_at
  BEFORE UPDATE ON public.deliveries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- delivery_events is append-only, for every role: the service role, the
-- functions of migration B and the table owner alike. A row trigger, so it
-- also stops deletes cascaded from other tables.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delivery_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  RAISE EXCEPTION 'delivery_events is append-only';
END;
$$;

REVOKE ALL ON FUNCTION public.delivery_events_append_only() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_events_append_only() TO service_role;

DROP TRIGGER IF EXISTS delivery_events_append_only ON public.delivery_events;
CREATE TRIGGER delivery_events_append_only
  BEFORE UPDATE OR DELETE ON public.delivery_events
  FOR EACH ROW EXECUTE FUNCTION public.delivery_events_append_only();

-- TRUNCATE fires no row trigger, so it gets its own statement trigger. A
-- restore that must clear the log disables this trigger explicitly.
DROP TRIGGER IF EXISTS delivery_events_no_truncate ON public.delivery_events;
CREATE TRIGGER delivery_events_no_truncate
  BEFORE TRUNCATE ON public.delivery_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.delivery_events_append_only();

-- ---------------------------------------------------------------------------
-- Existing tables
-- ---------------------------------------------------------------------------

-- false for products that need no label (teas, vitamins): they become ready
-- for shipping as soon as they are received.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS needs_label boolean NOT NULL DEFAULT true;

-- The delivery item a batch came from; null for every batch before this.
ALTER TABLE public.stock_batches
  ADD COLUMN IF NOT EXISTS delivery_item_id uuid REFERENCES public.delivery_items(id);

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS delivery_id uuid REFERENCES public.deliveries(id);
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS shipment_id uuid REFERENCES public.shipments(id);

-- The same six movement types plus delivery_cancel (cancel_delivery takes the
-- received stock back out of Офис).
--
-- PRODUCTION: this takes a brief ACCESS EXCLUSIVE lock on stock_movements and
-- scans every row to validate the new check, so sales wait while it runs.
-- Apply outside working hours.
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN ('restock', 'sell', 'transfer_in', 'transfer_out', 'void', 'correction', 'delivery_cancel'));

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.suppliers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliveries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_item_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_signals   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_events    ENABLE ROW LEVEL SECURITY;

-- Admins read everything. is_admin() is the existing SECURITY DEFINER helper.
DROP POLICY IF EXISTS "Admins read suppliers" ON public.suppliers;
CREATE POLICY "Admins read suppliers" ON public.suppliers
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins read deliveries" ON public.deliveries;
CREATE POLICY "Admins read deliveries" ON public.deliveries
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins read delivery items" ON public.delivery_items;
CREATE POLICY "Admins read delivery items" ON public.delivery_items
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins read delivery plan" ON public.delivery_item_plan;
CREATE POLICY "Admins read delivery plan" ON public.delivery_item_plan
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins read trips" ON public.trips;
CREATE POLICY "Admins read trips" ON public.trips
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins read shipments" ON public.shipments;
CREATE POLICY "Admins read shipments" ON public.shipments
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins read shipment lines" ON public.shipment_lines;
CREATE POLICY "Admins read shipment lines" ON public.shipment_lines
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins read delivery signals" ON public.delivery_signals;
CREATE POLICY "Admins read delivery signals" ON public.delivery_signals
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins read delivery events" ON public.delivery_events;
CREATE POLICY "Admins read delivery events" ON public.delivery_events
  FOR SELECT TO authenticated USING (public.is_admin());

-- Sellers read their own store's shipments and those shipments' lines, and
-- nothing else of deliveries: no costs, no plans, no signals.
DROP POLICY IF EXISTS "Sellers read own store shipments" ON public.shipments;
CREATE POLICY "Sellers read own store shipments" ON public.shipments
  FOR SELECT TO authenticated
  USING (store_id = (SELECT u.store_id FROM public.users u WHERE u.id = auth.uid()));

DROP POLICY IF EXISTS "Sellers read own store shipment lines" ON public.shipment_lines;
CREATE POLICY "Sellers read own store shipment lines" ON public.shipment_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.shipments s
    WHERE s.id = shipment_lines.shipment_id
      AND s.store_id = (SELECT u.store_id FROM public.users u WHERE u.id = auth.uid())
  ));

-- No INSERT, UPDATE or DELETE policies: with RLS on, signed-in users cannot
-- write. The API writes with the service role, which bypasses RLS.

-- anon gets nothing, and signed-in users get only SELECT (filtered by the
-- policies above). Supabase's default privileges grant both roles everything
-- on new tables and sequences in public, including TRUNCATE, which RLS does
-- not cover, and nextval() on the numbering sequences.
REVOKE ALL ON TABLE
  public.suppliers, public.deliveries, public.delivery_items, public.delivery_item_plan,
  public.trips, public.shipments, public.shipment_lines, public.delivery_signals, public.delivery_events
  FROM anon, authenticated;
GRANT SELECT ON TABLE
  public.suppliers, public.deliveries, public.delivery_items, public.delivery_item_plan,
  public.trips, public.shipments, public.shipment_lines, public.delivery_signals, public.delivery_events
  TO authenticated;
REVOKE ALL ON SEQUENCE
  public.delivery_number_seq, public.shipment_number_seq, public.trip_number_seq
  FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Supplier seed, from products.source. products.source itself is left as it
-- is: old code still reads it.
--
-- One supplier per distinct trimmed, non-empty source, written as it is,
-- except for the merges Владимир approved on 10.11.2026:
--   Temu, Тему, тему, ТЕМУ  -> Temu
--   Панацея, Панацея 2001   -> Панацея 2001
-- Other likely duplicates (Аксон / Ааксон / Аксом, Zein Pharma / ЗЕЙН ФАРМА,
-- Temu/ MERCILEN, Тему Sadoer, Sadoer) stay separate for him to decide.
--
-- Spellings that differ only in letter case collide on the unique index; of
-- those, the one on the most products is kept (then the first alphabetically),
-- so the result does not depend on row order.
-- ---------------------------------------------------------------------------

INSERT INTO public.suppliers (name)
SELECT DISTINCT ON (lower(name)) name
FROM (
  SELECT CASE
           WHEN btrim(source) IN ('Temu', 'Тему', 'тему', 'ТЕМУ') THEN 'Temu'
           WHEN btrim(source) IN ('Панацея', 'Панацея 2001')       THEN 'Панацея 2001'
           ELSE btrim(source)
         END AS name,
         count(*) AS products
  FROM public.products
  WHERE source IS NOT NULL AND btrim(source) <> ''
  GROUP BY 1
) s
ORDER BY lower(name), products DESC, name
ON CONFLICT DO NOTHING;
