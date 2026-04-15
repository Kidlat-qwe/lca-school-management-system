-- AR# format: YY + 4-digit sequence per calendar year (e.g. 260001).
-- Shared counter for invoices and acknowledgement receipts.
-- Existing invoices are intentionally left NULL.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ar_number_counter (
  year smallint NOT NULL PRIMARY KEY,
  last_value integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.ar_number_counter IS
  'Yearly sequence for YY + 4-digit AR numbers (shared across invoices and acknowledgement receipts).';

-- Seed counter from any existing YY#### values (invoice or acknowledgement receipt).
WITH ar_values AS (
  SELECT invoice_ar_number AS ar_num
  FROM public.invoicestbl
  WHERE invoice_ar_number ~ '^\d{6}$'
  UNION ALL
  SELECT ack_receipt_number AS ar_num
  FROM public.acknowledgement_receiptstbl
  WHERE ack_receipt_number ~ '^\d{6}$'
), parsed AS (
  SELECT
    ('20' || substring(ar_num FROM 1 FOR 2))::int AS year,
    substring(ar_num FROM 3 FOR 4)::int AS seq
  FROM ar_values
)
INSERT INTO public.ar_number_counter (year, last_value)
SELECT year::smallint, MAX(seq)::int
FROM parsed
GROUP BY year
ON CONFLICT (year) DO UPDATE
SET last_value = GREATEST(ar_number_counter.last_value, EXCLUDED.last_value);

COMMENT ON COLUMN public.invoicestbl.invoice_ar_number IS
  'AR#: 2-digit year + 4-digit sequence (e.g. 260001). Existing legacy invoices may be NULL.';

COMMIT;
