BEGIN;

-- Change session_duration_per_day (JSONB per-day) to session_duration_hours (single fixed duration)
-- First, add the new column
ALTER TABLE public.programstbl
ADD COLUMN IF NOT EXISTS session_duration_hours numeric(4,2);

-- Migrate existing data: if session_duration_per_day exists, extract first non-null value
-- or use a default value (e.g., 3 hours) if all values are null
UPDATE public.programstbl
SET session_duration_hours = COALESCE(
  (SELECT value::numeric 
   FROM jsonb_each_text(session_duration_per_day) 
   WHERE value IS NOT NULL 
   LIMIT 1),
  3.0
)
WHERE session_duration_per_day IS NOT NULL 
  AND session_duration_hours IS NULL;

-- Drop the old column
ALTER TABLE public.programstbl
DROP COLUMN IF EXISTS session_duration_per_day;

-- Add comment to explain the column
COMMENT ON COLUMN public.programstbl.session_duration_hours IS 'Fixed session duration in hours for all sessions in this program. Used to auto-calculate session end times from start times.';

COMMIT;

