BEGIN;

-- Rollback: Drop class merge tables and all associated objects
-- This removes the class merge tracking functionality completely

-- Drop indexes first (in reverse order of creation)
DROP INDEX IF EXISTS public.idx_classmergedetail_to_class_id;
DROP INDEX IF EXISTS public.idx_classmergedetail_from_class_id;
DROP INDEX IF EXISTS public.idx_classmergedetail_entity_id;
DROP INDEX IF EXISTS public.idx_classmergedetail_entity_type;
DROP INDEX IF EXISTS public.idx_classmergedetail_merge_id;
DROP INDEX IF EXISTS public.idx_classmerge_merged_at;
DROP INDEX IF EXISTS public.idx_classmerge_status;
DROP INDEX IF EXISTS public.idx_classmerge_merged_class_id;

-- Drop tables (child table first due to foreign key constraint)
-- CASCADE will automatically drop dependent objects if any exist
DROP TABLE IF EXISTS public.classmergedetailstbl CASCADE;
DROP TABLE IF EXISTS public.classmergetbl CASCADE;

COMMIT;

