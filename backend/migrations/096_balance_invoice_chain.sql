-- Balance invoice chain: after a Partial Payment, remaining balance moves to a new invoice;
-- the superseded invoice becomes non-payable (status Balance Invoiced) with balance_invoice_id set.

ALTER TABLE public.invoicestbl
  ADD COLUMN IF NOT EXISTS parent_invoice_id INTEGER,
  ADD COLUMN IF NOT EXISTS balance_invoice_id INTEGER,
  ADD COLUMN IF NOT EXISTS invoice_chain_root_id INTEGER;

ALTER TABLE public.invoicestbl
  DROP CONSTRAINT IF EXISTS invoicestbl_parent_invoice_id_fkey;

ALTER TABLE public.invoicestbl
  ADD CONSTRAINT invoicestbl_parent_invoice_id_fkey
    FOREIGN KEY (parent_invoice_id) REFERENCES public.invoicestbl (invoice_id)
    ON DELETE SET NULL;

ALTER TABLE public.invoicestbl
  DROP CONSTRAINT IF EXISTS invoicestbl_balance_invoice_id_fkey;

ALTER TABLE public.invoicestbl
  ADD CONSTRAINT invoicestbl_balance_invoice_id_fkey
    FOREIGN KEY (balance_invoice_id) REFERENCES public.invoicestbl (invoice_id)
    ON DELETE SET NULL;

ALTER TABLE public.invoicestbl
  DROP CONSTRAINT IF EXISTS invoicestbl_invoice_chain_root_id_fkey;

ALTER TABLE public.invoicestbl
  ADD CONSTRAINT invoicestbl_invoice_chain_root_id_fkey
    FOREIGN KEY (invoice_chain_root_id) REFERENCES public.invoicestbl (invoice_id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoicestbl_parent_invoice_id ON public.invoicestbl (parent_invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoicestbl_balance_invoice_id ON public.invoicestbl (balance_invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoicestbl_invoice_chain_root_id ON public.invoicestbl (invoice_chain_root_id);

COMMENT ON COLUMN public.invoicestbl.parent_invoice_id IS
  'Previous invoice in chain when this row was generated to carry the remaining balance.';

COMMENT ON COLUMN public.invoicestbl.balance_invoice_id IS
  'If set, remaining balance was moved to this invoice — do not record new payments here.';

COMMENT ON COLUMN public.invoicestbl.invoice_chain_root_id IS
  'First invoice in this billing chain; reservation / profile links use the root.';
