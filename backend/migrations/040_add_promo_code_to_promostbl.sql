BEGIN;

-- Add promo_code column to promostbl (nullable, unique)
ALTER TABLE public.promostbl
    ADD COLUMN IF NOT EXISTS promo_code VARCHAR(50);

-- Add unique constraint (only for non-null values)
-- PostgreSQL unique constraint allows multiple NULLs, which is what we want
CREATE UNIQUE INDEX IF NOT EXISTS promostbl_promo_code_key 
    ON public.promostbl(promo_code) 
    WHERE promo_code IS NOT NULL;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_promo_code ON public.promostbl(promo_code) 
    WHERE promo_code IS NOT NULL;

-- Add comment
COMMENT ON COLUMN public.promostbl.promo_code
    IS 'Optional promo code for redemption. NULL = auto-apply promo, set value = requires code entry for redemption';

COMMIT;

