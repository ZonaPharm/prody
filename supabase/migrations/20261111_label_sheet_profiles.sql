-- Profiles of label paper for printing labels on pre-cut A4 sheets (/print/labels).
-- The sheets built into the app (Office1 24, 40, 44, 65 a sheet) are in the code;
-- this table holds the ones people add: another paper, or the same paper with the
-- labels moved a little because a printer prints off by a millimetre or two.
-- Shared by every admin's computer. Read by admins; written only by the API
-- (service role), like the deliveries tables.

CREATE TABLE IF NOT EXISTS public.label_sheet_profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  cols        int  NOT NULL CHECK (cols BETWEEN 1 AND 20),
  rows        int  NOT NULL CHECK (rows BETWEEN 1 AND 40),
  -- Label size and where the first label starts, mm.
  width_mm    numeric(6,2) NOT NULL CHECK (width_mm BETWEEN 15 AND 210),
  height_mm   numeric(6,2) NOT NULL CHECK (height_mm BETWEEN 10 AND 297),
  top_mm      numeric(6,2) NOT NULL DEFAULT 0 CHECK (top_mm BETWEEN 0 AND 297),
  left_mm     numeric(6,2) NOT NULL DEFAULT 0 CHECK (left_mm BETWEEN 0 AND 210),
  gap_x_mm    numeric(6,2) NOT NULL DEFAULT 0 CHECK (gap_x_mm BETWEEN 0 AND 100),
  gap_y_mm    numeric(6,2) NOT NULL DEFAULT 0 CHECK (gap_y_mm BETWEEN 0 AND 100),
  -- The whole print moved right (x) and down (y), mm; negative moves left and up.
  offset_x_mm numeric(5,2) NOT NULL DEFAULT 0 CHECK (offset_x_mm BETWEEN -20 AND 20),
  offset_y_mm numeric(5,2) NOT NULL DEFAULT 0 CHECK (offset_y_mm BETWEEN -20 AND 20),
  created_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- The labels fit on A4 (210 × 297 mm), offsets aside.
  CONSTRAINT label_sheet_profiles_fits_a4 CHECK (
    left_mm + cols * width_mm + (cols - 1) * gap_x_mm <= 210.01
    AND top_mm + rows * height_mm + (rows - 1) * gap_y_mm <= 297.01
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS label_sheet_profiles_name_key
  ON public.label_sheet_profiles (lower(btrim(name)));

ALTER TABLE public.label_sheet_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read label sheet profiles" ON public.label_sheet_profiles;
CREATE POLICY "Admins read label sheet profiles" ON public.label_sheet_profiles
  FOR SELECT TO authenticated USING (public.is_admin());

-- No write policies: the API writes with the service role. anon gets nothing.
REVOKE ALL ON TABLE public.label_sheet_profiles FROM anon, authenticated;
GRANT SELECT ON TABLE public.label_sheet_profiles TO authenticated;
