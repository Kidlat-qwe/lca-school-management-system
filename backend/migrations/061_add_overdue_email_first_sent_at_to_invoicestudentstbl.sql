-- Migration: Add overdue_email_first_sent_at to invoicestudentstbl
-- Date: 2026-01-29
-- Description: Tracks first automatic overdue reminder email per invoice-student.
-- Timezone: Asia/Manila (UTC+8) for stored timestamps

BEGIN;

-- Set timezone to Philippines (UTC+8) for this migration session
SET timezone = 'Asia/Manila';

ALTER TABLE IF EXISTS public.invoicestudentstbl
  ADD COLUMN IF NOT EXISTS overdue_email_first_sent_at timestamp without time zone;

COMMENT ON COLUMN public.invoicestudentstbl.overdue_email_first_sent_at
  IS 'Timestamp when the system first auto-sent an overdue reminder email for this invoice-student (Asia/Manila). NULL = not yet auto-sent.';

CREATE INDEX IF NOT EXISTS idx_invoicestudentstbl_overdue_email_first_sent_at
  ON public.invoicestudentstbl(overdue_email_first_sent_at);

COMMIT;
