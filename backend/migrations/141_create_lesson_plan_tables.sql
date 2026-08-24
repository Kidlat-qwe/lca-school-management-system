-- Lesson plans (teacher submissions) + Superadmin verifier config.
-- Region / District / Division / School ID are intentionally not stored yet
-- (leave blank on the form header until per-branch fields are added).

CREATE TABLE IF NOT EXISTS public.lessonplanstbl (
  lesson_plan_id SERIAL PRIMARY KEY,
  branch_id INTEGER REFERENCES public.branchestbl (branch_id) ON DELETE SET NULL,
  teacher_user_id INTEGER NOT NULL REFERENCES public.userstbl (user_id) ON DELETE CASCADE,
  lesson_date DATE NOT NULL,
  grade_level VARCHAR(100) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  topic TEXT NOT NULL,
  learning_objectives TEXT NOT NULL DEFAULT '',
  materials_resources TEXT NOT NULL DEFAULT '',
  opening_routine TEXT NOT NULL DEFAULT '',
  review_section TEXT NOT NULL DEFAULT '',
  lesson_presentation TEXT NOT NULL DEFAULT '',
  guided_practice TEXT NOT NULL DEFAULT '',
  assessment TEXT NOT NULL DEFAULT '',
  closing_wrapping_up TEXT NOT NULL DEFAULT '',
  reflection_went_well TEXT NOT NULL DEFAULT '',
  reflection_challenges TEXT NOT NULL DEFAULT '',
  reflection_improvements TEXT NOT NULL DEFAULT '',
  status VARCHAR(40) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'revision_requested')),
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
  'Teacher lesson plans: draft → submitted → approved | revision_requested.';

CREATE TABLE IF NOT EXISTS public.lesson_plan_verifierstbl (
  user_id INTEGER PRIMARY KEY REFERENCES public.userstbl (user_id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES public.userstbl (user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.lesson_plan_verifierstbl IS
  'Superadmin users configured to verify submitted lesson plans.';
