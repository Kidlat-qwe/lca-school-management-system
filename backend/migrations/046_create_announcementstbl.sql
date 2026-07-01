BEGIN;

-- Create announcementstbl table to store school announcements
CREATE TABLE IF NOT EXISTS public.announcementstbl
(
    announcement_id serial NOT NULL,
    title character varying(255) COLLATE pg_catalog."default" NOT NULL,
    body text COLLATE pg_catalog."default" NOT NULL,
    recipient_groups text[] COLLATE pg_catalog."default" NOT NULL DEFAULT ARRAY[]::text[],
    status character varying(50) COLLATE pg_catalog."default" DEFAULT 'Active'::character varying,
    priority character varying(50) COLLATE pg_catalog."default" DEFAULT 'Medium'::character varying,
    branch_id integer,
    created_by integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    start_date date,
    end_date date,
    CONSTRAINT announcementstbl_pkey PRIMARY KEY (announcement_id)
);

COMMENT ON TABLE public.announcementstbl
    IS 'Stores school announcements that can be displayed to different user groups (Students, Teachers, Parents, etc.)';

COMMENT ON COLUMN public.announcementstbl.title
    IS 'Title of the announcement';

COMMENT ON COLUMN public.announcementstbl.body
    IS 'Main content/body of the announcement';

COMMENT ON COLUMN public.announcementstbl.recipient_groups
    IS 'Array of recipient groups: All, Students, Teachers, Parents, Admin, Finance. Multiple groups can be selected.';

COMMENT ON COLUMN public.announcementstbl.status
    IS 'Status: Active (visible), Inactive (hidden), Draft (not published)';

COMMENT ON COLUMN public.announcementstbl.priority
    IS 'Priority level: High, Medium, Low. Used for sorting and highlighting important announcements.';

COMMENT ON COLUMN public.announcementstbl.branch_id
    IS 'Branch ID. NULL means announcement applies to all branches, specific ID means branch-specific announcement.';

COMMENT ON COLUMN public.announcementstbl.created_by
    IS 'User ID who created the announcement';

COMMENT ON COLUMN public.announcementstbl.start_date
    IS 'Optional start date. Announcement will only be visible after this date. NULL means visible immediately.';

COMMENT ON COLUMN public.announcementstbl.end_date
    IS 'Optional end date. Announcement will be hidden after this date. NULL means no expiration.';

-- Add foreign key constraints
ALTER TABLE IF EXISTS public.announcementstbl
    ADD CONSTRAINT announcementstbl_branch_id_fkey FOREIGN KEY (branch_id)
    REFERENCES public.branchestbl (branch_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE NO ACTION;
CREATE INDEX IF NOT EXISTS idx_announcement_branch_id
    ON public.announcementstbl(branch_id);

ALTER TABLE IF EXISTS public.announcementstbl
    ADD CONSTRAINT announcementstbl_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE NO ACTION;
CREATE INDEX IF NOT EXISTS idx_announcement_created_by
    ON public.announcementstbl(created_by);

-- Create index for recipient_groups for efficient filtering
CREATE INDEX IF NOT EXISTS idx_announcement_recipient_groups
    ON public.announcementstbl USING GIN (recipient_groups);

-- Create index for status and dates for efficient querying
CREATE INDEX IF NOT EXISTS idx_announcement_status
    ON public.announcementstbl(status);

CREATE INDEX IF NOT EXISTS idx_announcement_dates
    ON public.announcementstbl(start_date, end_date);

COMMIT;

