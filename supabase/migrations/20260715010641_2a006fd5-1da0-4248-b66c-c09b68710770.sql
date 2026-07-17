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

CREATE POLICY "No client access to bar cache"
  ON public.future_leaders_bar_cache FOR ALL
  USING (false) WITH CHECK (false);