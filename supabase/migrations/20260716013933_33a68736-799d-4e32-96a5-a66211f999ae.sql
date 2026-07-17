-- Restore all base tables from prior schema.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, email text, display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own profile" ON public.profiles FOR ALL TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, symbol text NOT NULL,
  total_capital numeric NOT NULL, scenario text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  entries jsonb NOT NULL DEFAULT '[]'::jsonb,
  planned_ladder jsonb, UNIQUE (user_id, symbol)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.positions TO authenticated;
GRANT ALL ON public.positions TO service_role;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own positions" ON public.positions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX positions_user_symbol_idx ON public.positions (user_id, symbol);
CREATE TRIGGER update_positions_updated_at BEFORE UPDATE ON public.positions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.position_settings (
  user_id uuid PRIMARY KEY,
  auto_fill boolean NOT NULL DEFAULT false,
  recovery_capture boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.position_settings TO authenticated;
GRANT ALL ON public.position_settings TO service_role;
ALTER TABLE public.position_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own position settings" ON public.position_settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_position_settings_updated_at BEFORE UPDATE ON public.position_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY,
  email_enabled boolean NOT NULL DEFAULT false, email_address text,
  phone_enabled boolean NOT NULL DEFAULT false, phone_number text,
  approaching_buy_enabled boolean NOT NULL DEFAULT true,
  at_buy_zone_enabled boolean NOT NULL DEFAULT true,
  approach_threshold_pct numeric NOT NULL DEFAULT 1.5,
  at_threshold_pct numeric NOT NULL DEFAULT 0.4,
  quiet_minutes integer NOT NULL DEFAULT 240,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own notification preferences" ON public.notification_preferences FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_notification_preferences_updated_at BEFORE UPDATE ON public.notification_preferences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.alert_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, symbol text NOT NULL,
  alert_key text NOT NULL, alert_kind text NOT NULL,
  target_price numeric NOT NULL, live_price numeric NOT NULL,
  distance_pct numeric NOT NULL, message text NOT NULL,
  email_status text NOT NULL DEFAULT 'not_configured',
  phone_status text NOT NULL DEFAULT 'not_configured',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, alert_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alert_deliveries TO authenticated;
GRANT ALL ON public.alert_deliveries TO service_role;
ALTER TABLE public.alert_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own alert deliveries" ON public.alert_deliveries FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX alert_deliveries_user_created_idx ON public.alert_deliveries (user_id, created_at DESC);

CREATE TABLE public.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, title text NOT NULL DEFAULT 'New conversation',
  source text NOT NULL DEFAULT 'web' CHECK (source IN ('web','telegram')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_conversations_user ON public.chat_conversations (user_id, updated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_conversations TO authenticated;
GRANT ALL ON public.chat_conversations TO service_role;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own conversations" ON public.chat_conversations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_chat_conversations_updated_at BEFORE UPDATE ON public.chat_conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_conv ON public.chat_messages (conversation_id, created_at);
CREATE INDEX idx_chat_messages_user ON public.chat_messages (user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own messages" ON public.chat_messages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.telegram_links (
  user_id uuid PRIMARY KEY, chat_id bigint NOT NULL UNIQUE,
  telegram_username text, linked_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_links TO authenticated;
GRANT ALL ON public.telegram_links TO service_role;
ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own telegram link" ON public.telegram_links FOR SELECT TO authenticated USING (auth.uid() = user_id AND (auth.jwt() ->> 'is_anonymous')::boolean IS NOT TRUE);
CREATE POLICY "Users insert own telegram link" ON public.telegram_links FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND (auth.jwt() ->> 'is_anonymous')::boolean IS NOT TRUE);
CREATE POLICY "Users update own telegram link" ON public.telegram_links FOR UPDATE TO authenticated USING (auth.uid() = user_id AND (auth.jwt() ->> 'is_anonymous')::boolean IS NOT TRUE) WITH CHECK (auth.uid() = user_id AND (auth.jwt() ->> 'is_anonymous')::boolean IS NOT TRUE);
CREATE POLICY "Users delete own telegram link" ON public.telegram_links FOR DELETE TO authenticated USING (auth.uid() = user_id AND (auth.jwt() ->> 'is_anonymous')::boolean IS NOT TRUE);

CREATE TABLE public.telegram_link_codes (
  code text PRIMARY KEY, user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_telegram_link_codes_user ON public.telegram_link_codes (user_id);
GRANT SELECT, INSERT, DELETE ON public.telegram_link_codes TO authenticated;
GRANT ALL ON public.telegram_link_codes TO service_role;
ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own link codes" ON public.telegram_link_codes FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.scan_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, symbol text, kind text NOT NULL,
  title text, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_scan_reports_user ON public.scan_reports (user_id, created_at DESC);
CREATE INDEX idx_scan_reports_kind ON public.scan_reports (user_id, kind, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_reports TO authenticated;
GRANT ALL ON public.scan_reports TO service_role;
ALTER TABLE public.scan_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own scan reports" ON public.scan_reports FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.market_scan_snapshots (
  id text PRIMARY KEY, scanned_at timestamptz NOT NULL,
  rows_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  spy_change_pct numeric, warning text, payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.market_scan_snapshots TO authenticated;
GRANT ALL ON public.market_scan_snapshots TO service_role;
ALTER TABLE public.market_scan_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users read snapshots" ON public.market_scan_snapshots FOR SELECT TO authenticated USING (true);
CREATE TRIGGER market_scan_snapshots_updated_at BEFORE UPDATE ON public.market_scan_snapshots FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.future_leaders_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scanned_at timestamptz NOT NULL DEFAULT now(),
  universe_size integer NOT NULL,
  eligible_size integer NOT NULL,
  failed_symbols jsonb NOT NULL DEFAULT '[]'::jsonb,
  spy_change_pct numeric,
  regime text,
  weights jsonb NOT NULL,
  duration_ms integer,
  triggered_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'completed',
  processed_count integer NOT NULL DEFAULT 0,
  succeeded_count integer NOT NULL DEFAULT 0,
  error_message text,
  CONSTRAINT future_leaders_snapshots_status_check CHECK (status IN ('running','completed','failed'))
);
GRANT SELECT ON public.future_leaders_snapshots TO authenticated;
GRANT ALL ON public.future_leaders_snapshots TO service_role;
ALTER TABLE public.future_leaders_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read future leaders snapshots" ON public.future_leaders_snapshots FOR SELECT TO authenticated USING (true);
CREATE INDEX idx_fl_snapshots_scanned_at ON public.future_leaders_snapshots (scanned_at DESC);
CREATE INDEX idx_fl_snapshots_status_scanned_at ON public.future_leaders_snapshots (status, scanned_at DESC);

CREATE TABLE public.future_leaders_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES public.future_leaders_snapshots(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  rank integer NOT NULL,
  composite_score numeric NOT NULL,
  confidence numeric NOT NULL,
  component_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_thesis jsonb,
  deep_report jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.future_leaders_rankings TO authenticated;
GRANT ALL ON public.future_leaders_rankings TO service_role;
ALTER TABLE public.future_leaders_rankings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read future leaders rankings" ON public.future_leaders_rankings FOR SELECT TO authenticated USING (true);
CREATE INDEX idx_fl_rankings_snap_rank ON public.future_leaders_rankings (snapshot_id, rank);
CREATE INDEX idx_fl_rankings_symbol_time ON public.future_leaders_rankings (symbol, created_at DESC);
CREATE INDEX idx_future_leaders_rankings_snap_symbol ON public.future_leaders_rankings(snapshot_id, symbol);

CREATE TABLE public.future_leaders_bar_cache (
  symbol text PRIMARY KEY,
  as_of date NOT NULL,
  bars jsonb NOT NULL,
  bar_count integer NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_flbc_fetched_at ON public.future_leaders_bar_cache(fetched_at DESC);
GRANT ALL ON public.future_leaders_bar_cache TO service_role;
ALTER TABLE public.future_leaders_bar_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No client access to bar cache" ON public.future_leaders_bar_cache FOR ALL USING (false) WITH CHECK (false);

CREATE TABLE public.momentum_rockets_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  universe_size INTEGER NOT NULL,
  eligible_size INTEGER NOT NULL DEFAULT 0,
  failed_symbols JSONB NOT NULL DEFAULT '[]'::jsonb,
  spy_change_pct NUMERIC,
  regime TEXT,
  weights JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration_ms INTEGER,
  triggered_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.momentum_rockets_snapshots TO authenticated;
GRANT ALL ON public.momentum_rockets_snapshots TO service_role;
ALTER TABLE public.momentum_rockets_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read momentum rockets snapshots" ON public.momentum_rockets_snapshots FOR SELECT TO authenticated USING (true);
CREATE INDEX momentum_rockets_snapshots_scanned_at_idx ON public.momentum_rockets_snapshots (scanned_at DESC);

CREATE TABLE public.momentum_rockets_rankings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_id UUID NOT NULL REFERENCES public.momentum_rockets_snapshots(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  rank INTEGER NOT NULL,
  composite_score NUMERIC NOT NULL,
  confidence NUMERIC NOT NULL,
  component_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_thesis JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.momentum_rockets_rankings TO authenticated;
GRANT ALL ON public.momentum_rockets_rankings TO service_role;
ALTER TABLE public.momentum_rockets_rankings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read momentum rockets rankings" ON public.momentum_rockets_rankings FOR SELECT TO authenticated USING (true);
CREATE INDEX momentum_rockets_rankings_snapshot_rank_idx ON public.momentum_rockets_rankings (snapshot_id, rank);
CREATE INDEX momentum_rockets_rankings_symbol_idx ON public.momentum_rockets_rankings (symbol);

CREATE TABLE public.edgar_facts_cache (
  symbol text PRIMARY KEY, cik text, facts jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.edgar_facts_cache TO service_role;
ALTER TABLE public.edgar_facts_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_edgar" ON public.edgar_facts_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.yahoo_summary_cache (
  symbol text PRIMARY KEY, summary jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.yahoo_summary_cache TO service_role;
ALTER TABLE public.yahoo_summary_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_yahoo" ON public.yahoo_summary_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.finnhub_data_cache (
  symbol text NOT NULL, kind text NOT NULL, payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, kind)
);
GRANT ALL ON public.finnhub_data_cache TO service_role;
ALTER TABLE public.finnhub_data_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_finnhub" ON public.finnhub_data_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.analog_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  results jsonb NOT NULL,
  baseline_diff jsonb
);
GRANT SELECT ON public.analog_benchmarks TO authenticated;
GRANT ALL ON public.analog_benchmarks TO service_role;
ALTER TABLE public.analog_benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_benchmarks" ON public.analog_benchmarks FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_role_write_benchmarks" ON public.analog_benchmarks FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.analog_validation_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ran_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  universe TEXT[] NOT NULL,
  symbol_count INT NOT NULL,
  test_dates_per_symbol INT NOT NULL,
  total_predictions INT NOT NULL,
  metrics JSONB NOT NULL,
  per_symbol JSONB NOT NULL,
  config JSONB,
  notes TEXT
);
GRANT SELECT ON public.analog_validation_runs TO authenticated;
GRANT ALL ON public.analog_validation_runs TO service_role;
ALTER TABLE public.analog_validation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_validation_runs" ON public.analog_validation_runs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_role_write_validation_runs" ON public.analog_validation_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX analog_validation_runs_ran_at_idx ON public.analog_validation_runs (ran_at DESC);