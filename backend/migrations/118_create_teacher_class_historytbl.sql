-- Teacher class assignment history (turnover and completed assignments)
CREATE TABLE IF NOT EXISTS public.teacher_class_historytbl (
  history_id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES public.userstbl(user_id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES public.classestbl(class_id) ON DELETE CASCADE,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP,
  end_reason VARCHAR(50),
  turned_over_to_teacher_id INTEGER REFERENCES public.userstbl(user_id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_teacher_class_history_teacher
  ON public.teacher_class_historytbl(teacher_id);

CREATE INDEX IF NOT EXISTS idx_teacher_class_history_class
  ON public.teacher_class_historytbl(class_id);

CREATE INDEX IF NOT EXISTS idx_teacher_class_history_open
  ON public.teacher_class_historytbl(teacher_id, class_id)
  WHERE ended_at IS NULL;

COMMENT ON TABLE public.teacher_class_historytbl IS
  'Assignment history per teacher/class. Open rows (ended_at NULL) are current; turnover sets ended_at and end_reason=turnover.';

COMMENT ON COLUMN public.teacher_class_historytbl.end_reason IS
  'turnover | class_completed | removed | NULL while active';
