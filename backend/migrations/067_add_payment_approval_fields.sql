BEGIN;

-- Add payment approval tracking fields to paymenttbl
-- This is for internal finance team tracking to confirm payment was actually received/claimed
-- Separate from the 'status' field which tracks the payment transaction status

ALTER TABLE IF EXISTS public.paymenttbl
  ADD COLUMN IF NOT EXISTS approval_status character varying(50) COLLATE pg_catalog."default" DEFAULT 'Pending'::character varying,
  ADD COLUMN IF NOT EXISTS approved_by integer,
  ADD COLUMN IF NOT EXISTS approved_at timestamp without time zone;

-- Add foreign key for approved_by
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'paymenttbl_approved_by_fkey'
  ) THEN
    ALTER TABLE public.paymenttbl
      ADD CONSTRAINT paymenttbl_approved_by_fkey FOREIGN KEY (approved_by)
      REFERENCES public.userstbl (user_id) MATCH SIMPLE
      ON UPDATE NO ACTION
      ON DELETE SET NULL;
  END IF;
END $$;

-- Add index for approval_status for efficient filtering
CREATE INDEX IF NOT EXISTS idx_payment_approval_status
    ON public.paymenttbl(approval_status);

-- Add comments
COMMENT ON COLUMN public.paymenttbl.approval_status
    IS 'Internal approval status for finance team confirmation: Pending (default), Approved. Does not affect student payment status.';

COMMENT ON COLUMN public.paymenttbl.approved_by
    IS 'User ID of the finance team member (Superadmin/Superfinance/Finance) who approved the payment';

COMMENT ON COLUMN public.paymenttbl.approved_at
    IS 'Timestamp when the payment was approved by finance team';

COMMIT;
