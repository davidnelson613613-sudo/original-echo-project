
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
