BEGIN;

-- Allow promos to exist without being tied to a single package.
-- Global promos will have package_id = NULL and use promopackagestbl (or no rows)
-- to define any package-specific restrictions.

ALTER TABLE public.promostbl
  ALTER COLUMN package_id DROP NOT NULL;

COMMIT;

