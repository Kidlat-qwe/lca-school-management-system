-- 059_add_installment_promo_scope_fields.sql
-- Adds fields to support promo application scope for installment packages:
-- - promostbl: installment_apply_scope and installment_months_to_apply
-- - installmentinvoiceprofilestbl: promo tracking fields
-- - promousagetbl: package_id and scope tracking fields, update unique constraint
BEGIN;

-- Add promo scope fields to promostbl
ALTER TABLE public.promostbl
ADD COLUMN IF NOT EXISTS installment_apply_scope character varying(50) COLLATE pg_catalog."default",
ADD COLUMN IF NOT EXISTS installment_months_to_apply integer;

COMMENT ON COLUMN public.promostbl.installment_apply_scope
    IS 'For Installment packages: downpayment, monthly, or both. NULL for non-installment promos.';
COMMENT ON COLUMN public.promostbl.installment_months_to_apply
    IS 'Number of monthly invoices to apply promo discount. Required when scope includes monthly.';

-- Add promo tracking fields to installmentinvoiceprofilestbl
ALTER TABLE public.installmentinvoiceprofilestbl
ADD COLUMN IF NOT EXISTS promo_id integer,
ADD COLUMN IF NOT EXISTS promo_apply_scope character varying(50) COLLATE pg_catalog."default",
ADD COLUMN IF NOT EXISTS promo_months_to_apply integer,
ADD COLUMN IF NOT EXISTS promo_months_applied integer DEFAULT 0;

COMMENT ON COLUMN public.installmentinvoiceprofilestbl.promo_id
    IS 'Reference to promo applied during enrollment. Used to apply discounts to monthly invoices.';
COMMENT ON COLUMN public.installmentinvoiceprofilestbl.promo_apply_scope
    IS 'Snapshot of promo scope: downpayment, monthly, or both.';
COMMENT ON COLUMN public.installmentinvoiceprofilestbl.promo_months_to_apply
    IS 'Number of monthly invoices to apply promo discount.';
COMMENT ON COLUMN public.installmentinvoiceprofilestbl.promo_months_applied
    IS 'Counter tracking how many monthly invoices have received promo discount.';

-- Add foreign key constraint for promo_id in installmentinvoiceprofilestbl
ALTER TABLE IF EXISTS public.installmentinvoiceprofilestbl
ADD CONSTRAINT installmentinvoiceprofilestbl_promo_id_fkey FOREIGN KEY (promo_id)
REFERENCES public.promostbl (promo_id) MATCH SIMPLE
ON UPDATE NO ACTION
ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_installmentprofile_promo_id
ON public.installmentinvoiceprofilestbl(promo_id);

-- Add package_id and scope tracking to promousagetbl
ALTER TABLE public.promousagetbl
ADD COLUMN IF NOT EXISTS package_id integer,
ADD COLUMN IF NOT EXISTS apply_scope character varying(50) COLLATE pg_catalog."default",
ADD COLUMN IF NOT EXISTS months_to_apply integer;

COMMENT ON COLUMN public.promousagetbl.package_id
    IS 'Package ID where promo was used. Enables per-student-per-package usage tracking.';
COMMENT ON COLUMN public.promousagetbl.apply_scope
    IS 'Snapshot of promo scope when used: downpayment, monthly, or both.';
COMMENT ON COLUMN public.promousagetbl.months_to_apply
    IS 'Snapshot of months_to_apply when promo was used.';

-- Add foreign key constraint for package_id in promousagetbl
ALTER TABLE IF EXISTS public.promousagetbl
ADD CONSTRAINT promousagetbl_package_id_fkey FOREIGN KEY (package_id)
REFERENCES public.packagestbl (package_id) MATCH SIMPLE
ON UPDATE NO ACTION
ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_promousage_package_id
ON public.promousagetbl(package_id);

-- Backfill package_id in promousagetbl from invoices (best-effort)
UPDATE public.promousagetbl pu
SET package_id = i.package_id
FROM public.invoicestbl i
WHERE pu.invoice_id = i.invoice_id
  AND i.package_id IS NOT NULL
  AND pu.package_id IS NULL;

-- Drop old unique constraint (promo_id, student_id)
ALTER TABLE public.promousagetbl
DROP CONSTRAINT IF EXISTS promousagetbl_unique_student_promo;

-- Create new unique constraint (promo_id, student_id, package_id)
-- Note: This allows same student to use same promo on different packages
ALTER TABLE public.promousagetbl
ADD CONSTRAINT promousagetbl_unique_student_promo_package UNIQUE (promo_id, student_id, package_id);

COMMIT;
