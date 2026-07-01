-- =============================================================================
-- Migration 078: Add merchandise AR (Acknowledgement Receipt) support
-- Enables AR creation for merchandise purchases (buy merchandise) in addition to packages
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Add ar_type to acknowledgement_receiptstbl ('Package' | 'Merchandise')
-- -----------------------------------------------------------------------------
ALTER TABLE public.acknowledgement_receiptstbl
  ADD COLUMN IF NOT EXISTS ar_type VARCHAR(50) NOT NULL DEFAULT 'Package';

COMMENT ON COLUMN public.acknowledgement_receiptstbl.ar_type
  IS 'Type of AR: Package (enrollment) or Merchandise (buy merchandise only)';

-- -----------------------------------------------------------------------------
-- 2. Add merchandise_items_snapshot for merchandise ARs (JSONB)
-- -----------------------------------------------------------------------------
ALTER TABLE public.acknowledgement_receiptstbl
  ADD COLUMN IF NOT EXISTS merchandise_items_snapshot JSONB DEFAULT NULL;

COMMENT ON COLUMN public.acknowledgement_receiptstbl.merchandise_items_snapshot
  IS 'For Merchandise AR: snapshot of purchased items [{merchandise_id, merchandise_name, size, quantity, price, branch_id}]';

-- -----------------------------------------------------------------------------
-- 3. Make package fields nullable for merchandise ARs
-- -----------------------------------------------------------------------------
ALTER TABLE public.acknowledgement_receiptstbl
  ALTER COLUMN package_id DROP NOT NULL;

ALTER TABLE public.acknowledgement_receiptstbl
  ALTER COLUMN package_name_snapshot DROP NOT NULL;

ALTER TABLE public.acknowledgement_receiptstbl
  ALTER COLUMN package_amount_snapshot DROP NOT NULL;

-- Drop FK constraint on package_id to allow NULL, then re-add as optional
ALTER TABLE public.acknowledgement_receiptstbl
  DROP CONSTRAINT IF EXISTS ack_receipts_package_id_fkey;

ALTER TABLE public.acknowledgement_receiptstbl
  ADD CONSTRAINT ack_receipts_package_id_fkey
  FOREIGN KEY (package_id) REFERENCES public.packagestbl (package_id)
  ON UPDATE NO ACTION ON DELETE RESTRICT;

-- -----------------------------------------------------------------------------
-- 4. Add ack_receipt_id to invoicestbl (link invoice back to AR for merchandise)
-- -----------------------------------------------------------------------------
ALTER TABLE public.invoicestbl
  ADD COLUMN IF NOT EXISTS ack_receipt_id INTEGER DEFAULT NULL;

ALTER TABLE public.invoicestbl
  DROP CONSTRAINT IF EXISTS invoicestbl_ack_receipt_id_fkey;

ALTER TABLE public.invoicestbl
  ADD CONSTRAINT invoicestbl_ack_receipt_id_fkey
  FOREIGN KEY (ack_receipt_id) REFERENCES public.acknowledgement_receiptstbl (ack_receipt_id)
  ON UPDATE NO ACTION ON DELETE SET NULL;

COMMENT ON COLUMN public.invoicestbl.ack_receipt_id
  IS 'Links invoice to acknowledgement receipt (for merchandise AR auto-generated invoices)';

CREATE INDEX IF NOT EXISTS idx_invoicestbl_ack_receipt_id
  ON public.invoicestbl(ack_receipt_id);
