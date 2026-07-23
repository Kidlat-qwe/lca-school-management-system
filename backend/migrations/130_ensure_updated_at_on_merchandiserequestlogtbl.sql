-- Migration 130: Ensure merchandiserequestlogtbl.updated_at exists.
-- Production incident (PSMS-33): RHET FULFILLED webhook returned 500
--   column "updated_at" does not exist
-- Migration 051 defined updated_at, but some environments never received it.
-- Safe to re-run.

ALTER TABLE public.merchandiserequestlogtbl
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP;

COMMENT ON COLUMN public.merchandiserequestlogtbl.updated_at IS
  'Last local update time for this stock request row';

-- Backfill nulls if column already existed without default on old rows
UPDATE public.merchandiserequestlogtbl
SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
WHERE updated_at IS NULL;
