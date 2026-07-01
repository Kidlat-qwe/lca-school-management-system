BEGIN;

-- Add column to link invoices to installment invoice profiles
-- This allows us to track which invoices came from installment invoices
ALTER TABLE IF EXISTS public.invoicestbl
    ADD COLUMN IF NOT EXISTS installmentinvoiceprofiles_id integer;

-- Add foreign key constraint
ALTER TABLE IF EXISTS public.invoicestbl
    ADD CONSTRAINT invoicestbl_installmentinvoiceprofiles_id_fkey FOREIGN KEY (installmentinvoiceprofiles_id)
    REFERENCES public.installmentinvoiceprofilestbl (installmentinvoiceprofiles_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_invoice_installment_profile_id
    ON public.invoicestbl(installmentinvoiceprofiles_id);

COMMENT ON COLUMN public.invoicestbl.installmentinvoiceprofiles_id IS 'Links invoice to installment invoice profile. Used to track installment payments and auto-progress student phases.';

COMMIT;

