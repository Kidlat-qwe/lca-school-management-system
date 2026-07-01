BEGIN;

-- Remove promo fields from packagestbl
-- These fields are no longer needed as promo package type is being removed
ALTER TABLE public.packagestbl
DROP COLUMN IF EXISTS promo_start_date,
DROP COLUMN IF EXISTS promo_end_date,
DROP COLUMN IF EXISTS promo_max_students_avail;

COMMIT;

