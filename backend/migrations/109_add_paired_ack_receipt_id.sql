-- Links Downpayment + Phase 1 package AR pair: leader row points to the Phase 1 AR row.
-- List UI hides rows that are referenced here so one logical receipt appears on the AR page.

ALTER TABLE public.acknowledgement_receiptstbl
  ADD COLUMN IF NOT EXISTS paired_ack_receipt_id integer NULL
  REFERENCES public.acknowledgement_receiptstbl (ack_receipt_id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ack_receipts_paired_ack_receipt_id
  ON public.acknowledgement_receiptstbl (paired_ack_receipt_id)
  WHERE paired_ack_receipt_id IS NOT NULL;

COMMENT ON COLUMN public.acknowledgement_receiptstbl.paired_ack_receipt_id IS
  'For Downpayment + Phase 1 dual AR: downpayment row stores ack_receipt_id of the Phase 1 row. Phase row has NULL. Sibling row is hidden from AR list.';
