BEGIN;

-- Add phase_number column to classstudentstbl to track which phase a student is enrolled in
ALTER TABLE public.classstudentstbl
ADD COLUMN IF NOT EXISTS phase_number integer;

-- Add comment to explain the column
COMMENT ON COLUMN public.classstudentstbl.phase_number IS 'The phase number the student is enrolled in for this class. Automatically determined based on class start date and current phase.';

-- Create index for better query performance when filtering by phase
CREATE INDEX IF NOT EXISTS idx_classstudent_phase_number
ON public.classstudentstbl(phase_number);

-- Create composite index for common queries (class_id + phase_number)
CREATE INDEX IF NOT EXISTS idx_classstudent_class_phase
ON public.classstudentstbl(class_id, phase_number);

COMMIT;

