BEGIN;

-- Add a field to indicate which package type a promo applies to
-- when it is not restricted to specific packages.
-- NULL  = applies to all package types (backward compatible)
-- 'fullpayment'  = applies only to Fullpayment packages
-- 'installment'  = applies only to Installment packages

ALTER TABLE public.promostbl
  ADD COLUMN IF NOT EXISTS global_package_type character varying(50);

COMMENT ON COLUMN public.promostbl.global_package_type IS
  'When promo has no specific package bindings, controls which package types it applies to: NULL=all, fullpayment, installment.';

COMMIT;

