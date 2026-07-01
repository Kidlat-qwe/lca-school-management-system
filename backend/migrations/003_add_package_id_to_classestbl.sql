-- Migration: Add package_id column to classestbl
-- Date: 2024
-- Description: Adds package_id foreign key to classestbl to link classes with packages
-- 
-- IMPORTANT: Backup your database before running this migration!

BEGIN;

-- Step 1: Add package_id column to classestbl
ALTER TABLE public.classestbl
ADD COLUMN IF NOT EXISTS package_id integer;

-- Step 2: Add foreign key constraint
ALTER TABLE public.classestbl
ADD CONSTRAINT classestbl_package_id_fkey 
FOREIGN KEY (package_id)
REFERENCES public.packagestbl (package_id)
MATCH SIMPLE
ON UPDATE NO ACTION
ON DELETE NO ACTION;

-- Step 3: Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_class_package_id
ON public.classestbl(package_id);

COMMIT;

