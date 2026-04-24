ALTER TABLE public.paymenttbl
ADD COLUMN IF NOT EXISTS finance_verified_reference_number TEXT;

COMMENT ON COLUMN public.paymenttbl.finance_verified_reference_number
IS 'Reference number entered by Finance/Superfinance during payment verification approval.';

