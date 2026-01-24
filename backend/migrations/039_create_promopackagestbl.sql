BEGIN;

-- Create promopackagestbl (Junction Table for Promo-Package Many-to-Many Relationship)
CREATE TABLE IF NOT EXISTS public.promopackagestbl
(
    promopackage_id serial NOT NULL,
    promo_id integer NOT NULL,
    package_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT promopackagestbl_pkey PRIMARY KEY (promopackage_id),
    CONSTRAINT promopackagestbl_promo_id_fkey FOREIGN KEY (promo_id)
        REFERENCES public.promostbl (promo_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT promopackagestbl_package_id_fkey FOREIGN KEY (package_id)
        REFERENCES public.packagestbl (package_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT promopackagestbl_unique_promo_package UNIQUE (promo_id, package_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_promopackage_promo_id ON public.promopackagestbl(promo_id);
CREATE INDEX IF NOT EXISTS idx_promopackage_package_id ON public.promopackagestbl(package_id);

COMMENT ON TABLE public.promopackagestbl IS 'Junction table for many-to-many relationship between promos and packages. Allows one promo to apply to multiple packages.';
COMMENT ON COLUMN public.promopackagestbl.promo_id IS 'Reference to the promo';
COMMENT ON COLUMN public.promopackagestbl.package_id IS 'Reference to the package that this promo applies to';

-- Migrate existing data from promostbl.package_id to promopackagestbl
-- This ensures backward compatibility with existing promos
INSERT INTO public.promopackagestbl (promo_id, package_id)
SELECT promo_id, package_id
FROM public.promostbl
WHERE package_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.promopackagestbl pp
    WHERE pp.promo_id = promostbl.promo_id
      AND pp.package_id = promostbl.package_id
  );

-- Make package_id nullable in promostbl for backward compatibility
-- We'll keep it for now but the junction table is the source of truth
-- Note: We're not dropping the column or constraint to maintain backward compatibility
-- The backend will use promopackagestbl going forward

COMMIT;

