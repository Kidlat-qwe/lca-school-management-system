-- FIUU auto-debit consent (installment / class-scoped, optional).
-- One consent row scopes charges to one installment profile (one class), never other classes.
BEGIN;

CREATE TABLE IF NOT EXISTS public.fiuu_autodebit_consentstbl
(
    fiuu_autodebit_consent_id serial NOT NULL,
    student_id integer NOT NULL,
    installmentinvoiceprofiles_id integer,
    class_id integer,
    package_id integer,
    branch_id integer,
    gateway_payment_id integer,
    fiuu_payment_token_id integer,
    status character varying(24) COLLATE pg_catalog."default" NOT NULL DEFAULT 'pending'::character varying,
    enabled boolean NOT NULL DEFAULT false,
    terms_version character varying(32) COLLATE pg_catalog."default" NOT NULL,
    staff_opt_in boolean NOT NULL DEFAULT false,
    staff_accepted_at timestamp without time zone,
    staff_accepted_by integer,
    parent_opt_in boolean NOT NULL DEFAULT false,
    parent_accepted_at timestamp without time zone,
    parent_accepted_via character varying(32) COLLATE pg_catalog."default",
    class_name_snapshot character varying(255) COLLATE pg_catalog."default",
    notes text COLLATE pg_catalog."default",
    disabled_at timestamp without time zone,
    disabled_by integer,
    disabled_reason character varying(255) COLLATE pg_catalog."default",
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fiuu_autodebit_consentstbl_pkey PRIMARY KEY (fiuu_autodebit_consent_id)
);

COMMENT ON TABLE public.fiuu_autodebit_consentstbl
    IS 'Optional FIUU auto-debit consent scoped to one installment profile / class. Requires staff + parent T&Cs before enabled.';

COMMENT ON COLUMN public.fiuu_autodebit_consentstbl.status
    IS 'pending | active | disabled';

COMMENT ON COLUMN public.fiuu_autodebit_consentstbl.enabled
    IS 'True only when staff+parent opted in, both accepted T&Cs, and a token is linked (or pending token after pay).';

CREATE UNIQUE INDEX IF NOT EXISTS idx_fiuu_autodebit_consent_active_profile
    ON public.fiuu_autodebit_consentstbl (installmentinvoiceprofiles_id)
    WHERE status = 'active' AND installmentinvoiceprofiles_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fiuu_autodebit_consent_student
    ON public.fiuu_autodebit_consentstbl (student_id);

CREATE INDEX IF NOT EXISTS idx_fiuu_autodebit_consent_class
    ON public.fiuu_autodebit_consentstbl (class_id);

CREATE INDEX IF NOT EXISTS idx_fiuu_autodebit_consent_status
    ON public.fiuu_autodebit_consentstbl (status);

CREATE INDEX IF NOT EXISTS idx_fiuu_autodebit_consent_gateway
    ON public.fiuu_autodebit_consentstbl (gateway_payment_id);

COMMIT;
