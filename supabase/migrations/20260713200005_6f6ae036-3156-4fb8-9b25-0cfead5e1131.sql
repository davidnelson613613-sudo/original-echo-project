-- ── chat_conversations ─────────────────────────────
CREATE TABLE public.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'New conversation',
  source text NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'telegram')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_conversations_user ON public.chat_conversations (user_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_conversations TO authenticated;
GRANT ALL ON public.chat_conversations TO service_role;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own conversations" ON public.chat_conversations
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_chat_conversations_updated_at
  BEFORE UPDATE ON public.chat_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── chat_messages ─────────────────────────────
CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_conv ON public.chat_messages (conversation_id, created_at);
CREATE INDEX idx_chat_messages_user ON public.chat_messages (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own messages" ON public.chat_messages
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── telegram_links ─────────────────────────────
CREATE TABLE public.telegram_links (
  user_id uuid PRIMARY KEY,
  chat_id bigint NOT NULL UNIQUE,
  telegram_username text,
  linked_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, DELETE ON public.telegram_links TO authenticated;
GRANT ALL ON public.telegram_links TO service_role;
ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own telegram link" ON public.telegram_links
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own telegram link" ON public.telegram_links
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ── telegram_link_codes ─────────────────────────────
CREATE TABLE public.telegram_link_codes (
  code text PRIMARY KEY,
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_telegram_link_codes_user ON public.telegram_link_codes (user_id);

GRANT SELECT, INSERT, DELETE ON public.telegram_link_codes TO authenticated;
GRANT ALL ON public.telegram_link_codes TO service_role;
ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own link codes" ON public.telegram_link_codes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── scan_reports ─────────────────────────────
CREATE TABLE public.scan_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  symbol text,
  kind text NOT NULL,
  title text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_scan_reports_user ON public.scan_reports (user_id, created_at DESC);
CREATE INDEX idx_scan_reports_kind ON public.scan_reports (user_id, kind, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_reports TO authenticated;
GRANT ALL ON public.scan_reports TO service_role;
ALTER TABLE public.scan_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own scan reports" ON public.scan_reports
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);