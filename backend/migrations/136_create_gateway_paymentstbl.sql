-- Tracks FIUU (and future gateway) payment attempts linked to CMS bills.
BEGIN;

CREATE TABLE IF NOT EXISTS public.gateway_paymentstbl
(
    gateway_payment_id serial NOT NULL,
    gateway character varying(32) COLLATE pg_catalog."default" NOT NULL DEFAULT 'FIUU'::character varying,
    orderid character varying(40) COLLATE pg_catalog."default" NOT NULL,
    fiuu_tran_id character varying(64) COLLATE pg_catalog."default",
    fiuu_channel character varying(64) COLLATE pg_catalog."default",
    target_type character varying(32) COLLATE pg_catalog."default" NOT NULL,
    target_id integer NOT NULL,
    student_id integer,
    branch_id integer,
    invoice_id integer,
    amount numeric(12, 2) NOT NULL,
    currency character varying(8) COLLATE pg_catalog."default" NOT NULL DEFAULT 'PHP'::character varying,
    description_sent text COLLATE pg_catalog."default",
    status character varying(32) COLLATE pg_catalog."default" NOT NULL DEFAULT 'pending'::character varying,
    metadata jsonb DEFAULT '{}'::jsonb,
    raw_request jsonb,
    raw_webhook jsonb,
    payment_id integer,
    created_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    paid_at timestamp without time zone,
    CONSTRAINT gateway_paymentstbl_pkey PRIMARY KEY (gateway_payment_id),
    CONSTRAINT gateway_paymentstbl_orderid_key UNIQUE (orderid)
);

COMMENT ON TABLE public.gateway_paymentstbl
    IS 'Payment gateway attempts (FIUU). Links orderid to CMS invoice/student before webhook confirms payment.';

COMMENT ON COLUMN public.gateway_paymentstbl.orderid
    IS 'Merchant order id sent to FIUU, e.g. PSMS-I-1842-A7F3';

COMMENT ON COLUMN public.gateway_paymentstbl.status
    IS 'pending | paid | failed | expired | cancelled';

CREATE INDEX IF NOT EXISTS idx_gateway_payments_invoice_id
    ON public.gateway_paymentstbl (invoice_id);

CREATE INDEX IF NOT EXISTS idx_gateway_payments_status
    ON public.gateway_paymentstbl (status);

CREATE INDEX IF NOT EXISTS idx_gateway_payments_created_at
    ON public.gateway_paymentstbl (created_at DESC);

COMMIT;
