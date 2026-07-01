-- Migration: Add last_login column to userstbl
-- Date: 2025-01-29
-- Description: Adds last_login timestamp column to track when users last logged in
-- Timezone: UTC+8 (Asia/Manila - Philippines)

BEGIN;

-- Set timezone to Philippines (UTC+8) for this migration
SET timezone = 'Asia/Manila';

-- Add last_login column to userstbl
ALTER TABLE IF EXISTS public.userstbl
    ADD COLUMN IF NOT EXISTS last_login timestamp without time zone;

COMMENT ON COLUMN public.userstbl.last_login
    IS 'Timestamp of the user''s last successful login (stored in UTC+8/Asia/Manila timezone)';

-- Create index for better query performance when filtering/sorting by last_login
CREATE INDEX IF NOT EXISTS idx_userstbl_last_login
    ON public.userstbl(last_login DESC NULLS LAST);

COMMIT;
