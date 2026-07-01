-- Rejected: Finance/Superfinance permanently rejects a payment so it no longer
-- counts as revenue, while preserving audit history and class enrollment.

ALTER TABLE public.paymenttbl
  ADD COLUMN IF NOT EXISTS reject_reason text,
  ADD COLUMN IF NOT EXISTS rejected_by integer,
  ADD COLUMN IF NOT EXISTS rejected_at timestamp without time zone;

COMMENT ON COLUMN public.paymenttbl.reject_reason IS 'Why Finance/Superfinance permanently rejected this payment.';
COMMENT ON COLUMN public.paymenttbl.rejected_by IS 'Finance/Superfinance user who rejected the payment.';
COMMENT ON COLUMN public.paymenttbl.rejected_at IS 'When the payment was rejected.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'paymenttbl_rejected_by_fkey'
  ) THEN
    ALTER TABLE public.paymenttbl
      ADD CONSTRAINT paymenttbl_rejected_by_fkey
      FOREIGN KEY (rejected_by) REFERENCES public.userstbl (user_id)
      ON UPDATE NO ACTION ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.paymenttbl.approval_status IS
  'Pending | Approved | Returned | Rejected — Rejected is final and excludes the payment from revenue totals.';
