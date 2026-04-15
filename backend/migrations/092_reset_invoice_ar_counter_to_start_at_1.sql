-- Corrective migration:
-- reset yearly AR counter based on invoice_ar_number only so invoices start at YY0001.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ar_number_counter (
  year smallint NOT NULL PRIMARY KEY,
  last_value integer NOT NULL DEFAULT 0
);

WITH invoice_vals AS (
  SELECT invoice_ar_number AS ar_num
  FROM public.invoicestbl
  WHERE invoice_ar_number ~ '^\d{6}$'
), parsed AS (
  SELECT
    ('20' || substring(ar_num FROM 1 FOR 2))::int AS year,
    substring(ar_num FROM 3 FOR 4)::int AS seq
  FROM invoice_vals
), maxima AS (
  SELECT year::smallint AS year, MAX(seq)::int AS max_seq
  FROM parsed
  GROUP BY year
), current_year AS (
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::smallint AS year
)
INSERT INTO public.ar_number_counter (year, last_value)
SELECT cy.year, COALESCE(m.max_seq, 0)
FROM current_year cy
LEFT JOIN maxima m ON m.year = cy.year
ON CONFLICT (year) DO UPDATE
SET last_value = EXCLUDED.last_value;

COMMIT;
