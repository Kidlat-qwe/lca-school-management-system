BEGIN;

-- Create reservedstudentstbl table to track student reservations
CREATE TABLE IF NOT EXISTS public.reservedstudentstbl
(
    reserved_id serial NOT NULL,
    student_id integer NOT NULL,
    class_id integer NOT NULL,
    package_id integer,
    branch_id integer,
    reservation_fee numeric(10, 2),
    status character varying(50) COLLATE pg_catalog."default" DEFAULT 'Reserved'::character varying,
    reserved_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    reserved_by character varying(255) COLLATE pg_catalog."default",
    reservation_fee_paid_at timestamp without time zone,
    upgraded_at timestamp without time zone,
    upgraded_by character varying(255) COLLATE pg_catalog."default",
    notes text COLLATE pg_catalog."default",
    invoice_id integer, -- Link to reservation fee invoice
    phase_number integer, -- NULL means entire class reservation, specific number means per-phase reservation
    CONSTRAINT reservedstudentstbl_pkey PRIMARY KEY (reserved_id),
    CONSTRAINT reservedstudentstbl_student_class_phase_unique UNIQUE (student_id, class_id, phase_number)
);

COMMENT ON TABLE public.reservedstudentstbl IS 'Tracks student reservations for classes. Students can reserve a spot by paying a reservation fee, then upgrade to full enrollment.';
COMMENT ON COLUMN public.reservedstudentstbl.status IS 'Status: Reserved (initial), Fee Paid (reservation fee paid), Upgraded (converted to enrollment), Cancelled';
COMMENT ON COLUMN public.reservedstudentstbl.invoice_id IS 'Link to the invoice for reservation fee payment';
COMMENT ON COLUMN public.reservedstudentstbl.phase_number IS 'Phase number for per-phase reservation. NULL means entire class reservation, specific number means reservation for that phase only.';

-- Add foreign key constraints
ALTER TABLE IF EXISTS public.reservedstudentstbl
    ADD CONSTRAINT reservedstudentstbl_student_id_fkey FOREIGN KEY (student_id)
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE NO ACTION;

ALTER TABLE IF EXISTS public.reservedstudentstbl
    ADD CONSTRAINT reservedstudentstbl_class_id_fkey FOREIGN KEY (class_id)
    REFERENCES public.classestbl (class_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE NO ACTION;

ALTER TABLE IF EXISTS public.reservedstudentstbl
    ADD CONSTRAINT reservedstudentstbl_package_id_fkey FOREIGN KEY (package_id)
    REFERENCES public.packagestbl (package_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.reservedstudentstbl
    ADD CONSTRAINT reservedstudentstbl_branch_id_fkey FOREIGN KEY (branch_id)
    REFERENCES public.branchestbl (branch_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE NO ACTION;

ALTER TABLE IF EXISTS public.reservedstudentstbl
    ADD CONSTRAINT reservedstudentstbl_invoice_id_fkey FOREIGN KEY (invoice_id)
    REFERENCES public.invoicestbl (invoice_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_reservedstudent_student_id
    ON public.reservedstudentstbl(student_id);

CREATE INDEX IF NOT EXISTS idx_reservedstudent_class_id
    ON public.reservedstudentstbl(class_id);

CREATE INDEX IF NOT EXISTS idx_reservedstudent_status
    ON public.reservedstudentstbl(status);

CREATE INDEX IF NOT EXISTS idx_reservedstudent_branch_id
    ON public.reservedstudentstbl(branch_id);

CREATE INDEX IF NOT EXISTS idx_reservedstudent_phase_number
    ON public.reservedstudentstbl(phase_number);

COMMIT;

