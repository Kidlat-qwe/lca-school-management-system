-- Daily Summary Sales: Branch Admin submits daily closing; Superadmin/Superfinance approve
-- One record per branch per date. Amount auto-calculated from paymenttbl (issue_date = summary_date).
-- Purpose: Track daily financial closing operations.

CREATE TABLE IF NOT EXISTS public.daily_summary_salestbl
(
    daily_summary_id serial NOT NULL,
    branch_id integer NOT NULL,
    summary_date date NOT NULL,
    total_amount numeric(12, 2) NOT NULL DEFAULT 0,
    payment_count integer NOT NULL DEFAULT 0,
    status character varying(50) COLLATE pg_catalog."default" NOT NULL DEFAULT 'Submitted'::character varying,
    submitted_by integer,
    submitted_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    approved_by integer,
    approved_at timestamp without time zone,
    remarks text COLLATE pg_catalog."default",
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT daily_summary_salestbl_pkey PRIMARY KEY (daily_summary_id),
    CONSTRAINT daily_summary_salestbl_branch_date_unique UNIQUE (branch_id, summary_date)
);

COMMENT ON TABLE public.daily_summary_salestbl
    IS 'Daily sales summary per branch. Admin submits for today; Superadmin/Superfinance approve. Amount from Payment Logs.';

COMMENT ON COLUMN public.daily_summary_salestbl.summary_date
    IS 'Date of the summary (must be today when Admin submits)';

COMMENT ON COLUMN public.daily_summary_salestbl.total_amount
    IS 'Sum of payable_amount from paymenttbl for branch_id and issue_date = summary_date (snapshot at submit)';

COMMENT ON COLUMN public.daily_summary_salestbl.payment_count
    IS 'Number of payments included in total_amount';

COMMENT ON COLUMN public.daily_summary_salestbl.status
    IS 'Submitted (awaiting approval), Approved, Rejected';

ALTER TABLE IF EXISTS public.daily_summary_salestbl
    ADD CONSTRAINT daily_summary_salestbl_branch_id_fkey FOREIGN KEY (branch_id)
    REFERENCES public.branchestbl (branch_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;

ALTER TABLE IF EXISTS public.daily_summary_salestbl
    ADD CONSTRAINT daily_summary_salestbl_submitted_by_fkey FOREIGN KEY (submitted_by)
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.daily_summary_salestbl
    ADD CONSTRAINT daily_summary_salestbl_approved_by_fkey FOREIGN KEY (approved_by)
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_daily_summary_branch_id ON public.daily_summary_salestbl(branch_id);
CREATE INDEX IF NOT EXISTS idx_daily_summary_summary_date ON public.daily_summary_salestbl(summary_date);
CREATE INDEX IF NOT EXISTS idx_daily_summary_status ON public.daily_summary_salestbl(status);
