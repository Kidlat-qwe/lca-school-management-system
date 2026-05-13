-- ============================================================
-- 110_rename_enrollment_status_and_program_enrollment_status.sql
-- 
-- 1. Renames enrollment_status → program_enrollment_status in classstudentstbl
-- 2. Migrates legacy 'Active' / 'Removed' values to new canonical set
-- 3. Adds a CHECK constraint for the new value set
-- ============================================================

-- Step 1: Add the new column (keeps the old one alive during backfill)
ALTER TABLE public.classstudentstbl
  ADD COLUMN IF NOT EXISTS program_enrollment_status character varying(30);

-- Step 2: Backfill from the old column
--   'Active'  → 'new'     (conservative default; the determineEnrollmentStatus()
--                           helper will set proper values for future enrollments.
--                           Existing active students can be re-classified in a
--                           one-off admin script if business needs it.)
--   'Removed' → 'dropped'
--   anything else / NULL  → 'new'
UPDATE public.classstudentstbl
SET program_enrollment_status =
  CASE
    WHEN COALESCE(enrollment_status, 'Active') = 'Removed' THEN 'dropped'
    ELSE 'new'
  END
WHERE program_enrollment_status IS NULL;

-- Step 3: Lock down with a CHECK constraint
ALTER TABLE public.classstudentstbl
  ADD CONSTRAINT chk_program_enrollment_status
    CHECK (program_enrollment_status IN (
      'reserved',
      'pending_enrollment',
      'new',
      're_enrolled',
      'upsell',
      'dropped',
      'completed'
    ));

-- Step 4: Make it NOT NULL now that every row has a value
ALTER TABLE public.classstudentstbl
  ALTER COLUMN program_enrollment_status SET NOT NULL;

-- Step 5: Drop the old column
ALTER TABLE public.classstudentstbl
  DROP COLUMN IF EXISTS enrollment_status;

-- Step 6: Add a comment for documentation
COMMENT ON COLUMN public.classstudentstbl.program_enrollment_status IS
  'Lifecycle state of this student-class enrollment row.
   reserved           – student paid a reservation fee; not yet fully enrolled.
   pending_enrollment – downpayment paid but Phase 1 / first monthly invoice not yet settled.
   new                – first-ever enrollment record for this student (no prior history).
   re_enrolled        – student has prior enrollment history in any class.
   upsell             – student was previously in a lower program level and is now moving up.
   dropped            – student was unenrolled / removed before completing the program.
   completed          – student finished the enrolled phase/class (auto-set by cron).';
