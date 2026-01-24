BEGIN;

-- Remove max_students column from programstbl
ALTER TABLE public.programstbl
DROP COLUMN IF EXISTS max_students;

COMMIT;

