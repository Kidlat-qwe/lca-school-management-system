BEGIN;

-- Add package_price column to packagestbl
ALTER TABLE public.packagestbl
ADD COLUMN IF NOT EXISTS package_price numeric(10, 2);

-- Copy package_price from packagedetailstbl to packagestbl
-- If a package has multiple details, we'll use the first non-null package_price
-- If multiple details have different prices, we'll use the first one found
UPDATE public.packagestbl p
SET package_price = (
    SELECT pd.package_price
    FROM public.packagedetailstbl pd
    WHERE pd.package_id = p.package_id
      AND pd.package_price IS NOT NULL
    ORDER BY pd.packagedtl_id
    LIMIT 1
)
WHERE EXISTS (
    SELECT 1
    FROM public.packagedetailstbl pd
    WHERE pd.package_id = p.package_id
      AND pd.package_price IS NOT NULL
);

-- Remove package_price column from packagedetailstbl
ALTER TABLE public.packagedetailstbl
DROP COLUMN IF EXISTS package_price;

COMMIT;

