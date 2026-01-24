BEGIN;

-- Add package_type column to packagestbl
-- Values: 'Fullpayment' or 'Installment'
-- This determines if installment invoice settings should auto-appear during enrollment
ALTER TABLE public.packagestbl
ADD COLUMN IF NOT EXISTS package_type character varying(50) COLLATE pg_catalog."default" DEFAULT 'Fullpayment';

COMMIT;

