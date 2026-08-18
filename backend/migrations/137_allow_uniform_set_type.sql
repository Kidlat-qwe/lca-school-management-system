-- Migration 137: Allow RHET uniform type "Set" on merchandise stock and
-- stock-request `type` CHECK constraints.
-- Request Stock for PE/School Uniform catalog rows with type=Set was failing
-- INSERT into merchandiserequestlogtbl (23514 check_request_type).
-- Safe to re-run.

BEGIN;

ALTER TABLE public.merchandisestbl
  DROP CONSTRAINT IF EXISTS check_type;

ALTER TABLE public.merchandisestbl
  ADD CONSTRAINT check_type
  CHECK (
    type IS NULL
    OR type IN (
      'Polo', 'Short', 'Blouse', 'Skirt', 'Shirt', 'Pants',
      'Top', 'Bottom',
      'Logo 1', 'Logo 2',
      'Set'
    )
  );

ALTER TABLE public.merchandiserequestlogtbl
  DROP CONSTRAINT IF EXISTS check_request_type;

ALTER TABLE public.merchandiserequestlogtbl
  ADD CONSTRAINT check_request_type
  CHECK (
    type IS NULL
    OR type IN (
      'Polo', 'Short', 'Blouse', 'Skirt', 'Shirt', 'Pants',
      'Top', 'Bottom',
      'Logo 1', 'Logo 2',
      'Set'
    )
  );

COMMIT;
