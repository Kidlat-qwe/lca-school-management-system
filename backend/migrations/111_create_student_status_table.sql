-- ============================================================
-- 111_create_student_status_table.sql
--
-- Creates student_statustbl: one row per student, auto-maintained
-- by a TRIGGER on classstudentstbl so status is always current.
--
-- Status rules:
--   active   = student has ≥1 row in classstudentstbl where
--              program_enrollment_status IN ('new','re_enrolled','upsell')
--              AND removed_at IS NULL
--   inactive = all other cases (no active enrollments, or only
--              dropped / completed / reserved / pending_enrollment)
-- ============================================================

-- 1. Create the table
CREATE TABLE IF NOT EXISTS public.student_statustbl (
  student_status_id   SERIAL PRIMARY KEY,
  student_id          INTEGER NOT NULL UNIQUE
                        REFERENCES public.userstbl(user_id) ON DELETE CASCADE,
  student_name        character varying(255),
  status              character varying(10) NOT NULL DEFAULT 'inactive'
                        CHECK (status IN ('active', 'inactive')),
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_reason      TEXT
);

-- If this migration was partially applied earlier (table without student_name),
-- CREATE TABLE IF NOT EXISTS skips — add the column explicitly.
ALTER TABLE public.student_statustbl
  ADD COLUMN IF NOT EXISTS student_name character varying(255);

COMMENT ON TABLE public.student_statustbl IS
  'One row per student. status=active means the student has at least one
   active enrollment (program_enrollment_status IN (new, re_enrolled, upsell)).
   Maintained automatically by trigger fn_sync_student_status.';

COMMENT ON COLUMN public.student_statustbl.student_name IS
  'Denormalized copy of userstbl.full_name for quick lookups without a JOIN.
   Kept in sync by the same trigger that updates status.';

-- 2. Create the trigger function that keeps the table in sync
CREATE OR REPLACE FUNCTION public.fn_sync_student_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_student_id   INTEGER;
  v_is_active    BOOLEAN;
  v_reason       TEXT;
  v_student_name character varying(255);
BEGIN
  -- Determine which student_id changed
  IF TG_OP = 'DELETE' THEN
    v_student_id := OLD.student_id;
  ELSE
    v_student_id := NEW.student_id;
  END IF;

  -- Resolve the student's full_name from userstbl
  SELECT full_name INTO v_student_name
  FROM public.userstbl
  WHERE user_id = v_student_id;

  -- Evaluate whether this student still has any active enrollment
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

  -- Upsert into student_statustbl
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

-- 3. Attach trigger to classstudentstbl
DROP TRIGGER IF EXISTS trg_sync_student_status ON public.classstudentstbl;

CREATE TRIGGER trg_sync_student_status
  AFTER INSERT OR UPDATE OF program_enrollment_status, removed_at OR DELETE
  ON public.classstudentstbl
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_student_status();

-- 4. Seed the table for all current students
--    (uses the same logic as the trigger, joining userstbl for full_name)
INSERT INTO public.student_statustbl (student_id, student_name, status, updated_at, updated_reason)
SELECT
  u.user_id,
  u.full_name,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.classstudentstbl cs
      WHERE cs.student_id = u.user_id
        AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell')
        AND cs.removed_at IS NULL
    ) THEN 'active'
    ELSE 'inactive'
  END,
  CURRENT_TIMESTAMP,
  'initial seed from migration 111'
FROM public.userstbl u
WHERE LOWER(u.user_type) = 'student'
ON CONFLICT (student_id) DO UPDATE
  SET student_name   = EXCLUDED.student_name,
      status         = EXCLUDED.status,
      updated_at     = EXCLUDED.updated_at,
      updated_reason = EXCLUDED.updated_reason;
