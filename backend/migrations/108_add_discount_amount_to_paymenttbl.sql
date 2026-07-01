-- Stores discounts applied at payment time separately from actual cash received.
-- `payable_amount` remains the collected amount; `discount_amount` counts only
-- toward invoice settlement so discounted full payments do not become partial.

ALTER TABLE public.paymenttbl
  ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2) DEFAULT 0;

COMMENT ON COLUMN public.paymenttbl.discount_amount IS
  'Discount applied at payment time. Counts toward invoice settlement, not revenue.';

UPDATE public.paymenttbl
SET discount_amount = 0
WHERE discount_amount IS NULL;
