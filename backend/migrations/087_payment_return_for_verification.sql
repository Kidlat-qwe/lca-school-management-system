-- Returned: Finance/Superfinance send payment back to branch when reference vs attachment mismatch.
-- Branch (Admin/Superadmin) fixes data and resubmits for verification (Pending again).

ALTER TABLE public.paymenttbl
  ADD COLUMN IF NOT EXISTS return_reason text,
  ADD COLUMN IF NOT EXISTS returned_by integer,
  ADD COLUMN IF NOT EXISTS returned_at timestamp without time zone;

COMMENT ON COLUMN public.paymenttbl.return_reason IS 'Why Finance returned this payment for correction (reference vs attachment).';
COMMENT ON COLUMN public.paymenttbl.returned_by IS 'Finance/Superfinance user who returned the payment.';
COMMENT ON COLUMN public.paymenttbl.returned_at IS 'When the payment was returned for correction.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'paymenttbl_returned_by_fkey'
  ) THEN
    ALTER TABLE public.paymenttbl
      ADD CONSTRAINT paymenttbl_returned_by_fkey
      FOREIGN KEY (returned_by) REFERENCES public.userstbl (user_id)
      ON UPDATE NO ACTION ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.paymenttbl.approval_status IS
  'Pending | Approved | Returned — Returned means sent back to branch for reference/attachment correction.';
