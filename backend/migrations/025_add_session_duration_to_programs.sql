BEGIN;

-- Add session_duration_per_day JSONB column to programstbl
-- Format: {"Monday": 3, "Tuesday": 2, "Wednesday": 3, ...} (duration in hours)
-- Allows different session durations per day of week
ALTER TABLE public.programstbl
ADD COLUMN IF NOT EXISTS session_duration_per_day jsonb;

-- Add comment to explain the column
COMMENT ON COLUMN public.programstbl.session_duration_per_day IS 'Session duration in hours per day of week. Format: {"Monday": 3, "Tuesday": 2, ...}. Used to auto-calculate session end times from start times.';

COMMIT;

