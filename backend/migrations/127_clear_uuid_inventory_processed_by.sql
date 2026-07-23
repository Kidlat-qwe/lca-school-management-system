-- Optional cleanup: clear UUID values wrongly stored in inventory_processed_by.
-- Re-send fulfill/reject webhook from RHET or run sync-inventory after CMS fix.
-- Safe to re-run.

UPDATE merchandiserequestlogtbl
SET inventory_processed_by = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE inventory_processed_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
