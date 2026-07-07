-- Second deposit proof image (max 2) and optional admin submission notes.
ALTER TABLE public.cash_deposit_summarytbl
  ADD COLUMN IF NOT EXISTS deposit_attachment_url_2 TEXT,
  ADD COLUMN IF NOT EXISTS submission_remarks TEXT;

COMMENT ON COLUMN public.cash_deposit_summarytbl.deposit_attachment_url_2
  IS 'Optional second deposit proof image URL (max 2 attachments per submission).';

COMMENT ON COLUMN public.cash_deposit_summarytbl.submission_remarks
  IS 'Optional notes from branch Admin on submit/resubmit (distinct from finance return remarks).';
