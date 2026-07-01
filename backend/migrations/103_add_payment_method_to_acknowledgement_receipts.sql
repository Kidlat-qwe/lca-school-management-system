ALTER TABLE public.acknowledgement_receiptstbl
ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'Cash';

COMMENT ON COLUMN public.acknowledgement_receiptstbl.payment_method
IS 'Payment method chosen during AR creation (Cash, Online Banking, Credit Card, E-wallets).';

