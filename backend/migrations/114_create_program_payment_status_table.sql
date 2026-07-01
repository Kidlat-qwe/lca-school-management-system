-- ============================================================
-- 114_create_program_payment_status_table.sql
--
-- Tracks the program-facing payment lifecycle for each invoice/student.
-- This table complements invoicestbl.status; it does not replace it.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.program_payment_statustbl (
  program_payment_status_id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL,
  class_id INTEGER NULL,
  invoice_id INTEGER NOT NULL,
  branch_id INTEGER NULL,
  installmentinvoiceprofiles_id INTEGER NULL,
  status character varying(30) NOT NULL DEFAULT 'wait_for_payment',
  invoice_status_snapshot character varying(50) NULL,
  invoice_due_date DATE NULL,
  grace_until DATE NULL,
  paid_at DATE NULL,
  computed_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_program_payment_status
    CHECK (status IN ('wait_for_payment', 'paid', 'under_grace_period', 'due_date')),
  CONSTRAINT uq_program_payment_status_invoice_student
    UNIQUE (invoice_id, student_id),
  CONSTRAINT program_payment_status_student_fkey
    FOREIGN KEY (student_id) REFERENCES public.userstbl(user_id) ON DELETE CASCADE,
  CONSTRAINT program_payment_status_class_fkey
    FOREIGN KEY (class_id) REFERENCES public.classestbl(class_id) ON DELETE SET NULL,
  CONSTRAINT program_payment_status_invoice_fkey
    FOREIGN KEY (invoice_id) REFERENCES public.invoicestbl(invoice_id) ON DELETE CASCADE,
  CONSTRAINT program_payment_status_branch_fkey
    FOREIGN KEY (branch_id) REFERENCES public.branchestbl(branch_id) ON DELETE SET NULL,
  CONSTRAINT program_payment_status_installment_profile_fkey
    FOREIGN KEY (installmentinvoiceprofiles_id)
      REFERENCES public.installmentinvoiceprofilestbl(installmentinvoiceprofiles_id)
      ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_program_payment_status_student
  ON public.program_payment_statustbl(student_id);

CREATE INDEX IF NOT EXISTS idx_program_payment_status_class
  ON public.program_payment_statustbl(class_id);

CREATE INDEX IF NOT EXISTS idx_program_payment_status_invoice
  ON public.program_payment_statustbl(invoice_id);

CREATE INDEX IF NOT EXISTS idx_program_payment_status_status
  ON public.program_payment_statustbl(status);

CREATE INDEX IF NOT EXISTS idx_program_payment_status_due_date
  ON public.program_payment_statustbl(invoice_due_date);

COMMENT ON TABLE public.program_payment_statustbl IS
  'Program-facing payment lifecycle per invoice/student. Values: wait_for_payment, paid, under_grace_period, due_date.';

COMMENT ON COLUMN public.program_payment_statustbl.status IS
  'wait_for_payment = generated and unpaid before due date; paid = invoice paid; under_grace_period = unpaid after due date within grace; due_date = unpaid after grace period.';

COMMENT ON COLUMN public.program_payment_statustbl.invoice_due_date IS
  'Snapshot of invoicestbl.due_date used to compute the lifecycle status.';

COMMENT ON COLUMN public.program_payment_statustbl.grace_until IS
  'Last date covered by the configured grace period. The due_date status starts after this date.';
