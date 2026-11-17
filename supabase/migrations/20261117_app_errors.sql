-- Грешки в приложението (2026-11-17).
--
-- Досега грешките отиваха само в логовете на Vercel, които на Hobby плана се
-- пазят един час, а грешките в браузъра не стигаха до никъде. Тук влиза всяка
-- грешка от сървъра и от браузъра. Една и съща грешка (същият „отпечатък“) не
-- се повтаря, а се брои: count и last_seen. Админът я маркира „Оправено“; ако
-- се появи пак, се отваря отново и пак идва известие.
--
-- Само сървърът (service_role) чете и пише, както ai_ таблиците. Екранът в
-- Настройки → Грешки чете през API, който първо проверява, че е админ.
--
-- Първо staging, после production. Може да се пусне повторно.

CREATE TABLE IF NOT EXISTS public.app_errors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint  text NOT NULL CONSTRAINT app_errors_fingerprint_key UNIQUE
                 CONSTRAINT app_errors_fingerprint_check CHECK (char_length(fingerprint) BETWEEN 8 AND 64),
  source       text NOT NULL CONSTRAINT app_errors_source_check CHECK (source IN ('server', 'browser')),
  -- Къде: route, render, action, proxy, log (console.error), window, promise, boundary.
  kind         text NOT NULL CONSTRAINT app_errors_kind_check CHECK (char_length(kind) BETWEEN 1 AND 40),
  message      text NOT NULL CONSTRAINT app_errors_message_check CHECK (char_length(message) BETWEEN 1 AND 2000),
  stack        text CONSTRAINT app_errors_stack_check CHECK (char_length(stack) <= 8000),
  path         text CONSTRAINT app_errors_path_check CHECK (char_length(path) <= 500),
  method       text CONSTRAINT app_errors_method_check CHECK (char_length(method) <= 10),
  -- Кодът, който Next показва на потребителя при грешка на страница.
  digest       text CONSTRAINT app_errors_digest_check CHECK (char_length(digest) <= 100),
  -- Версията (първите знаци от комита), на която се е случила последно.
  release      text CONSTRAINT app_errors_release_check CHECK (char_length(release) <= 40),
  user_id      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  user_name    text CONSTRAINT app_errors_user_name_check CHECK (char_length(user_name) <= 200),
  user_agent   text CONSTRAINT app_errors_user_agent_check CHECK (char_length(user_agent) <= 500),
  count        integer NOT NULL DEFAULT 1 CONSTRAINT app_errors_count_check CHECK (count >= 1),
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- Кога е тръгнал имейл за нея. NULL = още не е казано на никого.
  notified_at  timestamptz
);
CREATE INDEX IF NOT EXISTS app_errors_last_seen_idx ON public.app_errors (last_seen DESC);
CREATE INDEX IF NOT EXISTS app_errors_pending_alert_idx ON public.app_errors (first_seen)
  WHERE notified_at IS NULL AND resolved_at IS NULL;

ALTER TABLE public.app_errors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_errors FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.app_errors TO service_role;

-- До кого да тръгва имейлът за грешки. Празно = на никого (екранът го казва).
ALTER TABLE public.email_settings
  ADD COLUMN IF NOT EXISTS error_alert_to jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Записва една грешка: нова или +1 към същата. Ако е била маркирана
-- „Оправено“, се отваря отново и чака ново известие.
-- Връща true, когато за нея още не е тръгнал имейл.
CREATE OR REPLACE FUNCTION public.report_app_error(
  p_fingerprint text,
  p_source      text,
  p_kind        text,
  p_message     text,
  p_stack       text DEFAULT NULL,
  p_path        text DEFAULT NULL,
  p_method      text DEFAULT NULL,
  p_digest      text DEFAULT NULL,
  p_release     text DEFAULT NULL,
  p_user_id     uuid DEFAULT NULL,
  p_user_name   text DEFAULT NULL,
  p_user_agent  text DEFAULT NULL
) RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO public.app_errors AS e
    (fingerprint, source, kind, message, stack, path, method, digest, release, user_id, user_name, user_agent)
  VALUES
    (p_fingerprint, p_source, p_kind, p_message, p_stack, p_path, p_method, p_digest, p_release,
     -- A user who has since been deleted must not make the error itself fail.
     (SELECT u.id FROM public.users u WHERE u.id = p_user_id), p_user_name, p_user_agent)
  ON CONFLICT (fingerprint) DO UPDATE SET
    count       = LEAST(e.count::bigint + 1, 2147483647)::integer,
    last_seen   = now(),
    kind        = EXCLUDED.kind,
    message     = EXCLUDED.message,
    stack       = COALESCE(EXCLUDED.stack, e.stack),
    path        = COALESCE(EXCLUDED.path, e.path),
    method      = COALESCE(EXCLUDED.method, e.method),
    digest      = COALESCE(EXCLUDED.digest, e.digest),
    release     = COALESCE(EXCLUDED.release, e.release),
    user_id     = COALESCE(EXCLUDED.user_id, e.user_id),
    user_name   = COALESCE(EXCLUDED.user_name, e.user_name),
    user_agent  = COALESCE(EXCLUDED.user_agent, e.user_agent),
    resolved_at = NULL,
    resolved_by = NULL,
    -- Recurring after "Оправено" is news again; recurring while open is not.
    notified_at = CASE WHEN e.resolved_at IS NOT NULL THEN NULL ELSE e.notified_at END
  RETURNING e.notified_at IS NULL;
$$;

-- Взема грешките, за които още не е тръгнал имейл, и ги отбелязва като
-- казани, но най-много веднъж на p_min_interval: ако имейл е тръгнал по-скоро,
-- не връща нищо и те чакат следващия път. Две едновременни извиквания не могат
-- да вземат едни и същи грешки (заключване до края на транзакцията).
CREATE OR REPLACE FUNCTION public.claim_app_error_alert(p_min_interval interval DEFAULT interval '1 hour')
RETURNS SETOF public.app_errors
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('public.claim_app_error_alert'));
  IF EXISTS (SELECT 1 FROM public.app_errors WHERE notified_at > now() - p_min_interval) THEN
    RETURN;
  END IF;
  RETURN QUERY
    UPDATE public.app_errors SET notified_at = now()
     WHERE notified_at IS NULL AND resolved_at IS NULL
    RETURNING *;
END $$;

REVOKE ALL ON FUNCTION public.report_app_error(text, text, text, text, text, text, text, text, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_app_error(text, text, text, text, text, text, text, text, text, uuid, text, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.claim_app_error_alert(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_app_error_alert(interval) TO service_role;
