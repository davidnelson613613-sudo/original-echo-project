ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiet_hours_start_min smallint NOT NULL DEFAULT 1320, -- 22:00 UTC
  ADD COLUMN IF NOT EXISTS quiet_hours_end_min   smallint NOT NULL DEFAULT 780;  -- 13:00 UTC
