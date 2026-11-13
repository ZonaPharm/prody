-- AI асистент (2026-11-13): чат в Prody за избрани администратори.
--
-- Всичко тук се чете и пише само от сървъра (service_role). Браузърът не стига
-- до тези таблици: RLS е включен без нито една политика, а правата на anon и
-- authenticated са махнати. Така никой не може сам да си даде достъп, да чете
-- чужди разговори или да промени тавана на разходите.
--
-- Пуска се първо в staging, после в production. Може да се пусне повторно.

-- Кой има достъп. Само администратор може да бъде добавен (проверява се и в
-- кода при всеки въпрос): асистентът вижда продажбите, а Офис не бива да ги вижда.
CREATE TABLE IF NOT EXISTS public.ai_assistant_access (
  user_id    uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);

-- Една-единствена настройка: месечният таван на разходите в долари.
CREATE TABLE IF NOT EXISTS public.ai_assistant_settings (
  id              integer PRIMARY KEY DEFAULT 1 CONSTRAINT ai_assistant_settings_single CHECK (id = 1),
  monthly_cap_usd numeric(10,2) NOT NULL DEFAULT 50
                  CONSTRAINT ai_assistant_settings_cap_check CHECK (monthly_cap_usd >= 0 AND monthly_cap_usd <= 10000),
  updated_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.ai_assistant_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Разговорите. Всеки вижда само своите (проверява се в кода).
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title      text NOT NULL DEFAULT 'Нов разговор'
             CONSTRAINT ai_conversations_title_check CHECK (length(title) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_conversations_user_idx ON public.ai_conversations (user_id, updated_at DESC);

-- Съобщенията точно както са пратени към модела и върнати от него (content е
-- масивът от блокове на API-то). Пазят се непроменени, защото следващият въпрос
-- в разговора ги праща обратно такива, каквито са. seq подрежда разговора.
-- display е текстът за екрана: въпросът или отговорът; NULL за междинните
-- стъпки (справките и резултатите им), които екранът не показва.
CREATE TABLE IF NOT EXISTS public.ai_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  seq             integer NOT NULL,
  role            text NOT NULL CONSTRAINT ai_messages_role_check CHECK (role IN ('user', 'assistant')),
  content         jsonb NOT NULL,
  display         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_messages_conversation_seq_key UNIQUE (conversation_id, seq)
);

-- Разходът: по един ред за всяко извикване на модела.
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id    uuid REFERENCES public.ai_conversations(id) ON DELETE SET NULL,
  model              text NOT NULL,
  input_tokens       integer NOT NULL DEFAULT 0,
  output_tokens      integer NOT NULL DEFAULT 0,
  cache_read_tokens  integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  cost_usd           numeric(12,6) NOT NULL DEFAULT 0 CONSTRAINT ai_usage_cost_check CHECK (cost_usd >= 0),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON public.ai_usage (created_at);
CREATE INDEX IF NOT EXISTS ai_usage_user_idx ON public.ai_usage (user_id, created_at);

-- Само сървърът.
ALTER TABLE public.ai_assistant_access   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_assistant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage              ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_assistant_access   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ai_assistant_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ai_conversations      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ai_messages           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ai_usage              FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.ai_assistant_access   TO service_role;
GRANT ALL ON TABLE public.ai_assistant_settings TO service_role;
GRANT ALL ON TABLE public.ai_conversations      TO service_role;
GRANT ALL ON TABLE public.ai_messages           TO service_role;
GRANT ALL ON TABLE public.ai_usage              TO service_role;
