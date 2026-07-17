BEGIN;

-- Allow school/PE uniform piece labels on merchandise stock and stock requests.
-- School: Polo, Short | PE: Shirt, Pants | Legacy: Top, Bottom

ALTER TABLE public.merchandisestbl
  DROP CONSTRAINT IF EXISTS check_type;

ALTER TABLE public.merchandisestbl
  ADD CONSTRAINT check_type
  CHECK (
    type IS NULL
    OR type IN ('Polo', 'Short', 'Shirt', 'Pants', 'Top', 'Bottom')
  );

ALTER TABLE public.merchandiserequestlogtbl
  DROP CONSTRAINT IF EXISTS check_request_type;

ALTER TABLE public.merchandiserequestlogtbl
  ADD CONSTRAINT check_request_type
  CHECK (
    type IS NULL
    OR type IN ('Polo', 'Short', 'Shirt', 'Pants', 'Top', 'Bottom')
  );

COMMIT;
