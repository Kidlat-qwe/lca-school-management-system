-- Cash deposit: branch Admin submissions await Superfinance verification as Pending (was Submitted).

UPDATE cash_deposit_summarytbl
SET status = 'Pending'
WHERE status = 'Submitted';

ALTER TABLE public.cash_deposit_summarytbl
  ALTER COLUMN status SET DEFAULT 'Pending';

COMMENT ON COLUMN public.cash_deposit_summarytbl.status
  IS 'Pending (awaiting Superfinance verification), Approved, Returned';
