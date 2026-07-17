
-- Phase 2: normalized feature store
CREATE TABLE public.market_features (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL,
  feature_key TEXT NOT NULL,
  value DOUBLE PRECISION,
  zscore DOUBLE PRECISION,
  percentile DOUBLE PRECISION,
  block TEXT NOT NULL,
  confidence_tier TEXT NOT NULL DEFAULT 'high',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (date, feature_key)
);
CREATE INDEX idx_market_features_key_date ON public.market_features (feature_key, date DESC);
CREATE INDEX idx_market_features_date ON public.market_features (date DESC);

GRANT SELECT ON public.market_features TO authenticated;
GRANT SELECT ON public.market_features TO anon;
GRANT ALL ON public.market_features TO service_role;

ALTER TABLE public.market_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read market_features" ON public.market_features FOR SELECT USING (true);

-- Phase 3: composite score snapshots (new pipeline; keeps legacy systemic_risk_snapshots intact)
CREATE TABLE public.systemic_risk_v2_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  as_of DATE NOT NULL UNIQUE,
  composite_score DOUBLE PRECISION NOT NULL,
  regime_label TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  model_contributions JSONB NOT NULL DEFAULT '{}'::jsonb,
  top_contributors JSONB NOT NULL DEFAULT '[]'::jsonb,
  analog_matches JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  feature_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  computation_ms INTEGER
);
CREATE INDEX idx_srv2_snapshots_as_of ON public.systemic_risk_v2_snapshots (as_of DESC);

GRANT SELECT ON public.systemic_risk_v2_snapshots TO authenticated;
GRANT SELECT ON public.systemic_risk_v2_snapshots TO anon;
GRANT ALL ON public.systemic_risk_v2_snapshots TO service_role;

ALTER TABLE public.systemic_risk_v2_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read systemic_risk_v2_snapshots" ON public.systemic_risk_v2_snapshots FOR SELECT USING (true);

-- Phase 5: validation runs
CREATE TABLE public.systemic_risk_v2_backtests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scope_start DATE NOT NULL,
  scope_end DATE NOT NULL,
  metrics JSONB NOT NULL,
  lead_time_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  reliability_bins JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT
);
CREATE INDEX idx_srv2_backtests_time ON public.systemic_risk_v2_backtests (ran_at DESC);

GRANT SELECT ON public.systemic_risk_v2_backtests TO authenticated;
GRANT ALL ON public.systemic_risk_v2_backtests TO service_role;

ALTER TABLE public.systemic_risk_v2_backtests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read srv2_backtests" ON public.systemic_risk_v2_backtests FOR SELECT TO authenticated USING (true);
