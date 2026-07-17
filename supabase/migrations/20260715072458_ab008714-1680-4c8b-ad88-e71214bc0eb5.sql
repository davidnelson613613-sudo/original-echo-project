
CREATE TABLE public.edgar_facts_cache (
  symbol text PRIMARY KEY,
  cik text,
  facts jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.edgar_facts_cache TO service_role;
ALTER TABLE public.edgar_facts_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_edgar" ON public.edgar_facts_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.yahoo_summary_cache (
  symbol text PRIMARY KEY,
  summary jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.yahoo_summary_cache TO service_role;
ALTER TABLE public.yahoo_summary_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_yahoo" ON public.yahoo_summary_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.finnhub_data_cache (
  symbol text NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL,
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
