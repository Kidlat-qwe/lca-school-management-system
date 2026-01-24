BEGIN;

-- Rollback for migration 043_fix_completed_sessions_without_attendance.sql
-- This sets affected class sessions back to 'Completed' status.
-- NOTE: This may re-introduce sessions marked as completed without attendance
-- for currently enrolled students, effectively reversing the data correction.

UPDATE public.classsessionstbl cs
SET status = 'Completed',
    updated_at = CURRENT_TIMESTAMP
WHERE cs.status = 'Scheduled'
  AND NOT EXISTS (
    SELECT 1
    FROM public.attendancetbl a
    JOIN public.classestbl c
      ON c.class_id = cs.class_id
    JOIN public.classstudentstbl cs_enroll
      ON cs_enroll.class_id = c.class_id
     AND cs_enroll.student_id = a.student_id
    WHERE a.classsession_id = cs.classsession_id
  );

COMMIT;


