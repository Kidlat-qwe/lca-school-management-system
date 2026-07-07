ALTER TABLE userstbl
ADD COLUMN IF NOT EXISTS nickname VARCHAR(100);

COMMENT ON COLUMN userstbl.nickname IS 'Optional user nickname used for issued-by display and receipts.';
