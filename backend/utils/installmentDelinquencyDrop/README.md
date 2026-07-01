# Installment delinquency auto-drop

Module: `../installmentDelinquencyDrop.js`

## Purpose

When an installment phase invoice remains **fully unpaid** after `due_date + installment_final_dropoff_days` (default 30), the student is marked **dropped** for that class phase.

## Entry points

- **Daily cron** — `jobs/installmentDelinquencyScheduler.js` → `processInstallmentDelinquencies()`
- **Installment plan UI** — `GET /installment-invoices/profiles/:id/phases` calls `syncInstallmentDelinquencyDropsForProfile()` before loading enrollment

## UI expectations

- Enrollment column shows **Dropped** (red)
- **Pay Now** is hidden on dropped phases; the next payable phase gets the action
- Dropped phases do not block advance pay on later phases (delinquency skip)

## Exclusions

- **Partial payment** — any amount paid on the invoice chain skips auto-drop
- **Paid / cancelled** invoices

## After drop

- Sets `installmentinvoiceprofilestbl.is_active = false` for that student/class (stops new installment generation)
- Billing email/SMS are suppressed via `billingNotificationEligibility.js` while dropped and not rejoined
