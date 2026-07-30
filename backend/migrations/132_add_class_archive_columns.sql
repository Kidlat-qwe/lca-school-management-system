-- Migration 132: Soft-archive support for classes (Settings → Archived Classes).
-- Archived classes leave the main Classes list; purge after 30 days if not restored.

ALTER TABLE public.classestbl
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS archived_by INTEGER NULL,
  ADD COLUMN IF NOT EXISTS archive_purge_after DATE NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'classestbl_archived_by_fkey'
  ) THEN
    ALTER TABLE public.classestbl
      ADD CONSTRAINT classestbl_archived_by_fkey
      FOREIGN KEY (archived_by)
      REFERENCES public.userstbl (user_id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_classestbl_archived_at
  ON public.classestbl (archived_at)
  WHERE archived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_classestbl_archive_purge_after
  ON public.classestbl (archive_purge_after)
  WHERE archive_purge_after IS NOT NULL;

COMMENT ON COLUMN public.classestbl.archived_at IS
  'When set, class is soft-deleted (hidden from main list; shown in Settings → Archived Classes)';
COMMENT ON COLUMN public.classestbl.archived_by IS
  'userstbl.user_id who archived the class';
COMMENT ON COLUMN public.classestbl.archive_purge_after IS
  'Manila calendar date after which archived class may be permanently deleted (archived_at + 30 days)';
