-- Audit trail for class start/end date adjustments (installment billing realignment).
CREATE TABLE IF NOT EXISTS class_schedule_adjustmenttbl (
  adjustment_id SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classestbl(class_id) ON DELETE CASCADE,
  adjusted_by INTEGER REFERENCES userstbl(user_id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  old_start_date DATE NOT NULL,
  new_start_date DATE NOT NULL,
  old_end_date DATE,
  new_end_date DATE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  preview_snapshot JSONB,
  result_summary JSONB
);

CREATE INDEX IF NOT EXISTS idx_class_schedule_adjustment_class_id
  ON class_schedule_adjustmenttbl(class_id);

CREATE INDEX IF NOT EXISTS idx_class_schedule_adjustment_applied_at
  ON class_schedule_adjustmenttbl(applied_at DESC);
