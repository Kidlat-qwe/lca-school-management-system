-- FIUU token billing snapshot for Recurring MIT match (name/email/mobile).
-- FIUU requires MIT billing fields to match the original tokenization profile.
BEGIN;

ALTER TABLE public.fiuu_payment_tokenstbl
  ADD COLUMN IF NOT EXISTS billing_name character varying(128),
  ADD COLUMN IF NOT EXISTS billing_email character varying(128),
  ADD COLUMN IF NOT EXISTS billing_mobile character varying(32);

COMMENT ON COLUMN public.fiuu_payment_tokenstbl.billing_name
  IS 'Exact bill_name sent/stored at tokenization; reuse on Recurring MIT.';
COMMENT ON COLUMN public.fiuu_payment_tokenstbl.billing_email
  IS 'Exact bill_email sent/stored at tokenization; reuse on Recurring MIT.';
COMMENT ON COLUMN public.fiuu_payment_tokenstbl.billing_mobile
  IS 'Exact bill_mobile sent/stored at tokenization; reuse on Recurring MIT.';

-- Backfill from source HPP gateway raw_request when present.
UPDATE public.fiuu_payment_tokenstbl t
SET billing_name = COALESCE(NULLIF(TRIM(t.billing_name), ''), NULLIF(TRIM(g.raw_request->>'bill_name'), '')),
    billing_email = COALESCE(NULLIF(TRIM(t.billing_email), ''), NULLIF(TRIM(g.raw_request->>'bill_email'), '')),
    billing_mobile = COALESCE(NULLIF(TRIM(t.billing_mobile), ''), NULLIF(TRIM(g.raw_request->>'bill_mobile'), '')),
    updated_at = CURRENT_TIMESTAMP
FROM public.gateway_paymentstbl g
WHERE g.gateway_payment_id = t.gateway_payment_id
  AND (
    t.billing_name IS NULL
    OR t.billing_email IS NULL
    OR t.billing_mobile IS NULL
    OR TRIM(COALESCE(t.billing_name, '')) = ''
    OR TRIM(COALESCE(t.billing_email, '')) = ''
    OR TRIM(COALESCE(t.billing_mobile, '')) = ''
  );

COMMIT;
