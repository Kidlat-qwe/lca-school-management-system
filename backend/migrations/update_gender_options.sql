-- Migration: Update gender options to remove Boys and Girls
-- Description: Keep only Men, Women, and Unisex as valid gender options
-- Date: 2026-01-15

-- Step 1: Drop existing constraints
ALTER TABLE merchandisestbl 
DROP CONSTRAINT IF EXISTS check_gender;

ALTER TABLE merchandiserequestlogtbl 
DROP CONSTRAINT IF EXISTS check_request_gender;

-- Step 2: Add updated constraints with only Men, Women, Unisex
ALTER TABLE merchandisestbl 
ADD CONSTRAINT check_gender CHECK (gender IN ('Men', 'Women', 'Unisex') OR gender IS NULL);

ALTER TABLE merchandiserequestlogtbl 
ADD CONSTRAINT check_request_gender CHECK (gender IN ('Men', 'Women', 'Unisex') OR gender IS NULL);

-- Step 3: Update any existing Boys/Girls records to NULL (optional - comment out if you want to keep them)
-- UPDATE merchandisestbl SET gender = NULL WHERE gender IN ('Boys', 'Girls');
-- UPDATE merchandiserequestlogtbl SET gender = NULL WHERE gender IN ('Boys', 'Girls');

-- Step 4: Verify constraints
SELECT 
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conname IN ('check_gender', 'check_request_gender');

-- Note: If you have existing records with 'Boys' or 'Girls', you may need to update or delete them before running this migration.
-- Check for existing Boys/Girls records:
SELECT 'merchandisestbl' as table_name, COUNT(*) as count FROM merchandisestbl WHERE gender IN ('Boys', 'Girls')
UNION ALL
SELECT 'merchandiserequestlogtbl' as table_name, COUNT(*) as count FROM merchandiserequestlogtbl WHERE gender IN ('Boys', 'Girls');
