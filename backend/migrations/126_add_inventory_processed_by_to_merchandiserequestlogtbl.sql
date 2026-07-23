-- Migration 126: Store who approved/rejected the request in RHET Inventory
-- Apply manually on production (psql / Coolify DB shell).
-- Safe to re-run.

ALTER TABLE merchandiserequestlogtbl
  ADD COLUMN IF NOT EXISTS inventory_processed_by VARCHAR(255);

COMMENT ON COLUMN merchandiserequestlogtbl.inventory_processed_by IS
  'Display name of the RHET Inventory user who approved or rejected this stock request';
