BEGIN;

-- Create merchandise request log table for tracking stock requests from Admin to Superadmin
CREATE TABLE IF NOT EXISTS public.merchandiserequestlogtbl
(
    request_id serial NOT NULL,
    merchandise_id integer,
    requested_by integer NOT NULL,
    requested_branch_id integer NOT NULL,
    merchandise_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    size character varying(50) COLLATE pg_catalog."default",
    requested_quantity integer NOT NULL,
    request_reason text COLLATE pg_catalog."default",
    status character varying(50) COLLATE pg_catalog."default" DEFAULT 'Pending'::character varying,
    reviewed_by integer,
    reviewed_at timestamp without time zone,
    review_notes text COLLATE pg_catalog."default",
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT merchandiserequestlogtbl_pkey PRIMARY KEY (request_id),
    CONSTRAINT merchandiserequestlogtbl_merchandise_id_fkey FOREIGN KEY (merchandise_id)
        REFERENCES public.merchandisestbl (merchandise_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT merchandiserequestlogtbl_requested_by_fkey FOREIGN KEY (requested_by)
        REFERENCES public.userstbl (user_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,
    CONSTRAINT merchandiserequestlogtbl_requested_branch_id_fkey FOREIGN KEY (requested_branch_id)
        REFERENCES public.branchestbl (branch_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,
    CONSTRAINT merchandiserequestlogtbl_reviewed_by_fkey FOREIGN KEY (reviewed_by)
        REFERENCES public.userstbl (user_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL
);

-- Add comments
COMMENT ON TABLE public.merchandiserequestlogtbl
    IS 'Tracks merchandise stock requests from Admins to Superadmins. Admins request stock when inventory is low, Superadmins approve or reject requests.';

COMMENT ON COLUMN public.merchandiserequestlogtbl.merchandise_id
    IS 'Reference to existing merchandise. NULL if requesting new merchandise not yet in branch catalog.';

COMMENT ON COLUMN public.merchandiserequestlogtbl.requested_by
    IS 'Admin user who made the request';

COMMENT ON COLUMN public.merchandiserequestlogtbl.requested_branch_id
    IS 'Branch requesting the merchandise stock';

COMMENT ON COLUMN public.merchandiserequestlogtbl.merchandise_name
    IS 'Name of merchandise being requested (preserved even if merchandise is deleted)';

COMMENT ON COLUMN public.merchandiserequestlogtbl.size
    IS 'Size of merchandise being requested (e.g., S, M, L, XL)';

COMMENT ON COLUMN public.merchandiserequestlogtbl.requested_quantity
    IS 'Quantity of merchandise being requested';

COMMENT ON COLUMN public.merchandiserequestlogtbl.request_reason
    IS 'Reason for the stock request (e.g., "Low stock", "High demand", "New merchandise needed")';

COMMENT ON COLUMN public.merchandiserequestlogtbl.status
    IS 'Request status: Pending (awaiting review), Approved (approved by superadmin), Rejected (rejected by superadmin), Cancelled (cancelled by admin)';

COMMENT ON COLUMN public.merchandiserequestlogtbl.reviewed_by
    IS 'Superadmin who reviewed (approved/rejected) the request';

COMMENT ON COLUMN public.merchandiserequestlogtbl.reviewed_at
    IS 'Timestamp when request was reviewed';

COMMENT ON COLUMN public.merchandiserequestlogtbl.review_notes
    IS 'Notes from superadmin about approval/rejection';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_merchrequest_status
    ON public.merchandiserequestlogtbl(status);

CREATE INDEX IF NOT EXISTS idx_merchrequest_requested_by
    ON public.merchandiserequestlogtbl(requested_by);

CREATE INDEX IF NOT EXISTS idx_merchrequest_requested_branch
    ON public.merchandiserequestlogtbl(requested_branch_id);

CREATE INDEX IF NOT EXISTS idx_merchrequest_merchandise_id
    ON public.merchandiserequestlogtbl(merchandise_id);

CREATE INDEX IF NOT EXISTS idx_merchrequest_created_at
    ON public.merchandiserequestlogtbl(created_at DESC);

COMMIT;

