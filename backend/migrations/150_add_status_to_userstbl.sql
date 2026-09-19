-- Migration: Add status and substitute_teacher_id to userstbl
-- Used by Superadmin/Admin Edit Personnel to manage Active / Inactive / Suspended
-- and assign a conflict-free substitute teacher when status is Suspended.

ALTER TABLE public.userstbl
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'Active';

ALTER TABLE public.userstbl
  ADD COLUMN IF NOT EXISTS substitute_teacher_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'userstbl_substitute_teacher_id_fkey'
  ) THEN
    ALTER TABLE public.userstbl
      ADD CONSTRAINT userstbl_substitute_teacher_id_fkey
      FOREIGN KEY (substitute_teacher_id)
      REFERENCES public.userstbl (user_id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.userstbl.status
  IS 'Account status: Active, Inactive, Suspended';

COMMENT ON COLUMN public.userstbl.substitute_teacher_id
  IS 'Substitute teacher assigned when status = Suspended';

CREATE INDEX IF NOT EXISTS idx_userstbl_status
  ON public.userstbl (status);

CREATE INDEX IF NOT EXISTS idx_userstbl_substitute_teacher_id
  ON public.userstbl (substitute_teacher_id)
  WHERE substitute_teacher_id IS NOT NULL;
