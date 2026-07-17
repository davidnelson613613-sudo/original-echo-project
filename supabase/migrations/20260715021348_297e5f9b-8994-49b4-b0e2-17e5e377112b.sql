ALTER TABLE public.future_leaders_snapshots
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS processed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS succeeded_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_message text;

UPDATE public.future_leaders_snapshots
SET status = 'completed',
    processed_count = universe_size,
    succeeded_count = COALESCE((
      SELECT count(*)::integer
      FROM public.future_leaders_rankings r
      WHERE r.snapshot_id = future_leaders_snapshots.id
    ), 0)
WHERE status = 'completed';

ALTER TABLE public.future_leaders_snapshots
  ADD CONSTRAINT future_leaders_snapshots_status_check
  CHECK (status IN ('running', 'completed', 'failed'));

CREATE INDEX IF NOT EXISTS idx_fl_snapshots_status_scanned_at
  ON public.future_leaders_snapshots (status, scanned_at DESC);