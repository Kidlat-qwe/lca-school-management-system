-- DepEd header fields per branch for lesson plan documents.
-- School ID stays application-constant (not stored per branch).

ALTER TABLE public.branchestbl
  ADD COLUMN IF NOT EXISTS deped_region VARCHAR(100),
  ADD COLUMN IF NOT EXISTS deped_division VARCHAR(100),
  ADD COLUMN IF NOT EXISTS deped_district VARCHAR(100);

COMMENT ON COLUMN public.branchestbl.deped_region IS
  'DepEd Region shown on lesson plan header (e.g. Region III).';
COMMENT ON COLUMN public.branchestbl.deped_division IS
  'DepEd Division shown on lesson plan header (e.g. Bulacan).';
COMMENT ON COLUMN public.branchestbl.deped_district IS
  'DepEd District shown on lesson plan header (e.g. City of Malolos).';

-- Seed known branches (safe re-run: only fills empty values).
UPDATE public.branchestbl SET
  deped_region = COALESCE(NULLIF(TRIM(deped_region), ''), 'Region III'),
  deped_division = COALESCE(NULLIF(TRIM(deped_division), ''), 'Bulacan'),
  deped_district = COALESCE(NULLIF(TRIM(deped_district), ''), 'City of Malolos')
WHERE branch_id = 1
   OR LOWER(COALESCE(branch_nickname, '') || ' ' || COALESCE(branch_name, '') || ' ' || COALESCE(city, ''))
      LIKE '%malolos%';

UPDATE public.branchestbl SET
  deped_region = COALESCE(NULLIF(TRIM(deped_region), ''), 'Region IV-A'),
  deped_division = COALESCE(NULLIF(TRIM(deped_division), ''), 'Cavite'),
  deped_district = COALESCE(NULLIF(TRIM(deped_district), ''), 'Bacoor City')
WHERE branch_id = 2
   OR LOWER(COALESCE(branch_nickname, '') || ' ' || COALESCE(branch_name, '') || ' ' || COALESCE(city, ''))
      LIKE '%cavite%'
   OR LOWER(COALESCE(city, '')) LIKE '%bacoor%';

-- Any remaining branches: Central Luzon / Bulacan defaults (Guiguinto-style).
UPDATE public.branchestbl SET
  deped_region = COALESCE(NULLIF(TRIM(deped_region), ''), 'Region III'),
  deped_division = COALESCE(
    NULLIF(TRIM(deped_division), ''),
    NULLIF(TRIM(state_province_region), ''),
    'Bulacan'
  ),
  deped_district = COALESCE(NULLIF(TRIM(deped_district), ''), '5th District')
WHERE deped_region IS NULL
   OR NULLIF(TRIM(deped_region), '') IS NULL
   OR deped_division IS NULL
   OR NULLIF(TRIM(deped_division), '') IS NULL
   OR deped_district IS NULL
   OR NULLIF(TRIM(deped_district), '') IS NULL;
