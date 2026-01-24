-- Migration: Add downpayment support to installment packages
-- Description: Adds downpayment_amount to packagestbl and downpayment tracking to installmentinvoiceprofilestbl

BEGIN;

-- Add downpayment_amount column to packagestbl
-- This column stores the downpayment amount for Installment type packages
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'packagestbl' AND column_name = 'downpayment_amount'
    ) THEN
        ALTER TABLE packagestbl ADD COLUMN downpayment_amount NUMERIC(10, 2) DEFAULT NULL;
        COMMENT ON COLUMN packagestbl.downpayment_amount IS 'Downpayment amount required before starting installment invoices. Only applicable for Installment package type.';
    END IF;
END $$;

-- Add downpayment_paid flag to installmentinvoiceprofilestbl
-- This tracks whether the downpayment invoice has been paid
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'installmentinvoiceprofilestbl' AND column_name = 'downpayment_paid'
    ) THEN
        ALTER TABLE installmentinvoiceprofilestbl ADD COLUMN downpayment_paid BOOLEAN DEFAULT false;
        COMMENT ON COLUMN installmentinvoiceprofilestbl.downpayment_paid IS 'Indicates whether the downpayment invoice has been paid. Installment invoices will only be generated when this is true.';
    END IF;
END $$;

-- Add downpayment_invoice_id to installmentinvoiceprofilestbl
-- This links to the downpayment invoice for tracking
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'installmentinvoiceprofilestbl' AND column_name = 'downpayment_invoice_id'
    ) THEN
        ALTER TABLE installmentinvoiceprofilestbl ADD COLUMN downpayment_invoice_id INTEGER;
        COMMENT ON COLUMN installmentinvoiceprofilestbl.downpayment_invoice_id IS 'Reference to the downpayment invoice. Used to track when downpayment is paid.';
        
        -- Add foreign key constraint
        ALTER TABLE installmentinvoiceprofilestbl 
        ADD CONSTRAINT installmentinvoiceprofilestbl_downpayment_invoice_id_fkey 
        FOREIGN KEY (downpayment_invoice_id) 
        REFERENCES invoicestbl(invoice_id) 
        ON UPDATE NO ACTION 
        ON DELETE SET NULL;
        
        -- Add index for performance
        CREATE INDEX IF NOT EXISTS idx_installmentprofile_downpayment_invoice_id 
        ON installmentinvoiceprofilestbl(downpayment_invoice_id);
    END IF;
END $$;

-- Set downpayment_paid = true for existing installment profiles
-- This assumes existing profiles have already paid their initial amount
UPDATE installmentinvoiceprofilestbl 
SET downpayment_paid = true 
WHERE downpayment_paid = false 
  AND is_active = true;

COMMIT;
