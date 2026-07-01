-- Learner Reference Number (DepEd Philippines); optional per student
ALTER TABLE IF EXISTS public.userstbl
    ADD COLUMN IF NOT EXISTS lrn character varying(50) COLLATE pg_catalog."default";

COMMENT ON COLUMN public.userstbl.lrn IS 'Learner Reference Number (optional).';
