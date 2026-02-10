-- Migration: Add CASCADE/SET NULL to foreign keys referencing userstbl for student deletion
-- This allows proper deletion of students with all their related data

-- CRITICAL STUDENT-RELATED TABLES: Change to CASCADE for data that should be deleted with the student

-- 1. Class Students: Delete enrollment when student is deleted
ALTER TABLE public.classstudentstbl 
DROP CONSTRAINT IF EXISTS classstudentstbl_student_id_fkey,
ADD CONSTRAINT classstudentstbl_student_id_fkey 
    FOREIGN KEY (student_id) 
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;

-- 2. Guardians: Delete guardian relationships when student is deleted
ALTER TABLE public.guardianstbl 
DROP CONSTRAINT IF EXISTS guardianstbl_student_id_fkey,
ADD CONSTRAINT guardianstbl_student_id_fkey 
    FOREIGN KEY (student_id) 
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;

-- 3. Installment Invoice Profiles: Delete profiles when student is deleted
ALTER TABLE public.installmentinvoiceprofilestbl 
DROP CONSTRAINT IF EXISTS installmentinvoiceprofilestbl_student_id_fkey,
ADD CONSTRAINT installmentinvoiceprofilestbl_student_id_fkey 
    FOREIGN KEY (student_id) 
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;

-- 4. Invoice Students: Delete invoice-student associations when student is deleted
ALTER TABLE public.invoicestudentstbl 
DROP CONSTRAINT IF EXISTS invoicestudentstbl_student_id_fkey,
ADD CONSTRAINT invoicestudentstbl_student_id_fkey 
    FOREIGN KEY (student_id) 
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;

-- 5. Payments: Set student_id to NULL when student is deleted (keep payment history)
ALTER TABLE public.paymenttbl 
DROP CONSTRAINT IF EXISTS paymenttbl_student_id_fkey,
ADD CONSTRAINT paymenttbl_student_id_fkey 
    FOREIGN KEY (student_id) 
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

-- 6. Promo Usage: Set student_id to NULL when student is deleted (keep usage history for analytics)
ALTER TABLE public.promousagetbl 
DROP CONSTRAINT IF EXISTS promousagetbl_student_id_fkey,
ADD CONSTRAINT promousagetbl_student_id_fkey 
    FOREIGN KEY (student_id) 
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

-- 7. Referrals: Handle both referrer and referred student
ALTER TABLE public.referralstbl 
DROP CONSTRAINT IF EXISTS referralstbl_referred_student_id_fkey,
ADD CONSTRAINT referralstbl_referred_student_id_fkey 
    FOREIGN KEY (referred_student_id) 
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

ALTER TABLE public.referralstbl 
DROP CONSTRAINT IF EXISTS referralstbl_referrer_student_id_fkey,
ADD CONSTRAINT referralstbl_referrer_student_id_fkey 
    FOREIGN KEY (referrer_student_id) 
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

-- 8. Reserved Students: Delete reservations when student is deleted
ALTER TABLE public.reservedstudentstbl 
DROP CONSTRAINT IF EXISTS reservedstudentstbl_student_id_fkey,
ADD CONSTRAINT reservedstudentstbl_student_id_fkey 
    FOREIGN KEY (student_id) 
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;

-- TEACHER-RELATED TABLES: Handle teacher deletions

-- 9. Classes: Prevent deletion if teacher is assigned to classes (or set to NULL for soft handling)
-- Option A: SET NULL (allows deletion, removes teacher assignment)
ALTER TABLE public.classestbl 
DROP CONSTRAINT IF EXISTS classestbl_teacher_id_fkey,
ADD CONSTRAINT classestbl_teacher_id_fkey 
    FOREIGN KEY (teacher_id) 
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

-- AUDIT/HISTORY TABLES: Keep records but nullify user references

-- 10. Announcements: Set created_by to NULL (keep announcement history)
ALTER TABLE public.announcementstbl 
DROP CONSTRAINT IF EXISTS announcementstbl_created_by_fkey,
ADD CONSTRAINT announcementstbl_created_by_fkey 
    FOREIGN KEY (created_by) 
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

-- 11. Invoices: Set created_by to NULL (keep invoice history)
ALTER TABLE public.invoicestbl 
DROP CONSTRAINT IF EXISTS invoicestbl_created_by_fkey,
ADD CONSTRAINT invoicestbl_created_by_fkey 
    FOREIGN KEY (created_by) 
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

-- 12. Promos: Set created_by to NULL (keep promo history)
ALTER TABLE public.promostbl 
DROP CONSTRAINT IF EXISTS promostbl_created_by_fkey,
ADD CONSTRAINT promostbl_created_by_fkey 
    FOREIGN KEY (created_by) 
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

-- 13. Suspension Periods: Set created_by to NULL (keep suspension history)
ALTER TABLE public.suspensionperiodstbl 
DROP CONSTRAINT IF EXISTS suspensionperiodstbl_created_by_fkey,
ADD CONSTRAINT suspensionperiodstbl_created_by_fkey 
    FOREIGN KEY (created_by) 
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

-- 14. Merchandise Request Log: Handle both requested_by and reviewed_by
ALTER TABLE public.merchandiserequestlogtbl 
DROP CONSTRAINT IF EXISTS merchandiserequestlogtbl_requested_by_fkey,
ADD CONSTRAINT merchandiserequestlogtbl_requested_by_fkey 
    FOREIGN KEY (requested_by) 
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

-- Note: reviewed_by already has SET NULL in migration 051

-- 15. Payments: Set created_by to NULL (keep payment history)
ALTER TABLE public.paymenttbl 
DROP CONSTRAINT IF EXISTS paymenttbl_created_by_fkey,
ADD CONSTRAINT paymenttbl_created_by_fkey 
    FOREIGN KEY (created_by) 
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

-- Note: The following already have CASCADE or SET NULL from previous migrations:
-- - attendancetbl (student_id: CASCADE, marked_by: SET NULL) ✓
-- - announcement_readstbl (CASCADE) ✓
-- - classteacherstbl (CASCADE) ✓
-- - class_merge_historytbl (merged_by, undone_by: SET NULL) ✓
-- - classsessionstbl (all teacher IDs: SET NULL) ✓
-- - custom_holidaystbl (created_by: SET NULL) ✓
-- - system_settingstbl (updated_by: SET NULL) ✓
