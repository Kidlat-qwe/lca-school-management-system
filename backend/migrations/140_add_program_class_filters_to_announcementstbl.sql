-- Announcement audience filters for email + board visibility.
-- Empty arrays mean "all" (no academic restriction).

ALTER TABLE public.announcementstbl
  ADD COLUMN IF NOT EXISTS program_ids integer[] NOT NULL DEFAULT '{}'::integer[],
  ADD COLUMN IF NOT EXISTS class_ids integer[] NOT NULL DEFAULT '{}'::integer[];

COMMENT ON COLUMN public.announcementstbl.program_ids
  IS 'Optional program_id list for Students/Guardians/Teachers audience. Empty = all programs.';

COMMENT ON COLUMN public.announcementstbl.class_ids
  IS 'Optional class_id list for Students/Guardians/Teachers audience. Empty = all classes (within program_ids if set).';

CREATE INDEX IF NOT EXISTS idx_announcementstbl_program_ids
  ON public.announcementstbl USING GIN (program_ids);

CREATE INDEX IF NOT EXISTS idx_announcementstbl_class_ids
  ON public.announcementstbl USING GIN (class_ids);
