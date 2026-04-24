ALTER TABLE public.paymenttbl
ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(12, 2) DEFAULT 0;

ALTER TABLE public.acknowledgement_receiptstbl
ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(12, 2) DEFAULT 0;
