# Backend utilities

## `acknowledgementReceiptStatus.js`

Shared AR status constants and list-filter SQL helpers for `routes/acknowledgementreceipts.js`.

- `AR_STATUS` / `AR_UNVERIFIED_STATUSES` — canonical status values (includes legacy `Submitted` / `Paid`)
- `isArReturnedForCorrection` — Finance return detected via `[Returned]` notes (not a separate DB status)
- `expandArStatusFilterValues`, `buildArReturnedOnlySql`, `buildArExcludeReturnedSql`, `buildArListStatusFilterSql`, `buildArAdminStatusFilterSql`, `resolveArEffectiveStatus` — GET list filters and Financial Dashboard AR verification cards
- Legacy `Paid` rows: non-cash → Unverified bucket; cash → Verified bucket (by `payment_method`)

Frontend mirror: `frontend/src/utils/acknowledgementReceiptStatus.js`.

## `classLifecycle/`

Soft-archive + end-of-class finalization. See [classLifecycle/README.md](./classLifecycle/README.md).

- When `end_date` passes: class → **Inactive**, latest active enrollment → **completed**, installment profiles deactivated
- Classes UI **Archive** (DELETE) soft-deletes to Settings → Archived Classes for 30 days
- Cron: `POST /classes/purge-archived` permanently deletes expired archives

## `classSessionTeacherSync.js`

Aligns `classsessionstbl` teacher fields with the class primary teacher (`classestbl.teacher_id` / `classteacherstbl`).

| Rule | Behavior |
|------|----------|
| Substitute sessions | Left unchanged when `substitute_teacher_id` is set |
| Class teacher update | `PUT /classes/:id` syncs non-substitute sessions after teacher change |
| Session regeneration | UPSERT updates `assigned_teacher_id` unless a substitute is active |

Used by: `routes/classes.js`, repair scripts under `scripts/`.

## `cashDepositSummarySchema.js`

Idempotent schema guard for `cash_deposit_summarytbl` extended columns (`deposit_attachment_url_2`, `submission_remarks` — migration 121).

Called before cash deposit **create** and **resubmit** so writes do not fail when migration 121 was not applied yet.

Used by: `routes/cashDepositSummaries.js`.


Enrolls a student in the class phase after an installment phase invoice receives payment.

| Rule | Behavior |
|------|----------|
| Full phase payment | Promotes `pending_enrollment` or inserts active phase row; marks final phase `completed` when the profile is fully settled |
| **Partial phase payment** | Same enrollment for that phase once any amount is recorded on the invoice chain; remaining balance must be settled before the next phase is payable (`installmentPaymentEligibility.js`) |
| Downpayment | Unchanged — requires **full** downpayment before first phase invoice is generated |

Used by: `routes/payments.js`, `routes/acknowledgementreceipts.js`, `routes/installmentinvoices.js` (partial advance-pay).

## `installmentPlanLifecycleStatus/`

Student History plan Status vs month-matrix Active/Inactive. See [installmentPlanLifecycleStatus/README.md](./installmentPlanLifecycleStatus/README.md).

- Stored `is_active` is unchanged (generation / unrejoined drop)
- Display Inactive when a **current** unpaid installment is past due, including under grace
- `GET .../profiles/:id/phases` returns `profile.lifecycle_is_active`

## `installmentProfileActivity/`

Keeps installment `is_active` aligned with **unrejoined drops** (dropped on a class with no later active phase on that class). See [installmentProfileActivity/README.md](./installmentProfileActivity/README.md).

- Student History plan Status → Inactive for unrejoined drops (`is_active = false`); overdue/grace overlay is `installmentPlanLifecycleStatus`
- Re-enrollment matrix → Inactive lifecycle cells for that track (`profile_is_active = false`)
- Wired into `billingNotificationEligibility.js` (reactivate / class-status sync)

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
| Advance pay skipped ahead of unbilled phases | `POST .../advance-pay` only allows the **next unbilled** local phase; sets `generated_count = phase_index`; advances `next_generation_date` / `next_invoice_month` by **one billing cycle** from the current queue (`advanceInstallmentQueueByOneCycle`) |
| Persist wrong `TARGET_PHASE` on existing rows | `node scripts/repairInstallmentPhaseAlignment.js --email ... --apply` |

