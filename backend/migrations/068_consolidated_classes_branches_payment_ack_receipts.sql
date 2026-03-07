-- =============================================================================
-- Consolidated migration: classes (skip_holidays, is_vip), branches (nickname),
-- payment (attachment URL), acknowledgement_receipts table (create + refinements)
-- Replaces migrations 068–075 as a single file.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 068: Add skip_holidays and is_vip to classestbl
-- -----------------------------------------------------------------------------
-- skip_holidays: when true, class sessions on holidays are skipped (no session held)
-- is_vip: when true, class is marked as VIP and shown with VIP tag on class details page

ALTER TABLE public.classestbl
  ADD COLUMN IF NOT EXISTS skip_holidays BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.classestbl
  ADD COLUMN IF NOT EXISTS is_vip BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.classestbl.skip_holidays IS 'When true, classes are skipped on holidays';
COMMENT ON COLUMN public.classestbl.is_vip IS 'When true, class is displayed with VIP tag on details page';

-- -----------------------------------------------------------------------------
-- 069: Add branch_nickname to branchestbl
-- -----------------------------------------------------------------------------

ALTER TABLE branchestbl
  ADD COLUMN IF NOT EXISTS branch_nickname VARCHAR(100);

-- -----------------------------------------------------------------------------
-- 070: Add payment_attachment_url to paymenttbl
-- -----------------------------------------------------------------------------

ALTER TABLE IF EXISTS public.paymenttbl
  ADD COLUMN IF NOT EXISTS payment_attachment_url TEXT;

COMMENT ON COLUMN public.paymenttbl.payment_attachment_url
  IS 'S3 URL of attached image (e.g. receipt/proof) for this payment record';

-- -----------------------------------------------------------------------------
-- 071: Create acknowledgement_receiptstbl
-- -----------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS public.acknowledgement_receiptstbl
(
    ack_receipt_id serial PRIMARY KEY,
    ack_receipt_number character varying(50) COLLATE pg_catalog."default" NOT NULL,
    status character varying(50) COLLATE pg_catalog."default" NOT NULL DEFAULT 'Pending',

    prospect_student_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    prospect_student_contact character varying(255) COLLATE pg_catalog."default",
    prospect_student_notes text COLLATE pg_catalog."default",

    student_id integer,
    branch_id integer,

    package_id integer NOT NULL,
    package_name_snapshot character varying(255) COLLATE pg_catalog."default" NOT NULL,
    package_amount_snapshot numeric(10, 2) NOT NULL,

    payment_amount numeric(10, 2) NOT NULL,
    payment_method character varying(50) COLLATE pg_catalog."default" NOT NULL,
    payment_type character varying(50) COLLATE pg_catalog."default" NOT NULL,
    reference_number character varying(255) COLLATE pg_catalog."default" NOT NULL,
    issue_date date NOT NULL,
    payment_attachment_url text,

    invoice_id integer,
    payment_id integer,

    created_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ack_receipts_number
    ON public.acknowledgement_receiptstbl(ack_receipt_number);

CREATE INDEX IF NOT EXISTS idx_ack_receipts_status
    ON public.acknowledgement_receiptstbl(status);

CREATE INDEX IF NOT EXISTS idx_ack_receipts_reference_number
    ON public.acknowledgement_receiptstbl(reference_number);

CREATE INDEX IF NOT EXISTS idx_ack_receipts_issue_date
    ON public.acknowledgement_receiptstbl(issue_date);

ALTER TABLE IF EXISTS public.acknowledgement_receiptstbl
    ADD CONSTRAINT ack_receipts_student_id_fkey FOREIGN KEY (student_id)
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.acknowledgement_receiptstbl
    ADD CONSTRAINT ack_receipts_package_id_fkey FOREIGN KEY (package_id)
    REFERENCES public.packagestbl (package_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE RESTRICT;

ALTER TABLE IF EXISTS public.acknowledgement_receiptstbl
    ADD CONSTRAINT ack_receipts_invoice_id_fkey FOREIGN KEY (invoice_id)
    REFERENCES public.invoicestbl (invoice_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.acknowledgement_receiptstbl
    ADD CONSTRAINT ack_receipts_payment_id_fkey FOREIGN KEY (payment_id)
    REFERENCES public.paymenttbl (payment_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.acknowledgement_receiptstbl
    ADD CONSTRAINT ack_receipts_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ack_receipts_branch_id
    ON public.acknowledgement_receiptstbl(branch_id);

ALTER TABLE IF EXISTS public.acknowledgement_receiptstbl
    ADD CONSTRAINT ack_receipts_branch_id_fkey FOREIGN KEY (branch_id)
    REFERENCES public.branchestbl (branch_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

COMMIT;

-- -----------------------------------------------------------------------------
-- 072: Remove payment_type and payment_method from acknowledgement_receiptstbl
-- -----------------------------------------------------------------------------

BEGIN;

ALTER TABLE IF EXISTS public.acknowledgement_receiptstbl
  DROP COLUMN IF EXISTS payment_method,
  DROP COLUMN IF EXISTS payment_type;

COMMIT;

-- -----------------------------------------------------------------------------
-- 073: Remove reference_number and payment_attachment_url from ack_receiptstbl
-- -----------------------------------------------------------------------------

BEGIN;

DROP INDEX IF EXISTS public.idx_ack_receipts_reference_number;

ALTER TABLE IF EXISTS public.acknowledgement_receiptstbl
  DROP COLUMN IF EXISTS reference_number,
  DROP COLUMN IF EXISTS payment_attachment_url;

COMMIT;

-- -----------------------------------------------------------------------------
-- 074: Add installment_option to acknowledgement_receiptstbl
-- -----------------------------------------------------------------------------

BEGIN;

ALTER TABLE IF EXISTS public.acknowledgement_receiptstbl
  ADD COLUMN IF NOT EXISTS installment_option character varying(50) DEFAULT NULL;

COMMENT ON COLUMN public.acknowledgement_receiptstbl.installment_option IS
  'For installment packages: downpayment_only | downpayment_plus_phase1. NULL for non-installment packages.';

COMMIT;

-- -----------------------------------------------------------------------------
-- 075: Re-add reference_number and payment_attachment_url to ack_receiptstbl
-- -----------------------------------------------------------------------------

BEGIN;

ALTER TABLE IF EXISTS public.acknowledgement_receiptstbl
  ADD COLUMN IF NOT EXISTS reference_number  character varying(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payment_attachment_url text DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_ack_receipts_reference_number
    ON public.acknowledgement_receiptstbl(reference_number);

COMMIT;
