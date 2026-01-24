BEGIN;

-- Add due_date column to reservedstudentstbl
-- This represents the payment due date for the reservation fee
-- If payment is not made by this date, the reservation will be automatically expired
ALTER TABLE public.reservedstudentstbl
    ADD COLUMN IF NOT EXISTS due_date DATE;

-- Add expired_at timestamp to track when reservation was expired
ALTER TABLE public.reservedstudentstbl
    ADD COLUMN IF NOT EXISTS expired_at TIMESTAMP WITHOUT TIME ZONE;

-- Add index for efficient queries on due_date
CREATE INDEX IF NOT EXISTS idx_reservedstudent_due_date 
    ON public.reservedstudentstbl(due_date) 
    WHERE status IN ('Reserved', 'Fee Paid');

-- Add index for expired reservations
CREATE INDEX IF NOT EXISTS idx_reservedstudent_expired 
    ON public.reservedstudentstbl(expired_at) 
    WHERE expired_at IS NOT NULL;

-- Update comment for status column to include Expired status
COMMENT ON COLUMN public.reservedstudentstbl.status
    IS 'Status: Reserved (initial), Fee Paid (reservation fee paid), Upgraded (converted to enrollment), Cancelled, Expired (payment not made by due date)';

-- Add comment for due_date
COMMENT ON COLUMN public.reservedstudentstbl.due_date
    IS 'Payment due date for reservation fee. If payment is not made by this date, reservation will be automatically expired.';

-- Add comment for expired_at
COMMENT ON COLUMN public.reservedstudentstbl.expired_at
    IS 'Timestamp when reservation was expired due to non-payment. NULL if not expired.';

COMMIT;

