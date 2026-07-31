-- Migration 134: Allow LCA_SHIRT logo types (Logo 1 / Logo 2) on merchandise
-- stock and stock-request `type` CHECK constraints.
-- RHET Shirt / LCA_SHIRT uses type = Logo 1 | Logo 2 (not PE piece type "Shirt").
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
      'Logo 1', 'Logo 2'
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
      'Logo 1', 'Logo 2'
    )
  );

COMMIT;
