-- Track when a payment row was last saved in the system (distinct from issue_date / payment date).

ALTER TABLE public.paymenttbl
  ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP;

DROP TRIGGER IF EXISTS trg_paymenttbl_updated_at ON public.paymenttbl;
DROP TRIGGER IF EXISTS trg_paymenttbl_updated_at_insert ON public.paymenttbl;
DROP TRIGGER IF EXISTS trg_paymenttbl_updated_at_update ON public.paymenttbl;

UPDATE public.paymenttbl
SET updated_at = GREATEST(
  created_at,
  COALESCE(approved_at, created_at),
  COALESCE(returned_at, created_at),
  COALESCE(rejected_at, created_at)
);

COMMENT ON COLUMN public.paymenttbl.updated_at IS
  'When this payment row was last saved in the system (distinct from issue_date payment date).';

CREATE OR REPLACE FUNCTION public.paymenttbl_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_paymenttbl_updated_at_insert
  BEFORE INSERT ON public.paymenttbl
  FOR EACH ROW
  EXECUTE FUNCTION public.paymenttbl_set_updated_at();

CREATE TRIGGER trg_paymenttbl_updated_at_update
  BEFORE UPDATE ON public.paymenttbl
  FOR EACH ROW
  EXECUTE FUNCTION public.paymenttbl_set_updated_at();
