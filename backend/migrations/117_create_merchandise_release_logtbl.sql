BEGIN;

-- Audit log for physical merchandise issued (stock deductions).
-- Sources: standalone Merchandise AR, package enrollment included/selected items.
CREATE TABLE IF NOT EXISTS public.merchandise_release_logtbl
(
    release_log_id serial NOT NULL,
    release_batch_id character varying(80) COLLATE pg_catalog."default" NOT NULL,
    source character varying(32) COLLATE pg_catalog."default" NOT NULL,
    merchandise_id integer NOT NULL,
    quantity integer NOT NULL DEFAULT 1,
    branch_id integer NOT NULL,
    merchandise_name character varying(255) COLLATE pg_catalog."default",
    size character varying(50) COLLATE pg_catalog."default",
    category character varying(50) COLLATE pg_catalog."default",
    student_id integer,
    class_id integer,
    package_id integer,
    ack_receipt_id integer,
    payment_id integer,
    created_by integer,
    released_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT merchandise_release_logtbl_pkey PRIMARY KEY (release_log_id),
    CONSTRAINT merchandise_release_logtbl_source_check CHECK (
        source IN ('merchandise_ar', 'package_enroll')
    ),
    CONSTRAINT merchandise_release_logtbl_quantity_check CHECK (quantity > 0),
    CONSTRAINT merchandise_release_logtbl_merchandise_id_fkey FOREIGN KEY (merchandise_id)
        REFERENCES public.merchandisestbl (merchandise_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE RESTRICT,
    CONSTRAINT merchandise_release_logtbl_branch_id_fkey FOREIGN KEY (branch_id)
        REFERENCES public.branchestbl (branch_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE RESTRICT,
    CONSTRAINT merchandise_release_logtbl_student_id_fkey FOREIGN KEY (student_id)
        REFERENCES public.userstbl (user_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT merchandise_release_logtbl_class_id_fkey FOREIGN KEY (class_id)
        REFERENCES public.classestbl (class_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT merchandise_release_logtbl_package_id_fkey FOREIGN KEY (package_id)
        REFERENCES public.packagestbl (package_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT merchandise_release_logtbl_ack_receipt_id_fkey FOREIGN KEY (ack_receipt_id)
        REFERENCES public.acknowledgement_receiptstbl (ack_receipt_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT merchandise_release_logtbl_payment_id_fkey FOREIGN KEY (payment_id)
        REFERENCES public.paymenttbl (payment_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT merchandise_release_logtbl_created_by_fkey FOREIGN KEY (created_by)
        REFERENCES public.userstbl (user_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL
);

COMMENT ON TABLE public.merchandise_release_logtbl
    IS 'One row per merchandise unit line deducted from branch stock (Merchandise AR or package enrollment).';

COMMENT ON COLUMN public.merchandise_release_logtbl.release_batch_id
    IS 'Groups lines from one AR or one enrollment (e.g. ar-123, enroll-45-67-...).';

COMMENT ON COLUMN public.merchandise_release_logtbl.source
    IS 'merchandise_ar | package_enroll';

CREATE INDEX IF NOT EXISTS idx_merchandise_release_log_branch_released
    ON public.merchandise_release_logtbl (branch_id, released_at DESC);

CREATE INDEX IF NOT EXISTS idx_merchandise_release_log_batch
    ON public.merchandise_release_logtbl (release_batch_id);

CREATE INDEX IF NOT EXISTS idx_merchandise_release_log_source_released
    ON public.merchandise_release_logtbl (source, released_at DESC);

COMMIT;
