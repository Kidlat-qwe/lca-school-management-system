ALTER TABLE public.acknowledgement_receiptstbl
ADD COLUMN IF NOT EXISTS prospect_student_email TEXT;
