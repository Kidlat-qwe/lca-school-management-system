-- ============================================================
-- 113_update_student_status_trigger_and_completed_rule.sql
--
-- Updates student status synchronization rules:
-- 1) If a student has ANY dropped enrollment row, force inactive.
-- 2) Otherwise, active only when they have at least one active program
--    enrollment status (new/re_enrolled/upsell) with removed_at IS NULL.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_sync_student_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_student_id   INTEGER;
  v_is_active    BOOLEAN;
  v_has_dropped  BOOLEAN;
  v_reason       TEXT;
  v_student_name character varying(255);
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_student_id := OLD.student_id;
  ELSE
    v_student_id := NEW.student_id;
  END IF;

  SELECT full_name INTO v_student_name
  FROM public.userstbl
  WHERE user_id = v_student_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.classstudentstbl cs
    WHERE cs.student_id = v_student_id
      AND cs.program_enrollment_status = 'dropped'
  ) INTO v_has_dropped;

  SELECT EXISTS (
    SELECT 1
    FROM public.classstudentstbl cs
    WHERE cs.student_id = v_student_id
      AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell')
      AND cs.removed_at IS NULL
  ) INTO v_is_active;

  v_reason := TG_OP || ' on classstudentstbl (classstudent_id=' ||
    CASE WHEN TG_OP = 'DELETE' THEN OLD.classstudent_id::TEXT
         ELSE NEW.classstudent_id::TEXT END || ')';

  INSERT INTO public.student_statustbl (student_id, student_name, status, updated_at, updated_reason)
  VALUES (
    v_student_id,
    v_student_name,
    CASE
      WHEN v_has_dropped THEN 'inactive'
      WHEN v_is_active THEN 'active'
      ELSE 'inactive'
    END,
    CURRENT_TIMESTAMP,
    v_reason
  )
  ON CONFLICT (student_id) DO UPDATE
    SET student_name   = EXCLUDED.student_name,
        status         = EXCLUDED.status,
        updated_at     = EXCLUDED.updated_at,
        updated_reason = EXCLUDED.updated_reason;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Recompute current student_statustbl values with the updated rule.
UPDATE public.student_statustbl ss
SET student_name = u.full_name,
    status = CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.classstudentstbl cs
        WHERE cs.student_id = ss.student_id
          AND cs.program_enrollment_status = 'dropped'
      ) THEN 'inactive'
      WHEN EXISTS (
        SELECT 1
        FROM public.classstudentstbl cs
        WHERE cs.student_id = ss.student_id
          AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell')
          AND cs.removed_at IS NULL
      ) THEN 'active'
      ELSE 'inactive'
    END,
    updated_at = CURRENT_TIMESTAMP,
    updated_reason = 'recomputed by migration 113'
FROM public.userstbl u
WHERE u.user_id = ss.student_id;
