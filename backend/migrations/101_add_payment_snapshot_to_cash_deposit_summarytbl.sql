ALTER TABLE public.cash_deposit_summarytbl
  ADD COLUMN IF NOT EXISTS cash_payment_snapshot JSONB;

COMMENT ON COLUMN public.cash_deposit_summarytbl.cash_payment_snapshot
  IS 'Immutable snapshot of cash payment rows included at submission time for details viewing.';
