BEGIN;

-- Add remarks column to merchandiserequestlogtbl for gender/type identification (e.g., "Men - Top", "Women - Bottom")
ALTER TABLE public.merchandiserequestlogtbl
ADD COLUMN IF NOT EXISTS remarks TEXT;

-- Add comment
COMMENT ON COLUMN public.merchandiserequestlogtbl.remarks
    IS 'Additional remarks for merchandise requests, especially for uniforms to identify gender and type (e.g., "Men - Top", "Women - Bottom", "Boys - Complete Set")';

COMMIT;