Used by: `GET /installment-invoices/profiles/:id/phases`, manual/auto invoice generation, advance-pay.

Phase API rows include `amount`, `paid_amount`, `remaining_balance` / `balance` (invoice-chain summary), and `invoice_id` as the payable leaf after partial payment.

## `phaseInstallmentUtils.js`

Builds class-linked installment issue / due / queue dates (`buildPhaseInstallmentSchedule`).

| Rule | Behavior |
|------|----------|
| First phase (`generated_count = 0`) | Due = day before that phase’s first session; issue = enrollment / payment day |
| Class start day 1–N (`installment_first_week_last_day`, default **7**) | Recurring cadence **25th / next-month 5th** |
| Class start day after N | Recurring cadence **1st / same-month 5th** |
| Skip gap (`installment_first_of_month_skip_gap_days`, default **7**) | If the next 1st is ≤ N days after class start, skip to the following 1st (e.g. gap=7, June 24 → Aug 1) |
| Existing queues | Day-25 `next_generation_date` stays on 25/5 (grandfather). Start-date rebuild uses `ignoreStoredQueueAnchor` + new class start |
| Late joiners | Same class cadence; first invoice stays phase-tied; first recurring 1st is after that invoice (still respects the class skip) |
| Grace / drop-off | Unchanged — still based on invoice `due_date` (5th) |
| Settings UI | Superadmin / Admin → **Invoice Schedule** → Mid-month billing cadence |

Used by: enrollment (`routes/classes.js`), daily generation (`installmentInvoiceGenerator.js`), class start-date billing realignment.

Tests: `node backend/tests/phaseInstallmentCadence.test.js`.

## `installmentPhaseRowMapping.js`

Maps invoice chains to profile-local phase rows for Student History / Installment Plan tables. See `normalizeAdjacentPhaseDisplayDates` for issue-date display ordering.

`resolveInstallmentPhaseEnrollmentStatus` / `inferInstallmentPhaseEnrollmentStatus`: the first **paid** plan phase shows **new** (e.g. display Phase 2 when Phase 1 is a late-start gap); later paid phases show **re_enrolled** unless a prior **dropped** phase triggers **rejoin**. When all plan slots are paid, the **final** phase shows **completed** (matches re-enrollment matrix terminal cell). **One-phase** plans (`total_phases = 1`) show **completed** once the single slot is paid.

`isInstallmentPlanSlotAddressed` / `annotateInstallmentPhasePlanSlots` mark a phase as cleared when it is paid, skipped, or has no outstanding balance — used so **Pay Now** / advance-pay unlocks the next phase when prior slots are settled.

## `billingNotificationEligibility.js`

Gates **monthly invoice notice** and **overdue payment reminder** email/SMS for class-linked billing.

| Rule | Behavior |
|------|----------|
| Active enrollment (`new`, `re_enrolled`, `upsell`, `rejoin`, `removed_at IS NULL`) | Notifications allowed |
| Dropped in class, no active enrollment | **Email and SMS skipped** |
| Rejoined after drop | Notifications resume |
| Non-class invoice (no `class_id` resolved) | Allowed (e.g. merchandise) |

Used by: `monthlyInvoiceNoticeEmailService.js`, `overdueInvoiceAutoEmailService.js`, `emailService.sendOverduePaymentReminderEmail`, manual `POST /invoices/:id/send-overdue-email`.

`deactivateInstallmentProfileForClassDrop()` — sets `installmentinvoiceprofilestbl.is_active = false` on manual drop (`routes/students.js`) and auto delinquency drop (`installmentDelinquencyDrop.js`).
