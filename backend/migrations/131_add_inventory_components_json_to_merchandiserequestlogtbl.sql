-- Migration 131: Persist Learning Kit components[] snapshot on stock requests.
-- Used for RHET forward, support/repair, and audit of kit BOM choices.

ALTER TABLE public.merchandiserequestlogtbl
  ADD COLUMN IF NOT EXISTS inventory_components_json JSONB;

COMMENT ON COLUMN public.merchandiserequestlogtbl.inventory_components_json IS
  'Learning Kit request components[] sent to RHET (concrete uniform/other choices per BOM category)';
