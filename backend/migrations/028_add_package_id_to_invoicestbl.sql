-- Add package_id to invoicestbl to track which package was used for each invoice
-- This is needed for promo package student limit tracking

ALTER TABLE invoicestbl 
ADD COLUMN IF NOT EXISTS package_id INTEGER;

-- Add foreign key constraint
ALTER TABLE invoicestbl
ADD CONSTRAINT invoicestbl_package_id_fkey 
FOREIGN KEY (package_id) 
REFERENCES packagestbl(package_id) 
ON UPDATE NO ACTION 
ON DELETE SET NULL;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_invoice_package_id 
ON invoicestbl(package_id);

COMMENT ON COLUMN invoicestbl.package_id 
IS 'Links invoice to package. Used to track which package was used, especially for promo package student limit tracking.';

