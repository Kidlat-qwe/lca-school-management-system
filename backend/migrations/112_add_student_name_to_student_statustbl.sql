-- ============================================================
-- 112_add_student_name_to_student_statustbl.sql
--
-- Fixes databases where migration 111 ran before student_name
-- existed: CREATE TABLE IF NOT EXISTS skipped the new column.
-- ============================================================

ALTER TABLE public.student_statustbl
  ADD COLUMN IF NOT EXISTS student_name character varying(255);

COMMENT ON COLUMN public.student_statustbl.student_name IS
  'Denormalized copy of userstbl.full_name for quick lookups without a JOIN.
   Kept in sync by trigger fn_sync_student_status.';

-- Replace trigger function so INSERT/UPSERT includes student_name
CREATE OR REPLACE FUNCTION public.fn_sync_student_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_student_id   INTEGER;
  v_is_active    BOOLEAN;
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
    CASE WHEN v_is_active THEN 'active' ELSE 'inactive' END,
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

-- Backfill names for existing rows
UPDATE public.student_statustbl ss
SET student_name = u.full_name
FROM public.userstbl u
WHERE u.user_id = ss.student_id
  AND (ss.student_name IS DISTINCT FROM u.full_name);
