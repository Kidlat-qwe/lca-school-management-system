BEGIN;

-- Add promo_id column to invoicestbl
ALTER TABLE public.invoicestbl
ADD COLUMN IF NOT EXISTS promo_id integer;

-- Add foreign key constraint
ALTER TABLE public.invoicestbl
ADD CONSTRAINT invoicestbl_promo_id_fkey 
FOREIGN KEY (promo_id) 
REFERENCES public.promostbl(promo_id) 
ON UPDATE NO ACTION 
ON DELETE SET NULL;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_invoice_promo_id 
ON public.invoicestbl(promo_id);

-- Add comment
COMMENT ON COLUMN public.invoicestbl.promo_id 
IS 'Links invoice to promo that was applied. Used to track promo usage and discounts.';

COMMIT;

