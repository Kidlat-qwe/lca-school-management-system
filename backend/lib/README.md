# Backend shared libraries

## `cashDepositRecovery.js`

Branch-admin **Deposit Cash** recovery after hard-delete + re-enroll:

| Export | Used by |
|--------|---------|
| `getRemovedCashDepositSnapshotPayments` | `GET /payments/cash-deposit-summary?recovery_payment_date=YYYY-MM-DD` |
| `getCashDepositRecoveryGaps` | `GET /cash-deposit-summaries/recovery-gaps` |

Lists cash lines still stored on a **Submitted/Approved** deposit snapshot whose `payment_id` no longer exists in `paymenttbl`, for one payment date. The UI pairs this with live undeposited cash on that same day so admins can submit a supplemental deposit.

`getCashDepositRecoveryGaps` compares the branch admin&apos;s current Deposit Cash From–To window with prior verified deposits and returns students not yet listed in the modal: snapshot ghosts (hard delete) and completed cash outside the current range that is still undeposited.

## `closedPeriodBillingAmendment.js`

EOD amendment helpers after billing corrections (hard delete + re-enroll):

| Export | Used by |
|--------|---------|
| `eodHasAmendmentDrift` | EOD list `needs_amendment` flag |
| `getEodBackfillDates` | `POST /daily-summary-sales/backfill`, `GET /check-today` |
| `assertAdminMayAmendSummary` | `PUT /daily-summary-sales/:id/amend-for-verification` |

## `installmentPaymentEligibility.js`

Blocks recording payment on a **later** installment phase when an **earlier** phase on the same `installmentinvoiceprofiles_id` has a completed partial payment with remaining balance (balance-invoice chain included).

| Entry point | Behavior |
|-------------|----------|
| `GET /invoices/:id` | Sets `prior_partial_balance_block` and `can_record_payment: false` when blocked |
| `POST /payments` | Returns 400 with `prior_partial_balance_block` message |
| `POST /installment-invoices/profiles/:id/advance-pay` | Same check for profile-local phases before `phase_index` |

Advance pay only accepts the **next unbilled** profile-local phase (no skipping ahead). `generated_count` is set to the paid phase index. See `utils/installmentPhaseBillingSync.js`.

Next-phase **invoice generation** syncs `generated_count` to the next unbilled slot before creating an invoice.

Frontend: `frontend/src/utils/installmentPaymentBlock.js` (`getInstallmentPaymentBlockAlert`).

Partial-payment parents (`balance_invoice_id` set) are **not** payable from the list — **Pay** is disabled on that row (e.g. INV-566 after ₱3,000 partial). Record the remaining balance on the balance continuation row only (e.g. INV-567, action label **Pay balance**). Balance continuation rows are included in payment-date list filters via `issue_date` when they have no payments yet. See `frontend/src/utils/invoicePaymentTarget.js`.

## `paymentDateNetTotals.js`

Shared **net payment totals** by payment date (`paymenttbl.issue_date`) for Payment Logs, Invoice summaries, Financial Dashboard, and Monthly Operational Dashboard.

| Field | Rule |
|-------|------|
| Gross | Completed payment lines in scope (any approval status) |
| Returned deduction | `approval_status = Returned` (same payment date scope) |
| Rejected deduction | `status = Rejected` or `approval_status = Rejected` |
| **Net** | Gross − returned − rejected (aligned across all screens) |

When a returned payment is **resubmitted and approved**, or a **new payment** records after rejection, approval/status changes and net totals refresh automatically.

## `financialDashboardVerificationMetrics.js`

Superadmin **Financial Dashboard** payment / AR verification cards (`GET /dashboard` → `payment_verification`, `ar_verification`):

| Card | Matches drill-down |
|------|-------------------|
| Total Payments | Completed invoice payment lines by payment date — matches Invoice month total and Monthly Operational invoice sales / total payments |
| Verified / Unverified payments | Same payment lines with `approval_status=Approved` or pending (not Returned/Rejected) |
| Verified AR | Acknowledgement Receipts — `status=Verified,Applied`, Month filter on `ar.issue_date` |
| Unverified AR | Acknowledgement Receipts — `status=Submitted,Pending,Paid`, same month scope |

**Payment Logs** `filterTotalLineAmount` on `GET /payments/finance-unified` sums the same completed invoice payment lines (payment date). Unapplied package AR may appear in the list but is excluded from the header total. **Invoice** payment-date summary (`computeInvoiceFilterSummary`) uses the same payment-line rules.

Month scope uses inclusive calendar bounds (`YYYY-MM-01` … last day of month), same as Payment Logs month mode.

## `enrollmentRateMetrics.js`

Month and phase re-enrollment dashboard matrices (`loadStudentMonthEnrollmentMatrix`, `loadStudentPhaseEnrollmentMatrix`):

