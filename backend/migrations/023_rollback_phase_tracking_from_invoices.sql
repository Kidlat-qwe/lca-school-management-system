BEGIN;

-- Drop foreign key constraint
ALTER TABLE IF EXISTS public.invoicestbl
    DROP CONSTRAINT IF EXISTS invoicestbl_installmentinvoiceprofiles_id_fkey;

-- Drop indexes
DROP INDEX IF EXISTS public.idx_invoice_phase_number;
DROP INDEX IF EXISTS public.idx_invoice_installment_profile_id;

-- Drop columns
ALTER TABLE IF EXISTS public.invoicestbl
    DROP COLUMN IF EXISTS phase_number;

ALTER TABLE IF EXISTS public.invoicestbl
    DROP COLUMN IF EXISTS installmentinvoiceprofiles_id;

COMMIT;

