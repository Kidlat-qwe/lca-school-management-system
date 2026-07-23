-- Migration 129: Align merchandisestbl gender/type CHECKs with RHET Inventory labels.
-- Also allow Blouse/Skirt pieces. Apply manually (psql / Coolify DB shell).
-- Safe to re-run.
--
-- Canonical values going forward:
--   gender: Male | Female | Unisex (legacy Men/Women still accepted until data migrated)
--   type: Polo | Short | Blouse | Skirt | Shirt | Pants | Top | Bottom
--
-- Optional data rewrite is in scripts/migrateMerchandiseLabelsToRhet.js

BEGIN;

ALTER TABLE public.merchandisestbl
  DROP CONSTRAINT IF EXISTS check_gender;

ALTER TABLE public.merchandisestbl
  ADD CONSTRAINT check_gender
  CHECK (
    gender IS NULL
    OR gender IN ('Male', 'Female', 'Unisex', 'Men', 'Women', 'Boys', 'Girls')
  );

ALTER TABLE public.merchandisestbl
  DROP CONSTRAINT IF EXISTS check_type;

ALTER TABLE public.merchandisestbl
  ADD CONSTRAINT check_type
  CHECK (
    type IS NULL
    OR type IN ('Polo', 'Short', 'Blouse', 'Skirt', 'Shirt', 'Pants', 'Top', 'Bottom')
  );

ALTER TABLE public.merchandiserequestlogtbl
  DROP CONSTRAINT IF EXISTS check_request_gender;

ALTER TABLE public.merchandiserequestlogtbl
  ADD CONSTRAINT check_request_gender
  CHECK (
    gender IS NULL
    OR gender IN ('Male', 'Female', 'Unisex', 'Men', 'Women', 'Boys', 'Girls')
  );

ALTER TABLE public.merchandiserequestlogtbl
  DROP CONSTRAINT IF EXISTS check_request_type;

ALTER TABLE public.merchandiserequestlogtbl
  ADD CONSTRAINT check_request_type
  CHECK (
    type IS NULL
    OR type IN ('Polo', 'Short', 'Blouse', 'Skirt', 'Shirt', 'Pants', 'Top', 'Bottom')
  );

COMMIT;
