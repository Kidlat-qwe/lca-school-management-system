-- Migration 133: Store RHET itemName/sku on branch stock rows (non-uniform + Learning Kit).
-- merchandise_name remains the CMS TYPE / RHET categoryName (e.g. Workbooks, Backpack).
-- item_name holds the concrete product (e.g. nc-pk-worksheets, lca-backpack).
-- Safe to re-run.

BEGIN;

ALTER TABLE public.merchandisestbl
  ADD COLUMN IF NOT EXISTS item_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS sku VARCHAR(64);

COMMENT ON COLUMN public.merchandisestbl.item_name IS
  'RHET itemName for non-uniform / Learning Kit rows under merchandise_name (category). Never used as CMS type title.';

COMMENT ON COLUMN public.merchandisestbl.sku IS
  'Optional RHET SKU for the concrete stock item (item_name).';

-- Best-effort backfill from legacy Learning Kit / non-uniform remarks "itemName | sku"
UPDATE public.merchandisestbl
SET
  item_name = NULLIF(TRIM(SPLIT_PART(remarks, '|', 1)), ''),
  sku = NULLIF(TRIM(SPLIT_PART(remarks, '|', 2)), '')
WHERE (item_name IS NULL OR TRIM(item_name) = '')
  AND remarks IS NOT NULL
  AND remarks LIKE '%|%'
  AND gender IS NULL
  AND type IS NULL
  AND size IS NULL;

COMMIT;
