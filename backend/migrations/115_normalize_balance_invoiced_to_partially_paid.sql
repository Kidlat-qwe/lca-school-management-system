-- Balance invoice chain: parent invoices use Partially Paid (same label as partial payments).
-- Payment routing still uses balance_invoice_id; status Balance Invoiced is retired.
UPDATE invoicestbl
SET status = 'Partially Paid'
WHERE status = 'Balance Invoiced';
