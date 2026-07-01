-- Migration: Add gender and type columns to merchandiserequestlogtbl
-- Description: Add structured gender and type fields to match merchandisestbl
-- Date: 2026-01-15

-- Step 1: Add new columns
ALTER TABLE merchandiserequestlogtbl 
ADD COLUMN gender VARCHAR(20),
ADD COLUMN type VARCHAR(30);

-- Step 2: Add constraints
ALTER TABLE merchandiserequestlogtbl 
ADD CONSTRAINT check_request_gender CHECK (gender IN ('Men', 'Women', 'Boys', 'Girls', 'Unisex') OR gender IS NULL);

ALTER TABLE merchandiserequestlogtbl 
ADD CONSTRAINT check_request_type CHECK (type IN ('Top', 'Bottom', 'Complete Set') OR type IS NULL);

-- Step 3: Drop remarks column if it exists
ALTER TABLE merchandiserequestlogtbl 
DROP COLUMN IF EXISTS remarks;

-- Step 4: Verify
SELECT 
  request_id,
  merchandise_name,
  gender,
  type,
  size,
  requested_quantity,
  status
FROM merchandiserequestlogtbl
ORDER BY created_at DESC
LIMIT 10;
