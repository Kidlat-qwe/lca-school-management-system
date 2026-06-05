# Backend shared libraries

## `installmentPaymentEligibility.js`

Blocks recording payment on a **later** installment phase when an **earlier** phase on the same `installmentinvoiceprofiles_id` has a completed partial payment with remaining balance (balance-invoice chain included).

| Entry point | Behavior |
|-------------|----------|
| `GET /invoices/:id` | Sets `prior_partial_balance_block` and `can_record_payment: false` when blocked |
| `POST /payments` | Returns 400 with `prior_partial_balance_block` message |
| `POST /installment-invoices/profiles/:id/advance-pay` | Same check for profile-local phases before `phase_index` |

Next-phase **invoice generation** is unchanged; only payment recording is blocked.

Frontend: `frontend/src/utils/installmentPaymentBlock.js` (`getInstallmentPaymentBlockAlert`).

Partial-payment parents (`balance_invoice_id` set) are **not** payable from the list — **Pay** is disabled on that row (e.g. INV-566 after ₱3,000 partial). Record the remaining balance on the balance continuation row only (e.g. INV-567, action label **Pay balance**). Balance continuation rows are included in payment-date list filters via `issue_date` when they have no payments yet. See `frontend/src/utils/invoicePaymentTarget.js`.

## `enrollmentRateMetrics.js`

Month and phase re-enrollment dashboard matrices (`loadStudentMonthEnrollmentMatrix`, `loadStudentPhaseEnrollmentMatrix`):

- Multi-phase classes: terminal billing phase/month shows **completed** when the student progresses past the first phase (unchanged).
- **Single-phase** classes (`curriculum.number_of_phase = 1`): the only phase/month shows **completed** when the student has paid (full payment, DB `completed` status, or all installment phases paid).
- Each matrix response includes `kpi_totals` (new / re-enrolled / reserved / upsell / dropped / rejoin) summed from visible labeled cells for the selected year scope. **Reserved** and **Upsell** KPI cards use `reserved_count` and `upsell_count` from the matrix (not a live DB snapshot).
- Dashboard **Re-enrollment** KPI and **Total Re-enrollment Rate %** both use re-enrolled cell counts; rate numerators match `kpi_totals.re_enrollment_count`.
- **Phase Re-enrollment** dashboard KPI cards use the same **month** matrix totals as Month Re-enrollment when a year is selected (`kpi_card_source: month_matrix`); the phase matrix table remains for phase-by-phase drill-down.
- **New** cells that follow a paid reservation on the same class track include `from_previous_reserved: true`; the UI tooltip shows **Previous reserved**.
- **Upsell** (e.g. Pre-K → KG): month matrix merges the higher program onto the lower-program row. First month after the lower program’s last enrolled (or completed) month shows **upsell**; the higher-class row is hidden. Requires a higher `level_tag` on the sibling class track.

## `dailyOperationalEnrollmentFromPayments.js`

Daily Operational Dashboard enrollment KPIs: **payment issue date** filter + **`program_enrollment_status`** on the linked `classstudentstbl` row (class / phase from invoice remarks or installment profile).

| Card metric | Rule |
|-------------|------|
| New enrollees | `program_enrollment_status = 'new'` |
| Re-enrollment | `program_enrollment_status IN ('re_enrolled', 'upsell')` |
| Rejoin | `program_enrollment_status = 'rejoin'` |
| Dropped | `program_enrollment_status = 'dropped'` |
| Re-enrollment rate | `re_enrollment_count ÷ (new + re_enrollment + rejoin)` distinct students with class payments on that date |

Only class-related completed payments count (same scope as invoice sales for enrollment billing). Status `completed`, `pending_enrollment`, and `reserved` are excluded from the four buckets.

## `merchandiseReleaseLog.js`

Records each physical merchandise stock deduction in `merchandise_release_logtbl` for operational dashboards.

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

Conversion invoices use itemized lines via `buildFullPaymentConversionInvoiceLineItems()` (full price, then separate credit lines for reservation fee and downpayment/phase payments). Credits are stored as `discount_amount` on `invoiceitemstbl`; acknowledgement receipt PDF/preview uses net line amounts (`backend/utils/invoiceReceiptLineItems.js`).
