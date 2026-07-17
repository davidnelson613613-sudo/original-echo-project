
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS new_picks_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS future_leaders_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS price_level_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS digests_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS system_alerts_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS digest_min_gap_minutes integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS min_pick_score integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS last_digest_at timestamptz;

CREATE TABLE IF NOT EXISTS public.system_alert_deliveries (
  event_key text PRIMARY KEY,
  level text NOT NULL,
  event text NOT NULL,
  details text,
  sent_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.system_alert_deliveries TO authenticated;
GRANT ALL ON public.system_alert_deliveries TO service_role;
ALTER TABLE public.system_alert_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view system alert deliveries"
  ON public.system_alert_deliveries FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS system_alert_deliveries_sent_at_idx
  ON public.system_alert_deliveries (sent_at DESC);
