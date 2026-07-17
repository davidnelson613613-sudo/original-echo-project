
CREATE TABLE IF NOT EXISTS public.market_scan_snapshots (
  id text PRIMARY KEY,
  scanned_at timestamptz NOT NULL,
  rows_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  spy_change_pct numeric,
  warning text,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.market_scan_snapshots TO authenticated;
GRANT SELECT ON public.market_scan_snapshots TO anon;
GRANT ALL    ON public.market_scan_snapshots TO service_role;

ALTER TABLE public.market_scan_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read latest snapshot" ON public.market_scan_snapshots;
CREATE POLICY "Anyone can read latest snapshot"
  ON public.market_scan_snapshots
  FOR SELECT
  USING (true);

DROP TRIGGER IF EXISTS market_scan_snapshots_updated_at ON public.market_scan_snapshots;
CREATE TRIGGER market_scan_snapshots_updated_at
  BEFORE UPDATE ON public.market_scan_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
