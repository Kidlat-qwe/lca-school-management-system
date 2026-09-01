-- One CMS class per lesson plan (replaces subject + multi-class differentiation slots).

ALTER TABLE public.lessonplanstbl
  ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES public.classestbl (class_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lessonplanstbl_class_id
  ON public.lessonplanstbl (class_id);

COMMENT ON COLUMN public.lessonplanstbl.class_id IS
  'CMS class this lesson plan applies to (one plan per class). Legacy subject column stores display label.';
