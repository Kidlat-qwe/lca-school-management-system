-- Migration: Create suspensionperiodstbl for handling class suspensions due to calamities
-- This table allows tracking suspension periods that affect classes across branches
-- and enables automatic rescheduling of affected sessions

CREATE TABLE IF NOT EXISTS public.suspensionperiodstbl
(
    suspension_id serial NOT NULL,
    suspension_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    branch_id integer, -- NULL means all branches
    start_date date NOT NULL,
    end_date date NOT NULL,
    reason character varying(100) COLLATE pg_catalog."default" NOT NULL,
    description text COLLATE pg_catalog."default",
    status character varying(20) COLLATE pg_catalog."default" NOT NULL DEFAULT 'Active',
    affected_class_ids integer[], -- Array of specific class IDs (NULL = all classes in branch)
    auto_reschedule boolean DEFAULT true,
    created_by integer NOT NULL,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT suspensionperiodstbl_pkey PRIMARY KEY (suspension_id),
    CONSTRAINT suspensionperiodstbl_branch_id_fkey FOREIGN KEY (branch_id)
        REFERENCES public.branchestbl (branch_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT suspensionperiodstbl_created_by_fkey FOREIGN KEY (created_by)
        REFERENCES public.userstbl (user_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,
    CONSTRAINT suspensionperiodstbl_status_check CHECK (status IN ('Active', 'Cancelled'))
);

COMMENT ON TABLE public.suspensionperiodstbl
    IS 'Tracks suspension periods for classes due to calamities, holidays, or other events. Enables bulk cancellation and automatic rescheduling.';

COMMENT ON COLUMN public.suspensionperiodstbl.suspension_name
    IS 'Display name for the suspension (e.g., "Typhoon Odette - December 2021")';

COMMENT ON COLUMN public.suspensionperiodstbl.branch_id
    IS 'Branch affected by suspension. NULL means all branches are affected.';

COMMENT ON COLUMN public.suspensionperiodstbl.reason
    IS 'Reason for suspension: Typhoon, Earthquake, Flood, Holiday, Government Mandate, Other';

COMMENT ON COLUMN public.suspensionperiodstbl.affected_class_ids
    IS 'Array of specific class IDs affected. NULL means all classes in the branch are affected.';

COMMENT ON COLUMN public.suspensionperiodstbl.auto_reschedule
    IS 'Whether to automatically extend class end dates to reschedule suspended sessions';

-- Add suspension reference to classsessionstbl
ALTER TABLE public.classsessionstbl
ADD COLUMN IF NOT EXISTS suspension_id integer,
ADD CONSTRAINT classsessionstbl_suspension_id_fkey FOREIGN KEY (suspension_id)
    REFERENCES public.suspensionperiodstbl (suspension_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

COMMENT ON COLUMN public.classsessionstbl.suspension_id
    IS 'Reference to suspension period if this session was cancelled due to a suspension';

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_suspension_branch_id ON public.suspensionperiodstbl (branch_id);
CREATE INDEX IF NOT EXISTS idx_suspension_dates ON public.suspensionperiodstbl (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_suspension_status ON public.suspensionperiodstbl (status);
CREATE INDEX IF NOT EXISTS idx_suspension_created_by ON public.suspensionperiodstbl (created_by);
CREATE INDEX IF NOT EXISTS idx_classsession_suspension_id ON public.classsessionstbl (suspension_id);

