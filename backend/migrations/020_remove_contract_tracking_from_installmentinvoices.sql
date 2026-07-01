BEGIN;

-- Remove generated_count and contract_months from installmentinvoiceprofilestbl
ALTER TABLE IF EXISTS public.installmentinvoiceprofilestbl
    DROP COLUMN IF EXISTS generated_count;

ALTER TABLE IF EXISTS public.installmentinvoiceprofilestbl
    DROP COLUMN IF EXISTS contract_months;

COMMIT;

