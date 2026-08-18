-- Migration 139: Allow current RHET LCA_SHIRT logo labels (ACC, Beeli, LCA)
-- on merchandise stock and stock-request `type` CHECK constraints.
-- RHET Shirt catalog uses these variation middle tokens (not only Logo 1/Logo 2).
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
      'ACC', 'Beeli', 'LCA',
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
      'ACC', 'Beeli', 'LCA',
      'Set'
    )
  );

COMMIT;
