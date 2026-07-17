
CREATE TABLE public.telegram_config (
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

CREATE POLICY "Anyone authenticated can read telegram_config"
  ON public.telegram_config FOR SELECT TO authenticated USING (true);

CREATE POLICY "Anyone authenticated can update telegram_config"
  ON public.telegram_config FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Anyone authenticated can insert telegram_config"
  ON public.telegram_config FOR INSERT TO authenticated WITH CHECK (true);

CREATE TRIGGER update_telegram_config_updated_at
  BEFORE UPDATE ON public.telegram_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.telegram_config (id) VALUES (1) ON CONFLICT DO NOTHING;
