-- Migration: Create announcement_readstbl
-- Date: 2024
-- Description: Creates table to track which announcements have been read by which users
-- 
-- IMPORTANT: Backup your database before running this migration!

BEGIN;

-- Create announcement_readstbl to track read announcements
CREATE TABLE IF NOT EXISTS public.announcement_readstbl
(
    announcement_read_id serial NOT NULL,
    announcement_id integer NOT NULL,
    user_id integer NOT NULL,
    read_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT announcement_readstbl_pkey PRIMARY KEY (announcement_read_id),
    CONSTRAINT announcement_readstbl_unique_user_announcement UNIQUE (announcement_id, user_id)
);

COMMENT ON TABLE public.announcement_readstbl
    IS 'Tracks which announcements have been read by which users. Used for notification system.';

COMMENT ON COLUMN public.announcement_readstbl.announcement_id
    IS 'Reference to the announcement';

COMMENT ON COLUMN public.announcement_readstbl.user_id
    IS 'Reference to the user who read the announcement';

COMMENT ON COLUMN public.announcement_readstbl.read_at
    IS 'Timestamp when the announcement was marked as read';

-- Add foreign key constraints
ALTER TABLE IF EXISTS public.announcement_readstbl
    ADD CONSTRAINT announcement_readstbl_announcement_id_fkey FOREIGN KEY (announcement_id)
    REFERENCES public.announcementstbl (announcement_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;

ALTER TABLE IF EXISTS public.announcement_readstbl
    ADD CONSTRAINT announcement_readstbl_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_announcement_read_announcement_id
    ON public.announcement_readstbl(announcement_id);

CREATE INDEX IF NOT EXISTS idx_announcement_read_user_id
    ON public.announcement_readstbl(user_id);

CREATE INDEX IF NOT EXISTS idx_announcement_read_read_at
    ON public.announcement_readstbl(read_at);

COMMIT;

