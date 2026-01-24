BEGIN;

-- Remove class_code from classestbl (if it was added)
ALTER TABLE public.classestbl
DROP COLUMN IF EXISTS class_code;

-- Drop the index if it exists
DROP INDEX IF EXISTS idx_class_code;
DROP INDEX IF EXISTS idx_class_codeA;

-- Add class_code column to classsessionstbl instead
ALTER TABLE public.classsessionstbl
ADD COLUMN IF NOT EXISTS class_code character varying(100) COLLATE pg_catalog."default";

-- Add index for faster lookups on sessions
CREATE INDEX IF NOT EXISTS idx_session_class_code
    ON public.classsessionstbl(class_code);

COMMENT ON COLUMN public.classsessionstbl.class_code
    IS 'Auto-generated unique class code per session in format: {program_code}_{MMDDYY}_{HHMM}{AM/PM}_{ClassName}. Example: pk_121525_1000AM_Bees for Session 1, pk_121625_0800AM_Bees for Session 2, etc.';

COMMIT;

