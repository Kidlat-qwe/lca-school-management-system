BEGIN;

-- Remove price and stock_remarks columns from merchandiserequestlogtbl
ALTER TABLE merchandiserequestlogtbl
DROP COLUMN IF EXISTS price,
DROP COLUMN IF EXISTS stock_remarks;

COMMIT;

