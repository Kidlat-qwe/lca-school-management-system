-- Who is responsible for fixing a payment when Finance returns it (usually the invoice issuer).
-- Used for Payment Logs "Return" tab visibility and targeted notifications.

ALTER TABLE IF EXISTS public.paymenttbl
  ADD COLUMN IF NOT EXISTS action_owner_user_id integer NULL;

COMMENT ON COLUMN public.paymenttbl.action_owner_user_id IS
  'User responsible for return fixes — aligned with invoicestbl.created_by (invoice issuer). Used for my_return_queue and notifications.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'paymenttbl_action_owner_user_id_fkey'
  ) THEN
    ALTER TABLE public.paymenttbl
      ADD CONSTRAINT paymenttbl_action_owner_user_id_fkey
      FOREIGN KEY (action_owner_user_id) REFERENCES public.userstbl (user_id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_paymenttbl_action_owner_user_id
  ON public.paymenttbl (action_owner_user_id);

-- Backfill: prefer invoice issuer, then payment encoder
UPDATE public.paymenttbl p
SET action_owner_user_id = i.created_by
FROM public.invoicestbl i
WHERE p.invoice_id = i.invoice_id
  AND p.action_owner_user_id IS NULL
  AND i.created_by IS NOT NULL;

UPDATE public.paymenttbl
SET action_owner_user_id = created_by
WHERE action_owner_user_id IS NULL
  AND created_by IS NOT NULL;
