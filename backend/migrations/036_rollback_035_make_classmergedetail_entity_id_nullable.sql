BEGIN;

-- Rollback: Restore NOT NULL constraint on entity_id in classmergedetailstbl
-- Note: This will fail if there are any NULL values in entity_id column.
-- If NULL values exist, they must be handled before running this rollback.

-- First, check and handle any NULL values (optional - uncomment if needed)
-- DELETE FROM public.classmergedetailstbl WHERE entity_id IS NULL;

ALTER TABLE public.classmergedetailstbl
ALTER COLUMN entity_id SET NOT NULL;

COMMIT;