- Multi-phase classes: terminal billing phase/month shows **completed** when the student progresses past the first phase (unchanged).
- **Single-phase** classes (`curriculum.number_of_phase = 1`): the only phase/month shows **completed** when the student has paid (full payment, DB `completed` status, or all installment phases paid).
- Each matrix response includes `kpi_totals` (new / re-enrolled / reserved / upsell / dropped / rejoin) summed from visible labeled cells for the selected year scope. **Reserved** and **Upsell** KPI cards use `reserved_count` and `upsell_count` from the matrix (not a live DB snapshot).
- Month/phase matrix **rate header** numerator = visible `re-enrolled` + `completed` cells in that column (upsell excluded). **Denominator** = prior month/phase cells labeled `new`, `re-enrolled`, `rejoin`, or `upsell` only (excludes completed, pending enrollment, reserved, dropped).
- **Monthly operational dashboard** enrollment KPI cards (`new_enrollees`, `re_enrollment_count`, `upsell`, `reserved`, `completed`, `rejoin`, `dropped`, retention base, re-enrollment rate) use `loadMonthlyOperationalEnrollmentFromMonthMatrix` — the selected month's matrix column, same as the Month Re-enrollment table.
- **Phase Re-enrollment** dashboard KPI cards use the same **month** matrix totals as Month Re-enrollment when a year is selected (`kpi_card_source: month_matrix`); the phase matrix table remains for phase-by-phase drill-down.
- **New** cells that follow a paid reservation on the same class track include `from_previous_reserved: true`; the UI tooltip shows **Previous reserved**.
- **Upsell** (e.g. Pre-K → KG): month matrix merges the higher program onto the lower-program **same row**. First month after the lower program’s last enrolled (or completed) month shows **upsell**; each later higher-program billing phase maps to the following month columns (re-enrolled, then completed on the terminal phase). The higher-class row is hidden. Phase indexing uses full billing metadata so **later calendar years** show continuation on that same row (e.g. Jan–Mar 2027). Requires a higher `level_tag` on the sibling class track.

## `operationalDashboardRecentPayments.js`

Returns up to 50 completed **invoice** payments for daily / monthly operational dashboards (`recent_invoice_payments` on the API). Each row includes payment-log invoice context (`invoice_description`, installment profile, partial-payment parent, etc.) so the UI can show the same **package/item** label as Payment Logs. The UI shows three rows with vertical scroll when there are more. Filter: `paymenttbl.issue_date` in scope, `status = Completed`, approval not Returned/Rejected, `invoice_id` required. Ordered newest first.

## `dailyOperationalEnrollmentFromPayments.js`

Daily and **Monthly** Operational Dashboard enrollment KPIs: **payment issue date** filter + **`program_enrollment_status`** on the linked `classstudentstbl` row (class / phase from invoice remarks or installment profile). Monthly uses `loadMonthlyOperationalEnrollmentFromPayments` over `[month_start, month_end_exclusive)`.

| Card metric | Rule |
|-------------|------|
| New enrollees (daily) | **Distinct students** with a class payment on the summary date (`paymenttbl.issue_date`) classified as **`new`** after phase/status rules below |
| Re-enrollment (daily) | **Distinct students** with a class payment on the summary date classified as **`re_enrolled`** (upsell and completed have their own cards) |
| Upsell (daily) | Distinct students with status **`upsell`** on the summary date |
| Reserved (daily) | Distinct students with status **`reserved`** on the summary date |
| Rejoin (daily) | Distinct students with status **`rejoin`** on the summary date |
| Dropped / unenrolled (daily) | Distinct students with `program_enrollment_status = 'dropped'` and `removed_at` on the summary date (Asia/Manila) |
| Re-enrollment rate / breakdown | Still uses **phase-event KPI** count (`re_enrolled` + `upsell` + multi-phase `completed`) ÷ prior-day retention base — separate from the daily Re-enrollment summary card |
| New enrollees (monthly payment path) | Class payment phase-event on the date linked to a `new` phase row, after reclassification: not upsell, not single-phase finished package (→ completed), not middle phase of a multi-phase full payment (→ re_enrolled), and no **earlier** enrollment (same class earlier phase or other class with `enrolled_at` before this phase row — same-day upsell on a higher class later does not flip lower-program phase 1 to re_enrolled) |
| Re-enrollment (monthly payment path) | Each class payment phase-event on the date counted for the Re-enrollment KPI: `re_enrolled`, `upsell`, and `completed` on **multi-phase** classes (terminal phase on full pay). **Single-phase** completed packages count only under Completed, not here |
| Upsell | Each class payment on the date with status `upsell` |
| Reserved | Each class payment on the date with status `reserved` (e.g. reservation fee) |
| Completed | Payment phase-event linked to a `completed` phase row, the **terminal phase** of a multi-phase full payment (e.g. phase 5 on full pay 1–5), or a **single-phase** class (`number_of_phase = 1`) whose package is finished on that payment — even if the row is still `new` |
| Rejoin | Each class payment on the date with `program_enrollment_status = 'rejoin'` |
| Dropped / unenrolled | Distinct students with `program_enrollment_status = 'dropped'` and `removed_at` on the summary date (Asia/Manila) |
| Re-enrollment rate | **Re-enrollment KPI card** count for the window ÷ **retention base** (student+class tracks with enrolled class payments in the **prior calendar day or prior calendar month**) × 100 — same rule daily and monthly (e.g. 11 ÷ 4 for a day, 126 ÷ 211 for June) |
| Re-enrollment breakdown (students) | Deduped student list per branch: **full payment = 1** re-enrollment event (not per phase); **one student = 1** per branch. Drill-down via `GET /dashboard/operational-re-enrolled-students`. Rate card still uses KPI phase-event count. |
| Retention base | Distinct student+class tracks with new, re_enrolled, upsell, rejoin, or completed class payments on payment issue date in the period before the selected day/month. Shown on the Completed card |

