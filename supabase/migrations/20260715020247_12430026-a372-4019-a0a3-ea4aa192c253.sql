-- Momentum Rockets scanner (short-term small-cap momentum companion to Future Leaders).

CREATE TABLE public.momentum_rockets_snapshots (
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

CREATE POLICY "Authenticated users can read momentum rockets snapshots"
  ON public.momentum_rockets_snapshots FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX momentum_rockets_snapshots_scanned_at_idx
  ON public.momentum_rockets_snapshots (scanned_at DESC);


CREATE TABLE public.momentum_rockets_rankings (
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

CREATE POLICY "Authenticated users can read momentum rockets rankings"
  ON public.momentum_rockets_rankings FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX momentum_rockets_rankings_snapshot_rank_idx
  ON public.momentum_rockets_rankings (snapshot_id, rank);

CREATE INDEX momentum_rockets_rankings_symbol_idx
  ON public.momentum_rockets_rankings (symbol);