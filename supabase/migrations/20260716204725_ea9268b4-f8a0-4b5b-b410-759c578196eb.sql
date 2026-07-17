CREATE INDEX IF NOT EXISTS alert_deliveries_user_created_idx ON public.alert_deliveries (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.market_scan_snapshots (
  id text PRIMARY KEY, scanned_at timestamptz NOT NULL,
  rows_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  spy_change_pct numeric, warning text, payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.market_scan_snapshots TO authenticated;
GRANT ALL ON public.market_scan_snapshots TO service_role;
ALTER TABLE public.market_scan_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users read snapshots" ON public.market_scan_snapshots;
CREATE POLICY "Authenticated users read snapshots" ON public.market_scan_snapshots FOR SELECT TO authenticated USING (true);
DROP TRIGGER IF EXISTS market_scan_snapshots_updated_at ON public.market_scan_snapshots;
CREATE TRIGGER market_scan_snapshots_updated_at BEFORE UPDATE ON public.market_scan_snapshots FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.future_leaders_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scanned_at timestamptz NOT NULL DEFAULT now(),
  universe_size integer NOT NULL,
  eligible_size integer NOT NULL DEFAULT 0,
  failed_symbols jsonb NOT NULL DEFAULT '[]'::jsonb,
  spy_change_pct numeric,
  regime text,
  weights jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_ms integer,
  triggered_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'completed',
  processed_count integer NOT NULL DEFAULT 0,
  succeeded_count integer NOT NULL DEFAULT 0,
  error_message text
);
ALTER TABLE public.future_leaders_snapshots
  ADD COLUMN IF NOT EXISTS eligible_size integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS processed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS succeeded_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_message text;
DO $wrap$ BEGIN
  ALTER TABLE public.future_leaders_snapshots
    ADD CONSTRAINT future_leaders_snapshots_status_check
    CHECK (status IN ('running','completed','failed'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $wrap$;
GRANT SELECT ON public.future_leaders_snapshots TO authenticated;
GRANT ALL ON public.future_leaders_snapshots TO service_role;
ALTER TABLE public.future_leaders_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read leader snapshots" ON public.future_leaders_snapshots;
CREATE POLICY "Authenticated read leader snapshots" ON public.future_leaders_snapshots FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated read future leaders snapshots" ON public.future_leaders_snapshots;
CREATE POLICY "Authenticated read future leaders snapshots" ON public.future_leaders_snapshots FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_fl_snapshots_scanned_at ON public.future_leaders_snapshots (scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_fl_snapshots_status_scanned_at ON public.future_leaders_snapshots (status, scanned_at DESC);

CREATE TABLE IF NOT EXISTS public.future_leaders_rankings (
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
ALTER TABLE public.future_leaders_rankings ADD COLUMN IF NOT EXISTS deep_report jsonb;
GRANT SELECT ON public.future_leaders_rankings TO authenticated;
GRANT ALL ON public.future_leaders_rankings TO service_role;
ALTER TABLE public.future_leaders_rankings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read leader rankings" ON public.future_leaders_rankings;
CREATE POLICY "Authenticated read leader rankings" ON public.future_leaders_rankings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated read future leaders rankings" ON public.future_leaders_rankings;
CREATE POLICY "Authenticated read future leaders rankings" ON public.future_leaders_rankings FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_fl_rankings_snap_rank ON public.future_leaders_rankings (snapshot_id, rank);
CREATE INDEX IF NOT EXISTS idx_fl_rankings_symbol_time ON public.future_leaders_rankings (symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_future_leaders_rankings_snap_symbol ON public.future_leaders_rankings(snapshot_id, symbol);

CREATE TABLE IF NOT EXISTS public.future_leaders_bar_cache (
  symbol text PRIMARY KEY,
  as_of date NOT NULL,
  bars jsonb NOT NULL,
  bar_count integer NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_flbc_fetched_at ON public.future_leaders_bar_cache(fetched_at DESC);
GRANT ALL ON public.future_leaders_bar_cache TO service_role;
ALTER TABLE public.future_leaders_bar_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "No client access to bar cache" ON public.future_leaders_bar_cache;
CREATE POLICY "No client access to bar cache" ON public.future_leaders_bar_cache FOR ALL USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.momentum_rockets_snapshots (
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
DROP POLICY IF EXISTS "Authenticated users can read momentum rockets snapshots" ON public.momentum_rockets_snapshots;
CREATE POLICY "Authenticated users can read momentum rockets snapshots" ON public.momentum_rockets_snapshots FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS momentum_rockets_snapshots_scanned_at_idx ON public.momentum_rockets_snapshots (scanned_at DESC);

CREATE TABLE IF NOT EXISTS public.momentum_rockets_rankings (
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
DROP POLICY IF EXISTS "Authenticated users can read momentum rockets rankings" ON public.momentum_rockets_rankings;
CREATE POLICY "Authenticated users can read momentum rockets rankings" ON public.momentum_rockets_rankings FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS momentum_rockets_rankings_snapshot_rank_idx ON public.momentum_rockets_rankings (snapshot_id, rank);
CREATE INDEX IF NOT EXISTS momentum_rockets_rankings_symbol_idx ON public.momentum_rockets_rankings (symbol);

CREATE TABLE IF NOT EXISTS public.edgar_facts_cache (
  symbol text PRIMARY KEY,
  cik text,
  facts jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.edgar_facts_cache TO service_role;
ALTER TABLE public.edgar_facts_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_only_edgar" ON public.edgar_facts_cache;
CREATE POLICY "service_role_only_edgar" ON public.edgar_facts_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.yahoo_summary_cache (
  symbol text PRIMARY KEY,
  summary jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.yahoo_summary_cache TO service_role;
ALTER TABLE public.yahoo_summary_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_only_yahoo" ON public.yahoo_summary_cache;
CREATE POLICY "service_role_only_yahoo" ON public.yahoo_summary_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.finnhub_data_cache (
  symbol text NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, kind)
);
GRANT ALL ON public.finnhub_data_cache TO service_role;
ALTER TABLE public.finnhub_data_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_only_finnhub" ON public.finnhub_data_cache;
CREATE POLICY "service_role_only_finnhub" ON public.finnhub_data_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.analog_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  results jsonb NOT NULL,
  baseline_diff jsonb
);
GRANT SELECT ON public.analog_benchmarks TO authenticated;
GRANT ALL ON public.analog_benchmarks TO service_role;
ALTER TABLE public.analog_benchmarks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_benchmarks" ON public.analog_benchmarks;
CREATE POLICY "auth_read_benchmarks" ON public.analog_benchmarks FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "service_role_write_benchmarks" ON public.analog_benchmarks;
CREATE POLICY "service_role_write_benchmarks" ON public.analog_benchmarks FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Add extra telegram_links write policies from later migration
DROP POLICY IF EXISTS "Users insert own telegram link" ON public.telegram_links;
CREATE POLICY "Users insert own telegram link" ON public.telegram_links FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND (auth.jwt() ->> 'is_anonymous')::boolean IS NOT TRUE);
DROP POLICY IF EXISTS "Users update own telegram link" ON public.telegram_links;
CREATE POLICY "Users update own telegram link" ON public.telegram_links FOR UPDATE TO authenticated USING (auth.uid() = user_id AND (auth.jwt() ->> 'is_anonymous')::boolean IS NOT TRUE) WITH CHECK (auth.uid() = user_id AND (auth.jwt() ->> 'is_anonymous')::boolean IS NOT TRUE);
GRANT INSERT, UPDATE ON public.telegram_links TO authenticated;