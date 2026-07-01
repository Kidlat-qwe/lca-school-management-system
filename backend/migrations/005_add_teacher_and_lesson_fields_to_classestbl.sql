BEGIN;

-- Add teacher_id column to classestbl if it does not exist
ALTER TABLE public.classestbl
ADD COLUMN IF NOT EXISTS teacher_id integer;

-- Add phase_number column to classestbl if it does not exist
ALTER TABLE public.classestbl
ADD COLUMN IF NOT EXISTS phase_number integer;

-- Add session_number column to classestbl if it does not exist
ALTER TABLE public.classestbl
ADD COLUMN IF NOT EXISTS session_number integer;

-- Add status column to classestbl if it does not exist
ALTER TABLE public.classestbl
ADD COLUMN IF NOT EXISTS status character varying(50) DEFAULT 'Active';

-- Add foreign key constraint to userstbl for teacher_id
ALTER TABLE IF EXISTS public.classestbl
ADD CONSTRAINT classestbl_teacher_id_fkey FOREIGN KEY (teacher_id)
REFERENCES public.userstbl (user_id) MATCH SIMPLE
ON UPDATE NO ACTION
ON DELETE NO ACTION;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_class_teacher_id
ON public.classestbl(teacher_id);

COMMIT;

