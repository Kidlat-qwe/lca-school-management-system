-- Mobile number for SMS notifications on Package / Merchandise acknowledgement receipts
ALTER TABLE public.acknowledgement_receiptstbl
  ADD COLUMN IF NOT EXISTS prospect_student_phone TEXT;

COMMENT ON COLUMN public.acknowledgement_receiptstbl.prospect_student_phone IS
  'Client/guardian mobile for SMS payment confirmation (Philippines format, e.g. 09171234567).';
