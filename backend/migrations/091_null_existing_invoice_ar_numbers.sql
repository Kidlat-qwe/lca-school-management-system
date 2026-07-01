-- Corrective migration for environments that already ran earlier AR# backfill.
-- Requirement: existing invoices should have NULL invoice_ar_number.

BEGIN;

-- invoice_ar_number must be optional for historical rows.
ALTER TABLE public.invoicestbl
  ALTER COLUMN invoice_ar_number DROP NOT NULL;

-- Replace full unique index with partial unique index (non-null only).
DROP INDEX IF EXISTS idx_invoicestbl_invoice_ar_number;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoicestbl_invoice_ar_number
  ON public.invoicestbl (invoice_ar_number)
  WHERE invoice_ar_number IS NOT NULL;

-- Null out all currently existing invoice AR numbers.
UPDATE public.invoicestbl
SET invoice_ar_number = NULL
WHERE invoice_ar_number IS NOT NULL;

-- Ensure counter table exists for next allocations.
CREATE TABLE IF NOT EXISTS public.ar_number_counter (
  year smallint NOT NULL PRIMARY KEY,
  last_value integer NOT NULL DEFAULT 0
);

COMMIT;
