-- Migration: Add is_included column to packagedetailstbl
-- Description: This column distinguishes between freebies (included in package price) and paid merchandise (additional cost)
-- Date: 2025-01-XX

-- Check if column already exists before adding
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'packagedetailstbl' 
        AND column_name = 'is_included'
    ) THEN
        -- Add the is_included column with default value true (meaning included/freebie by default)
        ALTER TABLE public.packagedetailstbl 
        ADD COLUMN is_included BOOLEAN DEFAULT true NOT NULL;
        
        -- Add a comment to explain the column
        COMMENT ON COLUMN public.packagedetailstbl.is_included IS 
        'Indicates if merchandise is included in package price (true = freebie/included, false = paid/additional cost)';
        
        RAISE NOTICE 'Column is_included added successfully to packagedetailstbl';
    ELSE
        RAISE NOTICE 'Column is_included already exists in packagedetailstbl';
    END IF;
END $$;

-- Verify the column was added
SELECT 
    column_name, 
    data_type, 
    column_default, 
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'packagedetailstbl' 
AND column_name = 'is_included';

