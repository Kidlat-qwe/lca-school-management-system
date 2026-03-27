-- Cash Deposit Summary: Branch Admin submits a cash deposit range; Superadmin/Superfinance verify it.
-- One record per branch per exact date range. Amounts are auto-calculated from paymenttbl Cash rows.

CREATE TABLE IF NOT EXISTS public.cash_deposit_summarytbl
(
    cash_deposit_summary_id serial NOT NULL,
    branch_id integer NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    total_deposit_amount numeric(12, 2) NOT NULL DEFAULT 0,
    total_cash_amount numeric(12, 2) NOT NULL DEFAULT 0,
    payment_count integer NOT NULL DEFAULT 0,
    completed_cash_count integer NOT NULL DEFAULT 0,
    status character varying(50) COLLATE pg_catalog."default" NOT NULL DEFAULT 'Submitted'::character varying,
    submitted_by integer,
    submitted_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    approved_by integer,
    approved_at timestamp without time zone,
    remarks text COLLATE pg_catalog."default",
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT cash_deposit_summarytbl_pkey PRIMARY KEY (cash_deposit_summary_id),
    CONSTRAINT cash_deposit_summarytbl_branch_period_unique UNIQUE (branch_id, start_date, end_date),
    CONSTRAINT cash_deposit_summarytbl_date_order_chk CHECK (start_date <= end_date)
);

COMMENT ON TABLE public.cash_deposit_summarytbl
    IS 'Cash deposit summaries per branch and date range. Admin submits deposit-ready cash totals; Superadmin/Superfinance verify.';

COMMENT ON COLUMN public.cash_deposit_summarytbl.total_deposit_amount
    IS 'Sum of payable_amount from paymenttbl for Cash payments with status Completed within the stored date range.';

COMMENT ON COLUMN public.cash_deposit_summarytbl.total_cash_amount
    IS 'Sum of payable_amount from paymenttbl for all Cash payments within the stored date range.';

COMMENT ON COLUMN public.cash_deposit_summarytbl.payment_count
    IS 'Number of Cash payment rows included in total_cash_amount.';

COMMENT ON COLUMN public.cash_deposit_summarytbl.completed_cash_count
    IS 'Number of Completed Cash payment rows included in total_deposit_amount.';

COMMENT ON COLUMN public.cash_deposit_summarytbl.status
    IS 'Submitted (awaiting approval), Approved, Rejected';

ALTER TABLE IF EXISTS public.cash_deposit_summarytbl
    ADD CONSTRAINT cash_deposit_summarytbl_branch_id_fkey FOREIGN KEY (branch_id)
    REFERENCES public.branchestbl (branch_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;

ALTER TABLE IF EXISTS public.cash_deposit_summarytbl
    ADD CONSTRAINT cash_deposit_summarytbl_submitted_by_fkey FOREIGN KEY (submitted_by)
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.cash_deposit_summarytbl
    ADD CONSTRAINT cash_deposit_summarytbl_approved_by_fkey FOREIGN KEY (approved_by)
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cash_deposit_summary_branch_id ON public.cash_deposit_summarytbl(branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_deposit_summary_start_date ON public.cash_deposit_summarytbl(start_date);
CREATE INDEX IF NOT EXISTS idx_cash_deposit_summary_end_date ON public.cash_deposit_summarytbl(end_date);
CREATE INDEX IF NOT EXISTS idx_cash_deposit_summary_status ON public.cash_deposit_summarytbl(status);
