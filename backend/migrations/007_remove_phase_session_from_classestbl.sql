BEGIN;

-- Remove phase_number and session_number columns from classestbl
-- These are now accessed through the program_id -> curriculum_id -> phasesessionstbl relationship

-- Drop the columns if they exist
ALTER TABLE IF EXISTS public.classestbl
DROP COLUMN IF EXISTS phase_number;

ALTER TABLE IF EXISTS public.classestbl
DROP COLUMN IF EXISTS session_number;

COMMIT;

