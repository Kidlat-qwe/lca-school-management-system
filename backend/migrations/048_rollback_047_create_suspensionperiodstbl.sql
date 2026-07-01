-- Rollback Migration: Remove suspensionperiodstbl and related changes
-- This reverses migration 047_create_suspensionperiodstbl.sql

BEGIN;

-- Drop foreign key constraint on classsessionstbl.suspension_id
ALTER TABLE public.classsessionstbl
DROP CONSTRAINT IF EXISTS classsessionstbl_suspension_id_fkey;

-- Drop suspension_id column from classsessionstbl
ALTER TABLE public.classsessionstbl
DROP COLUMN IF EXISTS suspension_id;

-- Drop indexes created for suspensionperiodstbl
DROP INDEX IF EXISTS public.idx_classsessions_suspension_id;
DROP INDEX IF EXISTS public.idx_suspensionperiods_status;
DROP INDEX IF EXISTS public.idx_suspensionperiods_dates;
DROP INDEX IF EXISTS public.idx_suspensionperiods_class_id;
DROP INDEX IF EXISTS public.idx_suspensionperiods_branch_id;

-- Drop the suspensionperiodstbl table
-- This will also automatically drop all constraints, indexes, and related objects
DROP TABLE IF EXISTS public.suspensionperiodstbl;

COMMIT;

