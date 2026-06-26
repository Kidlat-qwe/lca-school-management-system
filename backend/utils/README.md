# Backend utilities

## `acknowledgementReceiptStatus.js`

Shared AR status constants and list-filter SQL helpers for `routes/acknowledgementreceipts.js`.

- `AR_STATUS` / `AR_UNVERIFIED_STATUSES` — canonical status values (includes legacy `Submitted` / `Paid`)
- `isArReturnedForCorrection` — Finance return detected via `[Returned]` notes (not a separate DB status)
- `expandArStatusFilterValues`, `buildArReturnedOnlySql`, `buildArExcludeReturnedSql`, `buildArListStatusFilterSql`, `buildArAdminStatusFilterSql`, `resolveArEffectiveStatus` — GET list filters and Financial Dashboard AR verification cards
- Legacy `Paid` rows: non-cash → Unverified bucket; cash → Verified bucket (by `payment_method`)

Frontend mirror: `frontend/src/utils/acknowledgementReceiptStatus.js`.

## `installmentEnrollmentSync.js`

Enrolls a student in the class phase after an installment phase invoice receives payment.

| Rule | Behavior |
|------|----------|
| Full phase payment | Promotes `pending_enrollment` or inserts active phase row; marks final phase `completed` when the profile is fully settled |
| **Partial phase payment** | Same enrollment for that phase once any amount is recorded on the invoice chain; remaining balance must be settled before the next phase is payable (`installmentPaymentEligibility.js`) |
| Downpayment | Unchanged — requires **full** downpayment before first phase invoice is generated |

Used by: `routes/payments.js`, `routes/acknowledgementreceipts.js`, `routes/installmentinvoices.js` (partial advance-pay).

## `installmentDelinquencyDrop.js`

Auto-drop students when an installment phase invoice is unpaid past **`installment_final_dropoff_days`** after `due_date`.

| Rule | Behavior |
|------|----------|
| Eligibility | Unpaid chain (no partial payment), `due_date + final_dropoff_days` reached |
| Phase targeting | Uses **absolute** `classstudentstbl.phase_number` (not profile-local slot) |
| No enrollment row | Inserts a `dropped` marker row for that phase |
| Plan view sync | `GET .../profiles/:id/phases` runs sync so Student History shows **Dropped** immediately |
| Daily job | `installmentDelinquencyService.js` + `installmentDelinquencyScheduler.js` |

Partially paid phases are **not** auto-dropped (student remains enrolled until balance is settled or manually dropped).

## `installmentPhaseBillingSync.js`

Keeps installment **phase slots**, **`generated_count`**, and **`TARGET_PHASE`** invoice remarks aligned.

| Problem | Fix |
|---------|-----|
| `generated_count` ahead of actual invoices (next generate skips a phase) | `syncInstallmentGeneratedCountToNextUnbilled()` sets count from the lowest empty profile-local slot |
| Student History shows Phase 3 empty but Phase 4 billed (no drop/rejoin) | `resolvePhaseChainByLocalSlot()` remaps chains to sequential slots 1..N for display |
| Advance pay skipped ahead of unbilled phases | `POST .../advance-pay` only allows the **next unbilled** local phase; sets `generated_count = phase_index` |
| Persist wrong `TARGET_PHASE` on existing rows | `node scripts/repairInstallmentPhaseAlignment.js --email ... --apply` |

Used by: `GET /installment-invoices/profiles/:id/phases`, manual/auto invoice generation, advance-pay.

Phase API rows include `amount`, `paid_amount`, `remaining_balance` / `balance` (invoice-chain summary), and `invoice_id` as the payable leaf after partial payment.

## `installmentPhaseRowMapping.js`

Maps invoice chains to profile-local phase rows for Student History / Installment Plan tables. See `normalizeAdjacentPhaseDisplayDates` for issue-date display ordering.

`resolveInstallmentPhaseEnrollmentStatus` / `inferInstallmentPhaseEnrollmentStatus`: the first **paid** plan phase shows **new** (e.g. display Phase 2 when Phase 1 is a late-start gap); later paid phases show **re_enrolled** unless a prior **dropped** phase triggers **rejoin**.

`isInstallmentPlanSlotAddressed` / `annotateInstallmentPhasePlanSlots` mark a phase as cleared when it is paid, skipped, or has no outstanding balance — used so **Pay Now** / advance-pay unlocks the next phase when prior slots are settled.
