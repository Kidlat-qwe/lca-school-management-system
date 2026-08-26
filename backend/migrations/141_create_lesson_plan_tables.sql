-- Lesson plans (teacher submissions) + verifier config.
-- Fields follow the LCA Lesson Plan PDF.
-- Region / District / Division / School ID are intentionally not stored yet
-- (leave blank on the form header until per-branch fields are added).

CREATE TABLE IF NOT EXISTS public.lessonplanstbl (
  lesson_plan_id SERIAL PRIMARY KEY,
  branch_id INTEGER REFERENCES public.branchestbl (branch_id) ON DELETE SET NULL,
  teacher_user_id INTEGER NOT NULL REFERENCES public.userstbl (user_id) ON DELETE CASCADE,
  lesson_date DATE NOT NULL,
  grade_level VARCHAR(100) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  phase VARCHAR(100) NOT NULL DEFAULT '',
  session_label VARCHAR(100) NOT NULL DEFAULT '',
  topic TEXT NOT NULL,
  early_learning_goals TEXT NOT NULL DEFAULT '',
  objective_1 TEXT NOT NULL DEFAULT '',
  objective_2 TEXT NOT NULL DEFAULT '',
  objective_3 TEXT NOT NULL DEFAULT '',
  assessment_method TEXT NOT NULL DEFAULT '',
  assessment_criteria TEXT NOT NULL DEFAULT '',
  materials_needed TEXT NOT NULL DEFAULT '',
  preliminaries_time TEXT NOT NULL DEFAULT '',
  preliminaries_activity TEXT NOT NULL DEFAULT '',
  lesson_proper_time TEXT NOT NULL DEFAULT '',
  lesson_proper_activity TEXT NOT NULL DEFAULT '',
  conclusion_time TEXT NOT NULL DEFAULT '',
  conclusion_activity TEXT NOT NULL DEFAULT '',
  class1_name TEXT NOT NULL DEFAULT '',
  class1_age_group TEXT NOT NULL DEFAULT '',
  class1_considerations TEXT NOT NULL DEFAULT '',
  class1_adjustments TEXT NOT NULL DEFAULT '',
  class2_name TEXT NOT NULL DEFAULT '',
  class2_age_group TEXT NOT NULL DEFAULT '',
  class2_considerations TEXT NOT NULL DEFAULT '',
  class2_adjustments TEXT NOT NULL DEFAULT '',
  class3_name TEXT NOT NULL DEFAULT '',
  class3_age_group TEXT NOT NULL DEFAULT '',
  class3_considerations TEXT NOT NULL DEFAULT '',
  class3_adjustments TEXT NOT NULL DEFAULT '',
  reflection_went_well TEXT NOT NULL DEFAULT '',
  reflection_amazing_moments TEXT NOT NULL DEFAULT '',
  reflection_challenges TEXT NOT NULL DEFAULT '',
  reflection_improvements TEXT NOT NULL DEFAULT '',
  head_teacher_overall_assessment TEXT NOT NULL DEFAULT '',
  head_teacher_specific_feedback TEXT NOT NULL DEFAULT '',
  head_teacher_next_steps TEXT NOT NULL DEFAULT '',
  status VARCHAR(40) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'awaiting_reflection', 'revision_requested', 'completed')),
  submitted_at TIMESTAMPTZ,
  revision_reason TEXT,
  verified_by INTEGER REFERENCES public.userstbl (user_id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lessonplanstbl_teacher
  ON public.lessonplanstbl (teacher_user_id);

CREATE INDEX IF NOT EXISTS idx_lessonplanstbl_branch_status
  ON public.lessonplanstbl (branch_id, status);

CREATE INDEX IF NOT EXISTS idx_lessonplanstbl_status
  ON public.lessonplanstbl (status);

COMMENT ON TABLE public.lessonplanstbl IS
  'Teacher lesson plans (LCA form): draft → submitted → awaiting_reflection | revision_requested → completed.';

COMMENT ON COLUMN public.lessonplanstbl.session_label IS
  'LCA form Session field.';
COMMENT ON COLUMN public.lessonplanstbl.reflection_went_well IS
  'Teacher reflection: Successes.';
COMMENT ON COLUMN public.lessonplanstbl.head_teacher_overall_assessment IS
  'Verifier-only Head Teacher review on approve.';

CREATE TABLE IF NOT EXISTS public.lesson_plan_verifierstbl (
  user_id INTEGER PRIMARY KEY REFERENCES public.userstbl (user_id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES public.userstbl (user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.lesson_plan_verifierstbl IS
  'Admin users selected in Settings who may verify lesson plans for their branch. Superadmins always verify and are not listed here.';
