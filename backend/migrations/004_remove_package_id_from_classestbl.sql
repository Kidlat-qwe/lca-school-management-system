-- Migration: Remove package_id column from classestbl
-- Date: 2024
-- Description: Removes package_id column and its foreign key constraint from classestbl
-- 
-- IMPORTANT: Backup your database before running this migration!

BEGIN;

-- Step 1: Drop the foreign key constraint
ALTER TABLE public.classestbl
DROP CONSTRAINT IF EXISTS classestbl_package_id_fkey;

-- Step 2: Drop the index
DROP INDEX IF EXISTS idx_class_package_id;

-- Step 3: Drop the package_id column
ALTER TABLE public.classestbl
DROP COLUMN IF EXISTS package_id;

COMMIT;

