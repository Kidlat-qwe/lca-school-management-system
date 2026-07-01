ALTER TABLE public.cash_deposit_summarytbl
  ADD COLUMN IF NOT EXISTS reference_number VARCHAR(255),
  ADD COLUMN IF NOT EXISTS deposit_attachment_url TEXT;

COMMENT ON COLUMN public.cash_deposit_summarytbl.reference_number
  IS 'Branch cash deposit reference number (e.g., deposit slip or transaction number).';

COMMENT ON COLUMN public.cash_deposit_summarytbl.deposit_attachment_url
  IS 'S3 URL of the uploaded deposit proof image submitted by branch admin.';
