-- Migration: Add day_of_week column to roomschedtbl
-- Description: Adds day_of_week column to support day-based room scheduling
-- Date: 2024
-- 
-- IMPORTANT: Backup your database before running this migration!

BEGIN;

-- Step 1: Add day_of_week column to roomschedtbl
ALTER TABLE roomschedtbl 
ADD COLUMN IF NOT EXISTS day_of_week character varying(20);

-- Step 2: Make class_id nullable (allow schedules without classes)
ALTER TABLE roomschedtbl 
ALTER COLUMN class_id DROP NOT NULL;

-- Step 3: Make day_of_week NOT NULL
ALTER TABLE roomschedtbl 
ALTER COLUMN day_of_week SET NOT NULL;

-- Step 4: Drop the existing primary key constraint
ALTER TABLE roomschedtbl 
DROP CONSTRAINT IF EXISTS roomschedtbl_pkey;

-- Step 5: Add new primary key constraint (room_id, day_of_week) - allows one schedule per room per day
ALTER TABLE roomschedtbl 
ADD CONSTRAINT roomschedtbl_pkey PRIMARY KEY (room_id, day_of_week);

-- Step 4: Create index for better query performance on day_of_week
CREATE INDEX IF NOT EXISTS idx_roomsched_day_of_week 
ON roomschedtbl(day_of_week);

-- Step 5: Create composite index for room_id and day_of_week queries
CREATE INDEX IF NOT EXISTS idx_roomsched_room_day 
ON roomschedtbl(room_id, day_of_week);

COMMIT;

-- Verification queries (run these after migration to verify):
-- SELECT column_name, data_type, is_nullable 
-- FROM information_schema.columns 
-- WHERE table_name = 'roomschedtbl' AND column_name = 'day_of_week';
--
-- SELECT constraint_name, constraint_type 
-- FROM information_schema.table_constraints 
-- WHERE table_name = 'roomschedtbl' AND constraint_type = 'PRIMARY KEY';

