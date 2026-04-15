-- Add optional AR# on invoices.
-- Existing invoices remain NULL; only newly-created invoices are assigned AR#.

BEGIN;

ALTER TABLE public.invoicestbl
  ADD COLUMN IF NOT EXISTS invoice_ar_number VARCHAR(50);

-- Keep uniqueness only for non-null values so historical invoices can stay null.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoicestbl_invoice_ar_number
  ON public.invoicestbl (invoice_ar_number)
  WHERE invoice_ar_number IS NOT NULL;

COMMENT ON COLUMN public.invoicestbl.invoice_ar_number IS
  'AR#: 2-digit year + 4-digit sequence (e.g. 260001). Existing legacy invoices may be NULL.';

COMMIT;
