CREATE TABLE IF NOT EXISTS public.analog_validation_runs (
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
DROP POLICY IF EXISTS "auth_read_validation_runs" ON public.analog_validation_runs;
CREATE POLICY "auth_read_validation_runs" ON public.analog_validation_runs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "service_role_write_validation_runs" ON public.analog_validation_runs;
CREATE POLICY "service_role_write_validation_runs" ON public.analog_validation_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS analog_validation_runs_ran_at_idx ON public.analog_validation_runs (ran_at DESC);

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS new_picks_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS future_leaders_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS price_level_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS digests_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS system_alerts_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS digest_min_gap_minutes integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS min_pick_score integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS last_digest_at timestamptz,
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiet_hours_start_min smallint NOT NULL DEFAULT 1320,
  ADD COLUMN IF NOT EXISTS quiet_hours_end_min smallint NOT NULL DEFAULT 780;

CREATE TABLE IF NOT EXISTS public.system_alert_deliveries (
  event_key text PRIMARY KEY,
  level text NOT NULL,
  event text NOT NULL,
  details text,
  sent_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.system_alert_deliveries TO service_role;
ALTER TABLE public.system_alert_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can view system alert deliveries" ON public.system_alert_deliveries;
DROP POLICY IF EXISTS "No direct access to system alert deliveries" ON public.system_alert_deliveries;
CREATE POLICY "No direct access to system alert deliveries" ON public.system_alert_deliveries FOR SELECT TO authenticated USING (false);
CREATE INDEX IF NOT EXISTS system_alert_deliveries_sent_at_idx ON public.system_alert_deliveries (sent_at DESC);

DROP POLICY IF EXISTS "Users manage own link codes" ON public.telegram_link_codes;
DROP POLICY IF EXISTS "Users select own link codes" ON public.telegram_link_codes;
CREATE POLICY "Users select own link codes" ON public.telegram_link_codes FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users insert own link codes" ON public.telegram_link_codes;
CREATE POLICY "Users insert own link codes" ON public.telegram_link_codes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users update own link codes" ON public.telegram_link_codes;
CREATE POLICY "Users update own link codes" ON public.telegram_link_codes FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users delete own link codes" ON public.telegram_link_codes;
CREATE POLICY "Users delete own link codes" ON public.telegram_link_codes FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.telegram_config (
  id integer PRIMARY KEY CHECK (id = 1),
  chat_id bigint,
  owner_user_id uuid,
  new_picks_enabled boolean NOT NULL DEFAULT true,
  future_leaders_enabled boolean NOT NULL DEFAULT true,
  price_level_enabled boolean NOT NULL DEFAULT true,
  digests_enabled boolean NOT NULL DEFAULT false,
  system_alerts_enabled boolean NOT NULL DEFAULT true,
  min_pick_score integer NOT NULL DEFAULT 60,
  digest_min_gap_minutes integer NOT NULL DEFAULT 15,
  quiet_hours_enabled boolean NOT NULL DEFAULT false,
  quiet_hours_start_min integer NOT NULL DEFAULT 1320,
  quiet_hours_end_min integer NOT NULL DEFAULT 780,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.telegram_config TO authenticated;
GRANT ALL ON public.telegram_config TO service_role;
ALTER TABLE public.telegram_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone authenticated can read telegram_config" ON public.telegram_config;
CREATE POLICY "Anyone authenticated can read telegram_config" ON public.telegram_config FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Anyone authenticated can update telegram_config" ON public.telegram_config;
CREATE POLICY "Anyone authenticated can update telegram_config" ON public.telegram_config FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Anyone authenticated can insert telegram_config" ON public.telegram_config;
CREATE POLICY "Anyone authenticated can insert telegram_config" ON public.telegram_config FOR INSERT TO authenticated WITH CHECK (true);
DROP TRIGGER IF EXISTS update_telegram_config_updated_at ON public.telegram_config;
CREATE TRIGGER update_telegram_config_updated_at BEFORE UPDATE ON public.telegram_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
INSERT INTO public.telegram_config (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.telegram_chats (
  chat_id BIGINT PRIMARY KEY,
  is_active BOOLEAN NOT NULL DEFAULT true,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.telegram_chats TO service_role;
ALTER TABLE public.telegram_chats ENABLE ROW LEVEL SECURITY;

INSERT INTO public.telegram_chats (chat_id, is_active)
SELECT chat_id::bigint, true FROM public.telegram_config WHERE chat_id IS NOT NULL
ON CONFLICT (chat_id) DO NOTHING;