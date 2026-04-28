-- Align NULL status with application default ('Pending') used on INSERT from enrollment / payments.
UPDATE public.installmentinvoicestbl
SET status = 'Pending'
WHERE status IS NULL;
