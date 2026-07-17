CREATE TABLE public.systemic_risk_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  as_of date NOT NULL UNIQUE,
  early_warning_score numeric NOT NULL,
  regime text NOT NULL,
  probabilities jsonb NOT NULL,
  indicators jsonb NOT NULL,
  top_analogs jsonb NOT NULL,
  drivers jsonb NOT NULL,
  disagreements jsonb NOT NULL,
  data_coverage jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.systemic_risk_snapshots TO anon, authenticated;
GRANT ALL  ON public.systemic_risk_snapshots TO service_role;
ALTER TABLE public.systemic_risk_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "systemic_risk_snapshots_read" ON public.systemic_risk_snapshots FOR SELECT USING (true);
CREATE TRIGGER trg_systemic_risk_snapshots_updated
  BEFORE UPDATE ON public.systemic_risk_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX systemic_risk_snapshots_as_of_idx ON public.systemic_risk_snapshots (as_of DESC);

CREATE TABLE public.systemic_risk_backtest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_label text NOT NULL,
  summary jsonb NOT NULL,
  per_event jsonb NOT NULL,
  timeline jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.systemic_risk_backtest_runs TO anon, authenticated;
GRANT ALL  ON public.systemic_risk_backtest_runs TO service_role;
ALTER TABLE public.systemic_risk_backtest_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "systemic_risk_backtest_read" ON public.systemic_risk_backtest_runs FOR SELECT USING (true);
CREATE INDEX systemic_risk_backtest_created_idx ON public.systemic_risk_backtest_runs (created_at DESC);