Only class-related completed payments count (same scope as invoice sales for enrollment billing). Status `pending_enrollment` is excluded. `completed` counts in its own KPI when the linked phase row is completed. `reserved` counts in the reserved KPI. (fullpayment description or installment→full conversion; multi-phase `PHASE_START`/`PHASE_END` only when **not** linked to an installment profile). Installment phase invoices use one `classstudentstbl` row per payment (`TARGET_PHASE` / paid phase). **Installment phase-events** require a **Paid** invoice (partial payments on `Partially Paid` invoices are excluded until settled). Multiple completed payments on the same chain and phase still **dedupe to one** event. Full-payment invoices use one phase-event per row in a tight `enrolled_at` window (matrix-aligned: first phase new, middle re_enrolled, last completed) so same-day phase 1 + phase 2 installments do not bleed into each other.

## `operationalEnrollmentAudit.js`

Read-only SQL audits for enrollment KPI anomalies (full payment history; optional `--from` / `--to`). Used by `scripts/auditEnrollmentDataQuality.js`.

| Audit | Purpose |
|-------|---------|
| `auditDedupeImpactSummary` | Raw vs deduped re-enrollment KPI event counts |
| `auditPartialPaymentDoubleCount` | Installment groups with multiple payments per chain + phase + status |
| `auditBronnyLikePatterns` | Legacy cross-class flip, same-day upsell misclassification, same-day lower→higher pairs |
| `auditUpsellMergeCandidates` | Lower program `completed` + higher program active (matrix merge review) |

## `merchandiseReleaseLog.js`

Records each physical merchandise stock deduction in `merchandise_release_logtbl` for operational dashboards.

`loadRecentMerchandiseReleasesForOperationalDashboard` returns up to 50 release log lines for the daily/monthly dashboard mini-log (`recent_merchandise_releases` on the API). UI shows three rows with vertical scroll.

| Source | When logged | `release_batch_id` |
|--------|-------------|-------------------|
| `merchandise_ar` | Merchandise acknowledgement receipt created (stock deduct) | `ar-{ack_receipt_id}` |
| `package_enroll` | First qualifying package payment (downpayment or Phase 1 / full payment) | `pkg-pay-{payment_id}` |

Package included merchandise (e.g. PE uniform top + bottom):

- Stored on invoice remarks as `MERCH_PENDING:{json}` at enroll (validation only; stock not deducted yet).
- Stock deduct + log on **first payment** only, keyed by `(student_id, package_id, class_id)`.
- **Re-enrollment** with the same package/class does not issue or count again.

Dashboard daily/monthly metrics read from this table (quantity = sum of `quantity`; events = distinct `release_batch_id`).

Migration: `migrations/117_create_merchandise_release_logtbl.sql`

Package pending lines are normalized with `normalizePackageMerchLines()` so placeholder package SKUs do not duplicate configured uniform Top/Bottom or duplicate Learning Kit rows.

Backfill (optional, AR history only): `scripts/backfillMerchandiseReleaseLogFromAr.js`

## `paymentLogArApproval.js`

Maps unapplied verified package AR rows to Payment Logs approval fields in `GET /payments/finance-unified`:

- Finance/Superfinance/Superadmin verifier → `approval_status: Approved` with verifier name
- Admin verifier → `approval_status: Pending` (AR record stays Verified/Applied in `acknowledgement_receiptstbl`)

Also gates whether `acknowledgementreceipts.js` auto-approves linked `paymenttbl` rows when an AR is verified.

## `packageChangeConversion.js`

