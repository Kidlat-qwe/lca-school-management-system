BEGIN;

-- Fix for incorrectly completed sessions
-- This resets sessions that are marked as 'Completed' but have NO attendance records
-- back to 'Scheduled' status

UPDATE public.classsessionstbl cs
SET status = 'Scheduled',
    updated_at = CURRENT_TIMESTAMP
WHERE cs.status = 'Completed'
  AND NOT EXISTS (
    SELECT 1
    FROM public.attendancetbl a
    WHERE a.classsession_id = cs.classsession_id
  );

-- Log the fix
DO $$
DECLARE
  affected_count INTEGER;
BEGIN
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE 'Reset % sessions from Completed to Scheduled (sessions without attendance records)', affected_count;
END $$;

COMMIT;

