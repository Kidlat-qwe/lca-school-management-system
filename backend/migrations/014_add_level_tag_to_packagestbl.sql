BEGIN;

-- Add level_tag column to packagestbl
ALTER TABLE public.packagestbl
ADD COLUMN IF NOT EXISTS level_tag character varying(100) COLLATE pg_catalog."default";

COMMIT;