Supports **Update Plan** on a class student (`POST .../package-change-preview` and `.../package-change-invoice`):

| Change type | Target package | On settlement |
|-------------|----------------|---------------|
| `installment_to_installment` | Another installment / Phase+Installment package | Adjustment invoice; profile recurring amount updated |
| `installment_to_fullpayment` | Fullpayment or Phase+Fullpayment package | Credits all prior class payments (downpayment, reservation fee, phase invoices); enrolls full target phase range (e.g. 1–10); deactivates installment profile and cancels pending installment invoices |

Zero-balance full payment conversion runs immediately without an invoice.

`GET /installment-invoices/profiles/:id/phases` uses `resolveInstallmentProfileFullPaymentConversion()` and `applyFullPaymentUpgradePhaseDisplay()` so Student History shows unpaid/cancelled/not-generated slots as **Paid** with note **Upgraded to Full Payment** and `total_outstanding` = 0 after conversion.

Conversion invoices use itemized lines via `buildFullPaymentConversionInvoiceLineItems()` (full price, then separate credit lines for reservation fee and downpayment/phase payments). Credits are stored as `discount_amount` on `invoiceitemstbl`; invoice-linked AR PDF uses net line amounts (`backend/utils/invoiceReceiptLineItems.js`).

Standalone acknowledgement receipt PDFs (`ackReceiptPdfGenerator.js`) build table rows via `backend/utils/ackReceiptTableLineItems.js`: package/merchandise lines at gross, then **Discount/Payment Adjustment** (inferred from gross − `payment_amount`) and **Tip/Payment Adjustment** when present.

Invoice **Download Acknowledgement Receipt** (`GET /invoices/:id/pdf?doc_type=ar` in `routes/invoices.js`) uses `buildInvoiceLinkedArTableRows()`: invoice line items plus payment-level tip/discount from `paymenttbl` (matches invoice list **Total amount** = payable + tip).

## `arAttachInstallmentFollowUp.js`

After `POST /acknowledgement-receipts/:id/attach-to-invoice` pays an installment **downpayment** invoice:

| AR option | Behavior |
|-----------|----------|
| `downpayment_only` | Generate Phase 1 invoice only (unpaid) |
| `downpayment_plus_phase1` | Generate Phase 1 with paired AR number, auto-pay (Paid), apply paired AR, enroll student. **Phase 2 is not pre-generated** — it is created on the normal installment schedule. |

`resolveDownpaymentPhase1AckPair` (`ackReceiptPairedColumn.js`) resolves the downpayment leader and Phase 1 follower even when attach is called with either row id, so `autoPayPhase1` always runs when the AR pair exists. If Phase 1 was already generated but left Unpaid, follow-up pays that invoice instead of creating a duplicate.

Runs **await**ed before the attach API responds (not fire-and-forget). Cash Phase 1 payments use `approval_status = Pending` on Payment Logs; invoice status is still set to **Paid**.

## `arPaymentVerificationSync.js`

Keeps cash acknowledgement receipts aligned with Payment Logs and Cash Deposit approval.

| AR type | AR page status on issue | Finance AR verify | Payment Logs approval |
|---------|-------------------------|-------------------|------------------------|
| **Merchandise** (cash) | `Verified` | Not needed (auto) | Finance approves payment row |
| **Merchandise** (non-cash) | `Paid` | Finance verifies on AR page → payment auto-approved | Auto-approved when Finance verifies AR |
| **Package** (cash) | `Verified` | Not needed (auto) | Pending until Finance approves (unapplied AR row / payment after attach) |
| **Package** (non-cash) | `Submitted` | Finance verifies on AR page | Auto-approved when Finance verifies AR (unapplied row or on attach) |

| Entry point | Behavior |
|-------------|----------|
| `PUT /payments/:id/approve` (approve) | `syncArVerifiedFromPaymentApproval` — Paid cash AR → Verified |
| `PUT /payments/:id/approve` (revoke) | `syncArUnverifiedFromPaymentRevoke` — Verified → Paid (merchandise) |
| `PUT /cash-deposit-summaries/:id/approve` | After bulk payment approve, same AR sync for snapshot payment IDs |

Reverse direction (AR verify → payment approved) remains in `routes/acknowledgementreceipts.js`. **Non-cash** verify requires `finance_verified_reference_number` in the request body; it must match each AR row’s `reference_number` (Downpayment + Phase 1 pairs validate both). Linked `paymenttbl` rows receive the same finance reference on auto-approve.

**Download Invoice** (`GET /invoices/:id/pdf` and `utils/pdfGenerator.js`) appends **Discount/Payment Adjustment** and **Tip/Payment Adjustment** rows from `paymenttbl`, updates the **Total** to `grandTotal − discount + tip`, and shows collected amount (`payable + tip`) in the payment section.
