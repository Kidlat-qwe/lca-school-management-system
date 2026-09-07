-- Migration 148: Package inclusion flag + manual stock deduct audit
-- Types marked not included in package must be reduced via manual deduct + remarks.

BEGIN;

ALTER TABLE public.merchandisestbl
  ADD COLUMN IF NOT EXISTS is_package_included BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.merchandisestbl.is_package_included IS
  'When false, type cannot be added to packages / enroll auto-issue; stock is reduced only via manual deduct with required remarks.';

-- Allow manual_deduct release source + optional remarks for reason text
ALTER TABLE public.merchandise_release_logtbl
  DROP CONSTRAINT IF EXISTS merchandise_release_logtbl_source_check;

ALTER TABLE public.merchandise_release_logtbl
  ADD CONSTRAINT merchandise_release_logtbl_source_check
  CHECK (source IN ('merchandise_ar', 'package_enroll', 'manual_deduct'));

ALTER TABLE public.merchandise_release_logtbl
  ADD COLUMN IF NOT EXISTS remarks TEXT;

COMMENT ON COLUMN public.merchandise_release_logtbl.remarks IS
  'Required reason for manual_deduct; optional notes for other sources.';

COMMENT ON COLUMN public.merchandise_release_logtbl.source IS
  'merchandise_ar | package_enroll | manual_deduct';

COMMIT;
