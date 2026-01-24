BEGIN;

-- Migration: Rename section_name to class_name in classestbl
-- Date: 2024
-- Description: Renames the section_name column to class_name to better reflect its purpose
-- 
-- IMPORTANT: Backup your database before running this migration!

-- Step 1: Rename the column
ALTER TABLE public.classestbl
RENAME COLUMN section_name TO class_name;

-- Step 2: Update any comments if they exist
COMMENT ON COLUMN public.classestbl.class_name IS 'The name of the class (e.g., "Morning Class", "Section A")';

COMMIT;

