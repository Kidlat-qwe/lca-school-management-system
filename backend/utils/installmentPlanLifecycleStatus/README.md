# Installment plan lifecycle display status

Module: `backend/utils/installmentPlanLifecycleStatus/index.js`

Student History → Invoices **Status** must match the re-enrollment month matrix Active / Inactive overlay.

## Two different flags

| Flag | Meaning |
|------|---------|
| `installmentinvoiceprofilestbl.is_active` | Plan is still open (generation, unrejoined drop, last phase generated) |
| `lifecycle_is_active` (API display) | Same rule as the matrix: unpaid **current** installment past due (including under grace) → Inactive |

Do **not** flip `is_active` only because a phase is overdue or under grace. That would stop generation and break Move Student for students who are still on the plan.

## Display rule

1. Upgraded to full payment → Inactive
2. Stored `is_active === false` (drop / finished / class closed) → Inactive
3. A generated, **non-dropped** installment phase has remaining balance and `due_date` **before today** (Asia/Manila) → Inactive
4. Otherwise → Active

Dropped unpaid history (e.g. Phase 1 dropped, later rejoin) does **not** force Inactive.

Used by: `GET /installment-invoices/profiles/:id/phases` (`profile.lifecycle_is_active`). Frontend Status card prefers that field.
