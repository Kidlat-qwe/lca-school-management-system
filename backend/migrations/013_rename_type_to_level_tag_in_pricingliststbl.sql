BEGIN;

-- Rename type column to level_tag in pricingliststbl
ALTER TABLE public.pricingliststbl
RENAME COLUMN type TO level_tag;

COMMIT;

