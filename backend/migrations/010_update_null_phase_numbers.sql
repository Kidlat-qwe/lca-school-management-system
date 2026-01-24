BEGIN;

-- Update existing enrollments with null phase_number
-- This script sets phase_number to 1 for enrollments where:
-- 1. The class hasn't started yet (start_date > today), OR
-- 2. The class is ongoing but phase_number is null (default to class.phase_number or 1)

UPDATE classstudentstbl cs
SET phase_number = COALESCE(
  -- If class has a phase_number, use it
  (SELECT c.phase_number FROM classestbl c WHERE c.class_id = cs.class_id),
  -- Otherwise, check if class has started
  CASE 
    WHEN (SELECT c.start_date FROM classestbl c WHERE c.class_id = cs.class_id) > CURRENT_DATE 
    THEN 1  -- Class hasn't started, enroll in Phase 1
    ELSE 1  -- Default to Phase 1
  END
)
WHERE cs.phase_number IS NULL;

COMMIT;

