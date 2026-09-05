# Installment delinquency auto-drop

Module: `../installmentDelinquencyDrop.js`

## Purpose

When an installment phase invoice still has **remaining balance** after
`due_date + installment_final_dropoff_days` (default 30), the student is marked
**dropped** for that class phase.

This includes the **partial-payment scenario**: any amount already paid with
remaining unpaid past dropoff still auto-drops (so the student can attend on
partial, then drop if the balance is never settled).

## Entry points

- **Daily cron** — `jobs/installmentDelinquencyScheduler.js` → `processInstallmentDelinquencies()` in `installmentDelinquencyService.js` (late penalty + drop)
- **Installment plan UI** — `GET /installment-invoices/profiles/:id/phases` calls `syncInstallmentDelinquencyDropsForProfile()` before loading enrollment
- **Branch Admin alert** — `GET /installment-invoices/upcoming-delinquency-drops` → `listUpcomingDelinquencyDrops()` (students whose drop date falls within the next 7 days; powers the Admin login-time urgent modal and Admin/Superadmin Installment Invoice **Student drop off list** tab). Superadmin has no login modal; Superadmin may pass optional `?branch_id=` or list all branches.

## Late penalty idempotency (partial-pay chains)

`processInstallmentDelinquencies` applies a **one-time** late penalty (`installment_penalty_rate` after `installment_penalty_grace_days`) on the payable **leaf** of the invoice chain.

| Rule | Behavior |
|------|----------|
| Where penalty line is written | Payable leaf (`getChainFinancialSummary` → `payable_invoice_id`) |
| Idempotency check | Any invoice in the chain already has `late_penalty_applied_for_due_date` equal to that chain’s `due_date` |
| After apply | Stamp `late_penalty_applied_for_due_date` on **all** invoices in the chain |
| Candidate order | Prefer leaf / continuation rows (`invoice_chain_root_id IS NOT NULL`) so the job locks the payable invoice when possible |

**Why:** On partial payment, the parent stays `Partially Paid` (still overdue) while the balance leaf holds remaining + penalties. Checking/stamping only the leaf left the parent unflagged, so the nightly job re-applied 10% on the inflated leaf and compounded balances (e.g. stacked “Late Payment Penalty (10%)” lines).

## UI expectations

- Enrollment column shows **Dropped** (red)
- For **partial drops**: **Pay Now** settles remaining on that phase; Rejoin/next phase is blocked until settled
- For **fully unpaid drops**: invoice not payable on Invoice page — use Rejoin (later phase)
- Dropped phases block advance pay on later phases until settled / rejoined

## Exclusions

- **Paid / cancelled** invoices (remaining ≤ 0)
- **Manual repair waiver** — invoice `remarks` containing `DELINQUENCY_DROP_WAIVED`
- **Upgraded to full payment** — paid `PACKAGE_CHANGE_TO_FULLPAYMENT` conversion for the same `PROFILE_ID` (leftover Unpaid phase invoices must not re-drop)

## Partial-payment path (after drop)

1. Partial pay → enroll **`re_enrolled`** (attendance)
2. Remaining past dropoff → **`dropped`**
3. Settle remaining → **`dropped` → `re_enrolled`**, reactivate plan
4. Next phase pay → **`re_enrolled`** (not `rejoin`)

## After drop

- Sets `installmentinvoiceprofilestbl.is_active = false` for that student/class (stops new installment generation) until settle/rejoin reactivates
- Billing email/SMS are suppressed via `billingNotificationEligibility.js` while dropped and not rejoined
