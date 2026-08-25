-- FIUU saved payment tokens (tokenization / future MIT auto-debit).
-- Token only — never store full card numbers.
BEGIN;

CREATE TABLE IF NOT EXISTS public.fiuu_payment_tokenstbl
(
    fiuu_payment_token_id serial NOT NULL,
    student_id integer NOT NULL,
    installmentinvoiceprofiles_id integer,
    branch_id integer,
    fiuu_token character varying(128) COLLATE pg_catalog."default" NOT NULL,
    fiuu_cust_id character varying(64) COLLATE pg_catalog."default",
    card_brand character varying(32) COLLATE pg_catalog."default",
    card_last4 character varying(8) COLLATE pg_catalog."default",
    exp_month character varying(2) COLLATE pg_catalog."default",
    exp_year character varying(4) COLLATE pg_catalog."default",
    channel character varying(64) COLLATE pg_catalog."default",
    source_orderid character varying(40) COLLATE pg_catalog."default",
    source_tran_id character varying(64) COLLATE pg_catalog."default",
    gateway_payment_id integer,
    invoice_id integer,
    status character varying(16) COLLATE pg_catalog."default" NOT NULL DEFAULT 'active'::character varying,
    consent_at timestamp without time zone,
    raw_extrap jsonb,
    created_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    revoked_at timestamp without time zone,
    CONSTRAINT fiuu_payment_tokenstbl_pkey PRIMARY KEY (fiuu_payment_token_id)
);

COMMENT ON TABLE public.fiuu_payment_tokenstbl
    IS 'FIUU payment tokens from Card tokenization (extraP.token). Used for future MIT/recurring charges. Never stores PAN.';

COMMENT ON COLUMN public.fiuu_payment_tokenstbl.status
    IS 'active | revoked';

CREATE UNIQUE INDEX IF NOT EXISTS idx_fiuu_payment_tokens_active_token
    ON public.fiuu_payment_tokenstbl (fiuu_token)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_fiuu_payment_tokens_student_id
    ON public.fiuu_payment_tokenstbl (student_id);

CREATE INDEX IF NOT EXISTS idx_fiuu_payment_tokens_profile_id
    ON public.fiuu_payment_tokenstbl (installmentinvoiceprofiles_id);

CREATE INDEX IF NOT EXISTS idx_fiuu_payment_tokens_status
    ON public.fiuu_payment_tokenstbl (status);

COMMIT;
