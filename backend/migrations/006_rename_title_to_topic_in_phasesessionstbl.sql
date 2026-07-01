BEGIN;

-- Rename title column to topic in phasesessionstbl
ALTER TABLE public.phasesessionstbl
RENAME COLUMN title TO topic;

COMMIT;

