-- ============================================================
-- 115_add_rejoin_program_enrollment_status.sql
--
-- Adds `rejoin` to classstudentstbl.program_enrollment_status.
-- `rejoin` means the first active phase after a student previously dropped
-- from the same class/phase sequence.
-- ============================================================

ALTER TABLE public.classstudentstbl
  DROP CONSTRAINT IF EXISTS chk_program_enrollment_status;

ALTER TABLE public.classstudentstbl
  ADD CONSTRAINT chk_program_enrollment_status
    CHECK (program_enrollment_status IN (
      'reserved',
      'pending_enrollment',
      'new',
      're_enrolled',
      'upsell',
      'rejoin',
      'dropped',
      'completed'
    ));

COMMENT ON COLUMN public.classstudentstbl.program_enrollment_status IS
  'Lifecycle state of this student-class enrollment row.
   reserved           - student paid a reservation fee; not yet fully enrolled.
   pending_enrollment - downpayment paid but Phase 1 / first monthly invoice not yet settled.
   new                - first-ever enrollment record for this student (no prior history).
   re_enrolled        - student has prior enrollment history in any class or continued to later phases.
   upsell             - student was previously in a lower program level and is now moving up.
   rejoin             - first active phase after a prior dropped phase in the same class.
   dropped            - student was unenrolled / removed before completing the program.
   completed          - student finished the enrolled phase/class (auto-set by cron).';

-- Keep student_statustbl aligned: rejoin is an active enrollment status.
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
      AND NOT EXISTS (
        SELECT 1
        FROM public.classstudentstbl active_after_drop
        WHERE active_after_drop.student_id = cs.student_id
          AND active_after_drop.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
          AND active_after_drop.removed_at IS NULL
          AND active_after_drop.enrolled_at > COALESCE(cs.removed_at, cs.enrolled_at)
      )
  ) INTO v_has_dropped;

  SELECT EXISTS (
    SELECT 1
    FROM public.classstudentstbl cs
    WHERE cs.student_id = v_student_id
      AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
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

UPDATE public.student_statustbl ss
SET student_name = u.full_name,
    status = CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.classstudentstbl cs
        WHERE cs.student_id = ss.student_id
          AND cs.program_enrollment_status = 'dropped'
          AND NOT EXISTS (
            SELECT 1
            FROM public.classstudentstbl active_after_drop
            WHERE active_after_drop.student_id = cs.student_id
              AND active_after_drop.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
              AND active_after_drop.removed_at IS NULL
              AND active_after_drop.enrolled_at > COALESCE(cs.removed_at, cs.enrolled_at)
          )
      ) THEN 'inactive'
      WHEN EXISTS (
        SELECT 1
        FROM public.classstudentstbl cs
        WHERE cs.student_id = ss.student_id
          AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
          AND cs.removed_at IS NULL
      ) THEN 'active'
      ELSE 'inactive'
    END,
    updated_at = CURRENT_TIMESTAMP,
    updated_reason = 'recomputed by migration 115'
FROM public.userstbl u
WHERE u.user_id = ss.student_id;
