-- Rename verifier-OK status to awaiting_reflection; add completed.
-- Flow: draft → submitted → awaiting_reflection → completed
--    or: submitted → revision_requested → submitted → …

ALTER TABLE public.lessonplanstbl
  DROP CONSTRAINT IF EXISTS lessonplanstbl_status_check;

-- Migrate any existing verifier-approved rows to the new status name.
UPDATE public.lessonplanstbl
SET status = 'awaiting_reflection'
WHERE status = 'approved';

ALTER TABLE public.lessonplanstbl
  ADD CONSTRAINT lessonplanstbl_status_check
  CHECK (
    status IN (
      'draft',
      'submitted',
      'awaiting_reflection',
      'revision_requested',
      'completed'
    )
  );

COMMENT ON COLUMN public.lessonplanstbl.status IS
  'draft | submitted | awaiting_reflection (verifier OK; teacher fills reflection on lesson date) | revision_requested | completed';
