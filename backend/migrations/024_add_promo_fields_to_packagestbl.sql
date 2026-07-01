BEGIN;

-- Add promo fields to packagestbl
-- These fields are used when package_type = 'Promo'
ALTER TABLE public.packagestbl
ADD COLUMN IF NOT EXISTS promo_start_date date,
ADD COLUMN IF NOT EXISTS promo_end_date date,
ADD COLUMN IF NOT EXISTS promo_max_students_avail integer;

-- Add comment to explain the promo fields
COMMENT ON COLUMN public.packagestbl.promo_start_date IS 'Start date for promo availability. Only used when package_type = ''Promo''.';
COMMENT ON COLUMN public.packagestbl.promo_end_date IS 'End date for promo availability. Only used when package_type = ''Promo''.';
COMMENT ON COLUMN public.packagestbl.promo_max_students_avail IS 'Maximum number of students who can avail this promo. Only used when package_type = ''Promo''.';

COMMIT;

