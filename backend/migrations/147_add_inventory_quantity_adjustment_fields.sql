-- Migration 147: RHET stock-request quantity adjustment (warehouse reduces qty before ship)
-- Webhook: stock_request.quantity_adjusted

ALTER TABLE public.merchandiserequestlogtbl
  ADD COLUMN IF NOT EXISTS inventory_original_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS inventory_adjustment_remarks VARCHAR(500),
  ADD COLUMN IF NOT EXISTS inventory_adjusted_by VARCHAR(150),
  ADD COLUMN IF NOT EXISTS inventory_adjusted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.merchandiserequestlogtbl.inventory_original_quantity IS
  'CMS-requested quantity before RHET warehouse adjustment (set once on first adjustment).';

COMMENT ON COLUMN public.merchandiserequestlogtbl.inventory_adjustment_remarks IS
  'RHET warehouse note when quantity was reduced before ship.';

COMMENT ON COLUMN public.merchandiserequestlogtbl.inventory_adjusted_by IS
  'RHET staff display name who adjusted quantity (never UUID).';

COMMENT ON COLUMN public.merchandiserequestlogtbl.inventory_adjusted_at IS
  'When RHET recorded the quantity adjustment.';
