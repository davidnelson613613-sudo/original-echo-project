CREATE TABLE IF NOT EXISTS public.telegram_chats (
  chat_id BIGINT PRIMARY KEY,
  is_active BOOLEAN NOT NULL DEFAULT true,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.telegram_chats TO service_role;
ALTER TABLE public.telegram_chats ENABLE ROW LEVEL SECURITY;
-- No public policies: only service_role (server code) touches this table.

-- Backfill from the old singleton if it captured a chat previously.
INSERT INTO public.telegram_chats (chat_id, is_active)
SELECT chat_id::bigint, true FROM public.telegram_config
WHERE chat_id IS NOT NULL
ON CONFLICT (chat_id) DO NOTHING;