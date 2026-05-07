CREATE TABLE IF NOT EXISTS email_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  smtp_host text DEFAULT 'smtp.gmail.com',
  smtp_port int DEFAULT 587,
  smtp_user text,
  smtp_pass text,
  sender_email text,
  recipients jsonb DEFAULT '[]',
  report_day int DEFAULT 5,
  report_hour int DEFAULT 18,
  report_minute int DEFAULT 0,
  report_sections jsonb DEFAULT '["summary","stores","top-products","top-revenue","low-stock"]',
  updated_at timestamptz DEFAULT now()
);

INSERT INTO email_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE email_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins full access email_settings" ON email_settings;
CREATE POLICY "Admins full access email_settings" ON email_settings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
