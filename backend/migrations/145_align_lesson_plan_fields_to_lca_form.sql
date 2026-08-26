-- Align lessonplanstbl fields with LCA Lesson Plan form.
-- Keeps legacy columns for safety; app reads/writes the new columns.
-- Teacher reflection workflow unchanged (awaiting_reflection → completed).
-- Head Teacher review fields are verifier-only (filled on approve).

ALTER TABLE public.lessonplanstbl
  ADD COLUMN IF NOT EXISTS phase VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS session_label VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS early_learning_goals TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS objective_1 TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS objective_2 TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS objective_3 TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS assessment_method TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS assessment_criteria TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS materials_needed TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS preliminaries_time TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS preliminaries_activity TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lesson_proper_time TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lesson_proper_activity TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS conclusion_time TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS conclusion_activity TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS class1_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS class1_age_group TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS class1_considerations TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS class1_adjustments TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS class2_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS class2_age_group TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS class2_considerations TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS class2_adjustments TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS class3_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS class3_age_group TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS class3_considerations TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS class3_adjustments TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reflection_amazing_moments TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS head_teacher_overall_assessment TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS head_teacher_specific_feedback TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS head_teacher_next_steps TEXT NOT NULL DEFAULT '';

-- Best-effort copy from previous form fields (only when new columns are still empty).
UPDATE public.lessonplanstbl SET
  materials_needed = COALESCE(NULLIF(TRIM(materials_needed), ''), materials_resources, ''),
  objective_1 = COALESCE(NULLIF(TRIM(objective_1), ''), learning_objectives, ''),
  assessment_method = COALESCE(NULLIF(TRIM(assessment_method), ''), assessment, ''),
  preliminaries_activity = COALESCE(NULLIF(TRIM(preliminaries_activity), ''), opening_routine, ''),
  lesson_proper_activity = COALESCE(NULLIF(TRIM(lesson_proper_activity), ''), lesson_presentation, ''),
  conclusion_activity = COALESCE(NULLIF(TRIM(conclusion_activity), ''), closing_wrapping_up, '')
WHERE TRUE;

COMMENT ON COLUMN public.lessonplanstbl.session_label IS
  'LCA form "Session" (named session_label to avoid reserved-word confusion).';
COMMENT ON COLUMN public.lessonplanstbl.reflection_went_well IS
  'Teacher reflection: Successes (LCA form).';
COMMENT ON COLUMN public.lessonplanstbl.reflection_amazing_moments IS
  'Teacher reflection: Amazing Moments (LCA form).';
COMMENT ON COLUMN public.lessonplanstbl.head_teacher_overall_assessment IS
  'Verifier-only Head Teacher review: Overall Assessment.';
COMMENT ON COLUMN public.lessonplanstbl.head_teacher_specific_feedback IS
  'Verifier-only Head Teacher review: Specific Feedback.';
COMMENT ON COLUMN public.lessonplanstbl.head_teacher_next_steps IS
  'Verifier-only Head Teacher review: Next Steps.';
