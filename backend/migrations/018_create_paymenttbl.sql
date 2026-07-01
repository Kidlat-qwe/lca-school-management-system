BEGIN;

-- Create paymenttbl for tracking payments against invoices
CREATE TABLE IF NOT EXISTS public.paymenttbl
(
    payment_id serial NOT NULL,
    invoice_id integer NOT NULL,
    student_id integer NOT NULL,
    branch_id integer,
    payment_method character varying(50) COLLATE pg_catalog."default" NOT NULL,
    payment_type character varying(50) COLLATE pg_catalog."default" NOT NULL,
    payable_amount numeric(10, 2) NOT NULL,
    issue_date date NOT NULL,
    status character varying(50) COLLATE pg_catalog."default" DEFAULT 'Completed'::character varying,
    reference_number character varying(255) COLLATE pg_catalog."default",
    remarks text COLLATE pg_catalog."default",
    created_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT paymenttbl_pkey PRIMARY KEY (payment_id)
);

-- Add foreign key constraints
ALTER TABLE IF EXISTS public.paymenttbl
    ADD CONSTRAINT paymenttbl_invoice_id_fkey FOREIGN KEY (invoice_id)
    REFERENCES public.invoicestbl (invoice_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE NO ACTION;

ALTER TABLE IF EXISTS public.paymenttbl
    ADD CONSTRAINT paymenttbl_student_id_fkey FOREIGN KEY (student_id)
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE NO ACTION;

ALTER TABLE IF EXISTS public.paymenttbl
    ADD CONSTRAINT paymenttbl_branch_id_fkey FOREIGN KEY (branch_id)
    REFERENCES public.branchestbl (branch_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE NO ACTION;

ALTER TABLE IF EXISTS public.paymenttbl
    ADD CONSTRAINT paymenttbl_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE NO ACTION;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_payment_invoice_id
    ON public.paymenttbl(invoice_id);

CREATE INDEX IF NOT EXISTS idx_payment_student_id
    ON public.paymenttbl(student_id);

CREATE INDEX IF NOT EXISTS idx_payment_branch_id
    ON public.paymenttbl(branch_id);

CREATE INDEX IF NOT EXISTS idx_payment_status
    ON public.paymenttbl(status);

COMMIT;

