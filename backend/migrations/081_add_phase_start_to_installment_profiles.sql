-- Migration: Add phase_start to installmentinvoiceprofilestbl for Phase packages
-- Purpose: Phase packages (e.g. Phase 3-10) need phase_start so enrollment and installment
--          progress correctly. total_phases = count of phases in package range.
--          phase_start = first phase of the package (e.g. 3 for Phase 3-10).

ALTER TABLE public.installmentinvoiceprofilestbl
  ADD COLUMN IF NOT EXISTS phase_start integer DEFAULT NULL;

COMMENT ON COLUMN public.installmentinvoiceprofilestbl.phase_start IS 'First phase of package range (for Phase packages). NULL = Phase 1. Used for enrollment and installment progress.';

-- Backfill existing Phase+Installment profiles (package_type=Phase, payment_option=Installment)
UPDATE public.installmentinvoiceprofilestbl ip
SET
  phase_start = pkg.phase_start,
  total_phases = GREATEST(1, COALESCE(pkg.phase_end, pkg.phase_start) - pkg.phase_start + 1)
FROM public.packagestbl pkg
WHERE ip.package_id = pkg.package_id
  AND pkg.package_type = 'Phase'
  AND pkg.payment_option = 'Installment'
  AND pkg.phase_start IS NOT NULL;
