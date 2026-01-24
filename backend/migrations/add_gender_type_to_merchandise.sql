-- Migration: Add gender and type columns to merchandisestbl
-- Description: Replace remarks field with structured gender and type fields
-- Date: 2026-01-15

-- Step 1: Add new columns
ALTER TABLE merchandisestbl 
ADD COLUMN gender VARCHAR(20),
ADD COLUMN type VARCHAR(30);

-- Step 2: Migrate existing data from remarks to new columns
-- This is a best-effort migration for common patterns
UPDATE merchandisestbl
SET 
  gender = CASE
    WHEN remarks ILIKE '%men%' AND NOT remarks ILIKE '%women%' THEN 'Men'
    WHEN remarks ILIKE '%women%' AND NOT remarks ILIKE '%men%' THEN 'Women'
    WHEN remarks ILIKE '%boy%' THEN 'Boys'
    WHEN remarks ILIKE '%girl%' THEN 'Girls'
    WHEN remarks ILIKE '%unisex%' THEN 'Unisex'
    ELSE NULL
  END,
  type = CASE
    WHEN remarks ILIKE '%top%' THEN 'Top'
    WHEN remarks ILIKE '%bottom%' THEN 'Bottom'
    WHEN remarks ILIKE '%complete%' OR remarks ILIKE '%set%' THEN 'Complete Set'
    ELSE NULL
  END
WHERE remarks IS NOT NULL;

-- Step 3: Add constraints
ALTER TABLE merchandisestbl 
ADD CONSTRAINT check_gender CHECK (gender IN ('Men', 'Women', 'Boys', 'Girls', 'Unisex') OR gender IS NULL);

ALTER TABLE merchandisestbl 
ADD CONSTRAINT check_type CHECK (type IN ('Top', 'Bottom', 'Complete Set') OR type IS NULL);

-- Step 4: Drop remarks column
ALTER TABLE merchandisestbl 
DROP COLUMN remarks;

-- Step 5: Verify migration
SELECT 
  merchandise_id,
  merchandise_name,
  gender,
  type,
  size,
  quantity,
  price
FROM merchandisestbl
ORDER BY merchandise_name, gender, type, size
LIMIT 20;

-- Note: Review the migrated data and manually update any records that weren't correctly parsed
