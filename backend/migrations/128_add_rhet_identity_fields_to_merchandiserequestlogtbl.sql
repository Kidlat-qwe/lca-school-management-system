-- Migration 128: Store RHET catalog identity on merchandise stock requests.
-- Request Stock now picks RHET categoryName + itemName/sku (or gender/type/size),
-- not local-only labels like "LCA Bag". Apply manually (psql / Coolify DB shell).
-- Safe to re-run.

ALTER TABLE merchandiserequestlogtbl
  ADD COLUMN IF NOT EXISTS inventory_category_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS inventory_item_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS inventory_requested_sku VARCHAR(64);

COMMENT ON COLUMN merchandiserequestlogtbl.inventory_category_name IS
  'Exact RHET Inventory categoryName selected at request time (e.g. School Uniform, Backpack)';

COMMENT ON COLUMN merchandiserequestlogtbl.inventory_item_name IS
  'Exact RHET itemName for non-uniform requests (e.g. school-backpack)';

COMMENT ON COLUMN merchandiserequestlogtbl.inventory_requested_sku IS
  'Optional RHET SKU selected at request time (before matchedSku from fulfill)';
