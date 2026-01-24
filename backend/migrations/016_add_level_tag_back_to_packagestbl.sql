BEGIN;

-- Re-add level_tag column to packagestbl (was manually deleted)
-- This column is needed to store the selected level tag when creating packages
ALTER TABLE public.packagestbl
ADD COLUMN IF NOT EXISTS level_tag character varying(100) COLLATE pg_catalog."default";

COMMIT;

