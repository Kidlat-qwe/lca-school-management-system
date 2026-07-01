BEGIN;

-- Add phase tracking columns to installmentinvoiceprofilestbl
ALTER TABLE IF EXISTS public.installmentinvoiceprofilestbl
    ADD COLUMN IF NOT EXISTS class_id integer;

ALTER TABLE IF EXISTS public.installmentinvoiceprofilestbl
    ADD COLUMN IF NOT EXISTS total_phases integer;

ALTER TABLE IF EXISTS public.installmentinvoiceprofilestbl
    ADD COLUMN IF NOT EXISTS generated_count integer DEFAULT 0;

-- Add foreign key constraint for class_id
ALTER TABLE IF EXISTS public.installmentinvoiceprofilestbl
    ADD CONSTRAINT installmentinvoiceprofilestbl_class_id_fkey FOREIGN KEY (class_id)
    REFERENCES public.classestbl (class_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_installmentinvoiceprofile_class_id
    ON public.installmentinvoiceprofilestbl(class_id);

COMMENT ON COLUMN public.installmentinvoiceprofilestbl.class_id IS 'The class the student is enrolled in. Used to determine total phases from curriculum.';
COMMENT ON COLUMN public.installmentinvoiceprofilestbl.total_phases IS 'Total number of phases in the curriculum. Determines how many invoices should be generated.';
COMMENT ON COLUMN public.installmentinvoiceprofilestbl.generated_count IS 'Number of invoices generated so far. Generation stops when this reaches total_phases.';

COMMIT;

