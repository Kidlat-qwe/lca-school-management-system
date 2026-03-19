-- Migration: Add payment_option to packagestbl for Phase packages
-- Purpose: Phase packages can now be Full Payment or Installment (payment structure)
-- Enrollment logic (phase-based) remains unchanged; only payment flow differs.
-- Existing Phase packages default to Fullpayment for backward compatibility.

-- Add payment_option column (Fullpayment | Installment, only used when package_type = 'Phase')
ALTER TABLE public.packagestbl
  ADD COLUMN IF NOT EXISTS payment_option character varying(50) COLLATE pg_catalog."default" DEFAULT NULL;

COMMENT ON COLUMN public.packagestbl.payment_option IS 'Payment structure for Phase packages only: Fullpayment (pay in full) or Installment (downpayment + monthly). NULL or Fullpayment = pay in full. Only applicable when package_type = Phase.';

-- Backfill existing Phase packages: set payment_option = 'Fullpayment' so they behave as before
UPDATE public.packagestbl
  SET payment_option = 'Fullpayment'
  WHERE package_type = 'Phase' AND (payment_option IS NULL OR payment_option = '');
