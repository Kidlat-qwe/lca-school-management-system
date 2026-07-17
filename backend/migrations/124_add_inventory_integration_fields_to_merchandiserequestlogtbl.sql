BEGIN;

-- Track RHET Centralized Inventory integration sync state for merchandise stock requests.
-- See backend/services/inventory/README.md and PSMS_API_INTEGRATION.md for the full flow.
ALTER TABLE public.merchandiserequestlogtbl
  ADD COLUMN IF NOT EXISTS inventory_request_id uuid,
  ADD COLUMN IF NOT EXISTS inventory_status character varying(20),
  ADD COLUMN IF NOT EXISTS inventory_external_reference character varying(100),
  ADD COLUMN IF NOT EXISTS inventory_matched_sku character varying(64),
  ADD COLUMN IF NOT EXISTS inventory_rejection_reason text,
  ADD COLUMN IF NOT EXISTS inventory_synced_at timestamptz;

COMMENT ON COLUMN public.merchandiserequestlogtbl.inventory_request_id
  IS 'RHET Inventory stock request UUID returned from POST /stock-requests';

COMMENT ON COLUMN public.merchandiserequestlogtbl.inventory_status
  IS 'RHET Inventory status: PENDING, FULFILLED, REJECTED, FAILED';

COMMENT ON COLUMN public.merchandiserequestlogtbl.inventory_external_reference
  IS 'externalReference sent to RHET, format <INVENTORY_SYSTEM_CODE>-<request_id>, e.g. PSMS-123';

COMMENT ON COLUMN public.merchandiserequestlogtbl.inventory_matched_sku
  IS 'SKU RHET matched the request to (from webhook payload), for reference only';

COMMENT ON COLUMN public.merchandiserequestlogtbl.inventory_rejection_reason
  IS 'Rejection or failure reason from RHET Inventory webhook';

COMMENT ON COLUMN public.merchandiserequestlogtbl.inventory_synced_at
  IS 'Timestamp of the last successful sync (submit or webhook update) with RHET Inventory';

CREATE INDEX IF NOT EXISTS idx_merchrequest_inventory_request_id
  ON public.merchandiserequestlogtbl(inventory_request_id);

CREATE INDEX IF NOT EXISTS idx_merchrequest_inventory_external_reference
  ON public.merchandiserequestlogtbl(inventory_external_reference);

COMMIT;
