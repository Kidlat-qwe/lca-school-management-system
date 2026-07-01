-- 057_add_installment_delinquency_fields.sql
-- Adds soft-removal fields for enrollments and a one-time late penalty guard on invoices.

-- 1) Keep delinquent students visible but excluded from capacity counts
ALTER TABLE IF EXISTS public.classstudentstbl
  ADD COLUMN IF NOT EXISTS enrollment_status character varying(20) DEFAULT 'Active'::character varying,
  ADD COLUMN IF NOT EXISTS removed_at timestamp without time zone,
  ADD COLUMN IF NOT EXISTS removed_reason text,
  ADD COLUMN IF NOT EXISTS removed_by character varying(255) COLLATE pg_catalog."default";

-- Backfill any NULL status to Active for safety
UPDATE public.classstudentstbl
SET enrollment_status = 'Active'
WHERE enrollment_status IS NULL;

-- 2) Guard to prevent duplicate late penalties (one-time per due_date)
ALTER TABLE IF EXISTS public.invoicestbl
  ADD COLUMN IF NOT EXISTS late_penalty_applied_for_due_date date;

