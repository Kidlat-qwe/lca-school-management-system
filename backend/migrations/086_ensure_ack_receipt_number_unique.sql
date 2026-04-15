-- Ensure acknowledgement receipt numbers cannot be duplicated at the database level.
-- Original schema (068) created idx_ack_receipts_number; this migration restores it if missing
-- (e.g. manual DDL drift) and documents intent.

CREATE UNIQUE INDEX IF NOT EXISTS idx_ack_receipts_number
  ON public.acknowledgement_receiptstbl (ack_receipt_number);

COMMENT ON COLUMN public.acknowledgement_receiptstbl.ack_receipt_number IS
  'Human-readable AR id; must be unique (enforced by idx_ack_receipts_number).';
