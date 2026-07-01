-- Migration: Remove 'Complete Set' from type options
-- Description: Keep only Top and Bottom as valid type options
-- Date: 2026-01-15

-- Step 1: Drop existing constraints
ALTER TABLE merchandisestbl 
DROP CONSTRAINT IF EXISTS check_type;

ALTER TABLE merchandiserequestlogtbl 
DROP CONSTRAINT IF EXISTS check_request_type;

-- Step 2: Add updated constraints with only Top and Bottom
ALTER TABLE merchandisestbl 
ADD CONSTRAINT check_type CHECK (type IN ('Top', 'Bottom') OR type IS NULL);

ALTER TABLE merchandiserequestlogtbl 
ADD CONSTRAINT check_request_type CHECK (type IN ('Top', 'Bottom') OR type IS NULL);

-- Step 3: Update any existing 'Complete Set' records to NULL (optional)
-- UPDATE merchandisestbl SET type = NULL WHERE type = 'Complete Set';
-- UPDATE merchandiserequestlogtbl SET type = NULL WHERE type = 'Complete Set';

-- Step 4: Verify constraints
SELECT 
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conname IN ('check_type', 'check_request_type');

-- Step 5: Check for existing 'Complete Set' records
SELECT 'merchandisestbl' as table_name, COUNT(*) as count FROM merchandisestbl WHERE type = 'Complete Set'
UNION ALL
SELECT 'merchandiserequestlogtbl' as table_name, COUNT(*) as count FROM merchandiserequestlogtbl WHERE type = 'Complete Set';
