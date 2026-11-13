-- AI асистент, част 2 (2026-11-13): чернови с потвърждение и файлове.
--
-- Асистентът не записва нищо сам. Когато предложи чернова на доставка, поръчка
-- към доставчик, нов продукт или промяна на продукт, предложението се пази тук
-- със статус 'proposed'. Записва се едва когато човекът натисне бутона в чата
-- (статус 'done', с резултата и кой е потвърдил) или се отказва ('dismissed').
-- Excel и документите за печат също се пазят тук, с данните им, за да се свалят
-- после същите.
--
-- Само сървърът (service_role), като останалите ai_ таблици.
-- След 20261113_ai_assistant.sql. Първо staging, после production. Може повторно.

CREATE TABLE IF NOT EXISTS public.ai_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  -- Въпросът, след чийто отговор се показва картата.
  question_seq    integer,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind            text NOT NULL CONSTRAINT ai_actions_kind_check CHECK (kind IN
                    ('delivery_draft', 'supplier_order', 'product_create', 'product_update', 'excel', 'document')),
  title           text NOT NULL CONSTRAINT ai_actions_title_check CHECK (char_length(title) BETWEEN 1 AND 200),
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'proposed'
                    CONSTRAINT ai_actions_status_check CHECK (status IN ('proposed', 'done', 'dismissed')),
  result          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  done_at         timestamptz,
  done_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT ai_actions_done_check CHECK ((status = 'proposed') = (done_at IS NULL))
);
CREATE INDEX IF NOT EXISTS ai_actions_conversation_idx ON public.ai_actions (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS ai_actions_user_idx ON public.ai_actions (user_id, created_at);

ALTER TABLE public.ai_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_actions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_actions TO service_role;
