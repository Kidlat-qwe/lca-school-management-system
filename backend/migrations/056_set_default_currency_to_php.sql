-- Migration: Set default currency to PHP for all branches
-- This migration:
-- 1. Updates all existing branches with NULL currency to 'PHP'
-- 2. Sets the default value for the currency column to 'PHP'

BEGIN;

-- Update all existing branches with NULL currency to 'PHP'
UPDATE branchestbl 
SET currency = 'PHP' 
WHERE currency IS NULL;

-- Set default value for currency column to 'PHP'
ALTER TABLE branchestbl 
ALTER COLUMN currency SET DEFAULT 'PHP';

COMMIT;
