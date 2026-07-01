ALTER TABLE public.acknowledgement_receiptstbl
ADD COLUMN IF NOT EXISTS verified_by_user_id INTEGER,
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.acknowledgement_receiptstbl.verified_by_user_id
IS 'User ID of Finance/Superfinance (or auto-verifying admin) who verified the acknowledgement receipt.';

COMMENT ON COLUMN public.acknowledgement_receiptstbl.verified_at
IS 'Timestamp when the acknowledgement receipt was verified.';

