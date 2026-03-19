-- Migration: Fix enrollment phase_number for Phase+Installment profiles
-- Purpose: Students enrolled in Phase 1 via first installment payment should be in phase_start
--          when the profile has phase_start (Phase 3-10 package). Updates classstudentstbl.

UPDATE public.classstudentstbl cs
SET phase_number = ip.phase_start
FROM public.installmentinvoiceprofilestbl ip
WHERE ip.class_id = cs.class_id
  AND ip.student_id = cs.student_id
  AND ip.phase_start IS NOT NULL
  AND ip.phase_start > 1
  AND cs.phase_number = 1;
