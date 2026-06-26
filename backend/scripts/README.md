# Backend Scripts

This directory contains utility scripts for managing and maintaining the Physical School Management System backend.

## Available Scripts

### `findStudentsWithDueDateAndPenalty.js`

Lists **students** whose invoice **due_date** falls on a target calendar day/month and who already have a **late penalty** (`late_penalty_applied_for_due_date` and/or `invoiceitemstbl.penalty_amount > 0`).

Default filter: **June 5, 2026** (common installment due day). Open invoices only (`Unpaid` / `Overdue` / etc. — excludes `Paid` and `Cancelled` unless `--include-settled`).

```bash
node scripts/findStudentsWithDueDateAndPenalty.js
node scripts/findStudentsWithDueDateAndPenalty.js --year=2026 --month=6 --day=5
node scripts/findStudentsWithDueDateAndPenalty.js --year=2026 --month=6 --day=
node scripts/findStudentsWithDueDateAndPenalty.js --include-settled
```

### `checkSystemTimezone.js`

Audits **Node.js** and **PostgreSQL** timezone settings against the business standard **Asia/Manila (UTC+8)**. Reports whether `CURRENT_DATE`, local Node dates, and `node-pg` DATE reads match Manila calendar dates (relevant to installment penalty / grace logic).

```bash
node scripts/checkSystemTimezone.js
node scripts/checkSystemTimezone.js --sample-due=2026-06-05
node scripts/checkSystemTimezone.js --json
```

Exit code `0` = all checks passed; `1` = at least one mismatch (see recommendations in output).

### `revokeAdminPaymentLogApprovals.js`

Revokes **Admin approvals on paymenttbl** only (global — **no year/month filter**):

- **paymenttbl**: Cash/bank/etc. rows `Approved` by Admin → `Pending` (e.g. PAY-736, PAY-611)
- **acknowledgement_receiptstbl**: **not modified** — AR stays Verified/Applied. Admin-verified unapplied AR rows show **Pending Approval** on Payment Logs via `backend/lib/paymentLogArApproval.js` (finance-unified API).

```bash
node scripts/revokeAdminPaymentLogApprovals.js --dry-run
node scripts/revokeAdminPaymentLogApprovals.js --apply
```

**Options:** `--dry-run` (explicit preview), `--apply` (write paymenttbl only), `--help`

### `revokeAdminArVerificationPaymentLogs.js`

**Deprecated.** Previously reverted AR to Submitted — do **not** use. Payment Logs Pending for Admin AR is handled by the API; use `revokeAdminPaymentLogApprovals.js` for cash/bank payment rows only.

```bash
node scripts/revokeAdminArVerificationPaymentLogs.js --dry-run   # preview only; --apply is blocked
```

### `restoreAdminArVerificationPaymentLogs.js`

Re-applies the **5 production AR rows** reverted by `revokeAdminArVerificationPaymentLogs.js --apply` (status, verifier, verified_at; linked payments for Applied rows).

```bash
node scripts/restoreAdminArVerificationPaymentLogs.js --dry-run
node scripts/restoreAdminArVerificationPaymentLogs.js --apply
```

### `checkPaymentLogStatusApprovedByAdmin.js`

Audits **Payment Logs status columns** and lists **Admin** approvers from both sources:
- `paymenttbl.approved_by` (regular payments)
- `acknowledgement_receiptstbl.verified_by_user_id` (unapplied AR rows shown as Acknowledgement Receipt in Payment Logs)

**Usage:**
```bash
node scripts/checkPaymentLogStatusApprovedByAdmin.js
node scripts/checkPaymentLogStatusApprovedByAdmin.js --detail
node scripts/checkPaymentLogStatusApprovedByAdmin.js --admin-only --detail
node scripts/checkPaymentLogStatusApprovedByAdmin.js --branch-id=1 --from=2026-01-01 --to=2026-06-30
```

**Options:** `--admin-only`, `--detail`, `--branch-id`, `--from`, `--to` (issue_date, Manila), `--limit`, `--help`

### `listPaymentLogApprovers.js`

Lists **who approved payments** in Payment Logs (`paymenttbl.approved_by` when `approval_status = 'Approved'`).

**Usage:**
```bash
# Summary: distinct approvers grouped by user_type and user
node scripts/listPaymentLogApprovers.js

# Include sample of each approved payment
node scripts/listPaymentLogApprovers.js --detail

# Filters
node scripts/listPaymentLogApprovers.js --branch-id=1
node scripts/listPaymentLogApprovers.js --from=2026-01-01 --to=2026-05-31
node scripts/listPaymentLogApprovers.js --user-type=Admin
node scripts/listPaymentLogApprovers.js --detail --limit=500
```

**Options:** `--detail`, `--branch-id`, `--from`, `--to` (approved_at, Manila date), `--user-type`, `--limit`, `--help`

Without `--branch-id`, output includes **all branches** from `branchestbl` with approval counts per payment branch (0 if none).

**Revert Admin approvals** (sets `approval_status` back to `Pending`, clears `approved_by`, `approved_at`, `finance_verified_reference_number` — same as revoke in the approve API):

```bash
# Preview only
node scripts/listPaymentLogApprovers.js --revert-admin-approvals

# Execute
node scripts/listPaymentLogApprovers.js --revert-admin-approvals --apply

# Scoped
node scripts/listPaymentLogApprovers.js --revert-admin-approvals --branch-id=1 --from=2026-01-01 --apply
```

### `deleteTodayAcknowledgementReceipts.js`

Deletes acknowledgement receipts for a target date (default: today in Manila timezone).

**Usage:**
```bash
# Dry run for today (Asia/Manila)
node scripts/deleteTodayAcknowledgementReceipts.js

# Execute deletion for today
node scripts/deleteTodayAcknowledgementReceipts.js --apply

# Execute deletion for a specific date
node scripts/deleteTodayAcknowledgementReceipts.js --date=2026-04-25 --apply

# Include applied/linked rows (invoice_id/payment_id/status=Applied)
node scripts/deleteTodayAcknowledgementReceipts.js --include-applied --apply
```

**Options:**
- `--date=YYYY-MM-DD`: Override target date. Default is today in `Asia/Manila`.
- `--include-applied`: Include rows already linked/applied.
- `--apply`: Actually delete rows. Without this, script is dry-run only.
- `--help, -h`: Show usage help.

### `listFirebaseUsers.js`

Lists all users registered in Firebase Authentication.

**Usage:**
```bash
# List all users (default: table format, max 1000 users)
node scripts/listFirebaseUsers.js

# List with custom limit
node scripts/listFirebaseUsers.js --limit 500

# Output in JSON format
node scripts/listFirebaseUsers.js --format json

# Filter by email (partial match, case-insensitive)
node scripts/listFirebaseUsers.js --email "@gmail.com"

# Get specific user by UID
node scripts/listFirebaseUsers.js --uid "abc123xyz"

# Show help
node scripts/listFirebaseUsers.js --help
```

**Options:**
- `--limit <number>`: Maximum number of users to retrieve (default: 1000)
- `--format <json|table>`: Output format (default: table)
- `--email <email>`: Filter by email (partial match, case-insensitive)
- `--uid <uid>`: Get specific user by UID
- `--help, -h`: Show help message

**Output Information:**
- User UID
- Email address
- Email verification status
- Display name
- Phone number
- Account status (disabled/enabled)
- Creation timestamp
- Last sign-in timestamp
- Authentication providers
- Custom claims (if any)

**Notes:**
- The script uses Firebase Admin SDK, so it requires proper Firebase Admin credentials to be configured
- Firebase Admin SDK has a limit of 1000 users per page, so pagination is handled automatically
- The script respects the `--limit` option but may retrieve more users if pagination is needed

### `diagnoseStudentInstallment.js`

Read-only diagnostic for one student: installment profiles, **`installmentinvoicestbl`** schedule rows (what the Finance Installment Invoice page lists), and linked **`invoicestbl`** rows. Uses `backend/.env` database settings (production if that file points to prod).

**Usage:**
```bash
cd backend

node scripts/diagnoseStudentInstallment.js --user-id 12345
node scripts/diagnoseStudentInstallment.js --email student@school.com
node scripts/diagnoseStudentInstallment.js --name "Penelope"
node scripts/diagnoseStudentInstallment.js --name Cudia --json

node scripts/diagnoseStudentInstallment.js --help
```

**Options:**
- `--user-id`: `userstbl.user_id`
- `--email`: Exact email match (trimmed, case-insensitive)
- `--name`: Partial match on `full_name`; if multiple students match, script lists them and exits without querying profiles (narrow the name or use `--user-id`).
- `--json`: Print a single JSON object instead of tables.

### `repairMatrixReviewStudents.js`

Targeted fix for manual unenroll + paid phases (Herby/Donna pattern) and **phase_start** installment packages (Andrei/Maven pattern).

```bash
cd backend
node scripts/repairMatrixReviewStudents.js --dry-run
node scripts/repairMatrixReviewStudents.js
```

### `findDelinquencyDropMismatchStudents.js`

Lists students with **`dropped`** rows from installment delinquency who still have **paid** or **partially paid** installment invoices (Skyler-like class-wide drop).

```bash
cd backend
node scripts/findDelinquencyDropMismatchStudents.js
```

### `reinstateSkylerLikeDelinquencyDrops.js`

Bulk reinstate only **eligible** delinquency-dropped phases (paid invoice, partial with payment, or later phase paid). Skips phases with no billing evidence (e.g. phase 9 dropped with only phase 1 paid).

```bash
cd backend
node scripts/reinstateSkylerLikeDelinquencyDrops.js --dry-run
node scripts/reinstateSkylerLikeDelinquencyDrops.js
node scripts/reinstateSkylerLikeDelinquencyDrops.js --student-id=118
```

### `reinstateStudentAfterDelinquencyDrop.js`

Restores **`classstudentstbl`** rows that were set to **`dropped`** by the installment delinquency job when the student should stay enrolled (e.g. other phases paid, partial payment on the overdue invoice). Clears **`removed_at`** / **`removed_reason`**; phase 1 → **`new`**, later phases → **`re_enrolled`**. **`student_statustbl`** updates via the existing trigger.

**Usage:**
```bash
cd backend
node scripts/reinstateStudentAfterDelinquencyDrop.js --email=student@school.com
node scripts/reinstateStudentAfterDelinquencyDrop.js --student-id=21
node scripts/reinstateStudentAfterDelinquencyDrop.js --email=... --dry-run
```

### `repairPhaseInstallmentIssueDateMonotonic.js`

Backfills **`invoicestbl.issue_date`** for phase installment invoices (rows whose **`remarks`** contain `TARGET_PHASE:N`) so that, within each **`installmentinvoiceprofiles_id`**, dates never go backwards when phases are sorted by **N** ascending. Use after fixing the AR enrollment code path, or to clean historical rows (e.g. Phase 2 dated before Phase 1).

**Usage:**
```bash
cd backend

# Preview only (default — no writes)
node scripts/repairPhaseInstallmentIssueDateMonotonic.js
npm run repair:phase-installment-issue-dates

# Only one invoice (loads its profile for phase order; applies at most that row)
node scripts/repairPhaseInstallmentIssueDateMonotonic.js --invoice-id=863
npm run repair:phase-invoice-863

# Apply updates
node scripts/repairPhaseInstallmentIssueDateMonotonic.js --apply
npm run repair:phase-installment-issue-dates -- --apply
npm run repair:phase-invoice-863 -- --apply
# Invoice 863 conflict (issue floor after due): preview then apply with extended due
node scripts/repairPhaseInstallmentIssueDateMonotonic.js --invoice-id=863 --extend-due-when-needed
node scripts/repairPhaseInstallmentIssueDateMonotonic.js --invoice-id=863 --extend-due-when-needed --apply
# Phase 2 next billing cycle (issue 25th, due 5th of following month)
node scripts/repairPhaseInstallmentIssueDateMonotonic.js --invoice-id=863 --issue-date=2026-06-25 --due-date=2026-07-05
node scripts/repairPhaseInstallmentIssueDateMonotonic.js --invoice-id=863 --issue-date=2026-06-25 --due-date=2026-07-05 --apply
```

**Options:**
- `--apply`: Run `UPDATE invoicestbl`. Without it, the script only prints planned changes.
- `--invoice-id=N`: Restrict to invoice `N` only (full profile still scanned for monotonic rule).
- `--extend-due-when-needed`: **Only with `--invoice-id`.** If the issue fix would be after `due_date`, also set `due_date` to the same day as the new `issue_date` (minimal change). Often **not** the same as the real “25th / 5th next month” cycle; prefer `--issue-date` / `--due-date` when you need the next cycle.
- `--issue-date=YYYY-MM-DD` and `--due-date=YYYY-MM-DD`: **Together with `--invoice-id`**, set both fields on that row (e.g. Phase 2 = `2026-06-25` / `2026-07-05`). Incompatible with `--extend-due-when-needed`.
- `--help`, `-h`: Usage text.

Rows where the required floor would be **after** `due_date` are skipped and logged as a conflict.

### `listMissedInstallmentInvoicesForMonth.js`

List students whose installment plan should have generated a **phase invoice** in a calendar month (e.g. June 2026 / 25th cycle) but did not. Writes a CSV by default when there are misses.

```bash
node backend/scripts/listMissedInstallmentInvoicesForMonth.js --month 2026-06
node backend/scripts/listMissedInstallmentInvoicesForMonth.js --month 2026-06 --csv
node backend/scripts/listMissedInstallmentInvoicesForMonth.js --month 2026-06 --json
```

### `listLateStartInstallmentBillingMismatch.js`

Find **Kirsten-like** late-start installment drift: enrollment or first invoice begins after phase 1, `getCurrentInstallmentPhaseNumber` lags the next absolute `TARGET_PHASE`, the next phase invoice was never created, and the scheduler is stuck on a past cycle and/or the queue jumped ahead without generating.

These students are **not** included in `listMissedInstallmentInvoicesForMonth.js` (canonical schedule still points at the last paid month).

```bash
node backend/scripts/listLateStartInstallmentBillingMismatch.js
node backend/scripts/listLateStartInstallmentBillingMismatch.js --csv
node backend/scripts/listLateStartInstallmentBillingMismatch.js --json
```

### `diagnoseMissedInstallmentGeneration.js`

List class-linked installment profiles that **should** have auto-generated on a target date (25th cycle) but did not. Outputs summary, reason breakdown, and optional CSV.

```bash
node backend/scripts/diagnoseMissedInstallmentGeneration.js --date 2026-06-25
node backend/scripts/diagnoseMissedInstallmentGeneration.js --date 2026-06-25 --csv missed-2026-06-25.csv
node backend/scripts/diagnoseMissedInstallmentGeneration.js --date 2026-06-25 --json
```

Typical miss reason: `next_generation_date_in_future` — queue row is one month ahead. Fix with `repairInstallmentGenerationSchedule.js --apply`, then run the daily generator (`processDueInstallmentInvoices`).

### `repairInstallmentGenerationSchedule.js`

Batch scan/repair for **all class-linked installment plans** whose auto-generation queue (`installmentinvoicestbl`) has the wrong **25th / 5th-next-month** cycle or is stuck with `status = 'Generated'` while more phases remain.

Uses `buildPhaseInstallmentSchedule` (same rules as live billing) to compute the correct `next_generation_date` and `next_invoice_month`, then resets `status` to `NULL` so the scheduler can run again.

**Usage:**

```bash
# From repo root — preview ALL active students (safe, no writes)
node backend/scripts/repairInstallmentGenerationSchedule.js --dry-run

# Apply fixes for ALL active class-linked students
node backend/scripts/repairInstallmentGenerationSchedule.js --apply

# Single profile (e.g. Matthew Sabino)
node backend/scripts/repairInstallmentGenerationSchedule.js 154 --dry-run
node backend/scripts/repairInstallmentGenerationSchedule.js 154 --apply

# npm shortcuts (from backend/)
npm run repair:installment-generation-schedule
npm run repair:installment-generation-schedule:apply
```

**Options:**
- `--dry-run` (default): List mismatches only.
- `--apply`: Commit queue fixes.
- `--include-inactive`: Also scan inactive profiles that still have a queue row.
- `--verbose`: Log profiles that are already correct.
- `<profileId>`: Limit to one `installmentinvoiceprofiles_id`.

Does **not** change existing invoice amounts, payments, or `generated_count` — only the **next auto-generation** queue row.

### `repairAadamCawiliInstallmentGenerationQueue.js`

Pilot repair for **one student** before bulk `repairInstallmentGenerationSchedule.js --apply`. Targets **Aadam June Cawili** (profile `142`, `may778848@gmail.com`) — June 25, 2026 missed generation (`next_generation_date` was `2026-07-25` instead of `2026-06-25`).

```bash
# Preview queue fix (no writes)
node backend/scripts/repairAadamCawiliInstallmentGenerationQueue.js

# Apply queue fix only
node backend/scripts/repairAadamCawiliInstallmentGenerationQueue.js --apply

# Apply queue fix + generate missed phase 5 invoice (issue Jun 25, due Jul 5)
node backend/scripts/repairAadamCawiliInstallmentGenerationQueue.js --apply --generate
```

After a successful pilot, run bulk repair for the remaining profiles:

### `repairMissedInstallmentGenerationJune2026.js`

Bulk repair for **all students** who missed the June 25, 2026 installment run. Finds eligible profiles with no phase invoice in `2026-06`, fixes queue dates, and optionally generates missed invoices.

**Installment Invoice Logs alignment:** Writes the same fields shown on the logs page — `next_generation_date` (Next Generation) and `next_invoice_month` (Next Month). Before generate: e.g. `2026-06-25` / `2026-07-01`. After generate: e.g. `2026-07-25` / `2026-08-01`. Post-generate sync verifies the queue matches `buildPhaseInstallmentSchedule` (guards against generator off-by-one-month bugs).

```bash
# Preview all missed students (no writes)
node backend/scripts/repairMissedInstallmentGenerationJune2026.js

# Fix queue dates only
node backend/scripts/repairMissedInstallmentGenerationJune2026.js --apply

# Fix queue + generate missed phase invoices
node backend/scripts/repairMissedInstallmentGenerationJune2026.js --apply --generate

# Skip pilot student already repaired (e.g. Aadam profile 142)
node backend/scripts/repairMissedInstallmentGenerationJune2026.js --apply --generate --skip-profile-ids 142

# Test first N profiles
node backend/scripts/repairMissedInstallmentGenerationJune2026.js --apply --generate --limit 5
```

Options: `--apply`, `--generate` (requires `--apply`), `--limit N`, `--skip-profile-ids 1,2`, `--csv path`.

Dry-run table includes `after_generate_gen` / `after_generate_month` (what the logs page should show after `--generate`). Results CSV includes `final_next_generation_date`, `final_next_invoice_month`, and `queue_synced_after_generate`.

Writes a results CSV after `--apply`. Each profile is committed in its own transaction so one failure does not roll back others.

### `repairInstallmentQueueExplicitNextDates.js`

Sets **`installmentinvoicestbl.next_generation_date`** and **`next_invoice_month`** for a single open queue row. The Generate Invoice modal and the **Next generation** / **Next month** list columns use these values (with the frontend deriving issue/due/month from the generation anchor).

**Example (July / August anchor — confirm `profile_id` from your DB, e.g. via `diagnoseStudentInstallment.js`):**

```bash
cd backend
node scripts/repairInstallmentQueueExplicitNextDates.js \
  --profile-id=323 \
  --next-generation-date=2026-07-25 \
  --next-invoice-month=2026-08-01
node scripts/repairInstallmentQueueExplicitNextDates.js \
  --profile-id=323 \
  --next-generation-date=2026-07-25 \
  --next-invoice-month=2026-08-01 \
  --apply
```

**Resolve by name + class instead of profile id:**

```bash
node scripts/repairInstallmentQueueExplicitNextDates.js \
  --student-name="Princess Morianne" \
  --class-name="VMM_Nursery" \
  --next-generation-date=2026-07-25 \
  --next-invoice-month=2026-08-01 \
  --apply
```

**Options:** `--profile-id=N` **or** `--student-name=` + `--class-name=` (ILIKE substrings); **`--installmentinvoicedtl-id=N`** alone (or with `--profile-id` to verify); `--next-generation-date=YYYY-MM-DD`; `--next-invoice-month=YYYY-MM-DD`; `--apply`. If several open rows match the same profile, the script updates the **latest** (`installmentinvoicedtl_id` DESC) and prints a warning with the full list—use **`--installmentinvoicedtl-id=316`** to force one row.

### Installment invoice list / NULL `status` (migration `105`)

If Finance **Installment Invoice Logs** missed students because only the first 100 API rows loaded, deploy the frontend/backend changes that paginate until all rows are fetched and return `pagination.total`.

To backfill **`installmentinvoicestbl.status`** where it was `NULL`, apply migration **`105_backfill_installmentinvoicestbl_status.sql`** on production.

### `countMonthReEnrollmentMatrixLabels.js`

Counts **labeled cells** on the **Month Re-enrollment** dashboard matrix for a calendar year (same rules as the UI table). Reports **new**, **re-enrolled**, and **new + re-enrolled** totals per month and for the full year, and compares them to **rate header numerators** (month-to-month retention).

```bash
node scripts/countMonthReEnrollmentMatrixLabels.js --year=2026
node scripts/countMonthReEnrollmentMatrixLabels.js --year=2026 --branch-id=1
node scripts/countMonthReEnrollmentMatrixLabels.js --year=2026 --program-id=2 --class-id=34
node scripts/countMonthReEnrollmentMatrixLabels.js --year=2026 --verbose
node scripts/countMonthReEnrollmentMatrixLabels.js --year=2026 --json
```

**Options:** `--year=YYYY`, `--branch-id=N`, `--program-id=N`, `--class-id=N`, `--verbose` (list each new/re-enrolled cell), `--json`, `--help`

### `auditEnrollmentKpiEdgeCases.js`

Scans the database for **enrollment KPI edge cases** similar to the Bronny James investigation:

1. **Partial payment dual-count** — multiple completed payments on the same student + class + phase + invoice chain (would inflate re-enrollment without dedupe; e.g. Vitrum Worldwide INV-567 phase 2).
2. **Bronny-like same-day upsell** — lower-program phase 1 payment on the same `issue_date` as a higher-program upsell / full pay.
3. **Misclassified phase 1** — lower phase 1 still `re_enrolled` on that same day (operational KPI risk).
4. **Multi-level tracks** — students with active rows in 2+ program levels (matrix single-row merge candidates).
5. **Matrix upsell merge** — duplicate matrix rows, unmerged upsell siblings, or merged-anchor completed phase mismatches for the month’s calendar year.

```bash
node scripts/auditEnrollmentKpiEdgeCases.js --month=2026-06
node scripts/auditEnrollmentKpiEdgeCases.js --month=2026-06 --section=partial
node scripts/auditEnrollmentKpiEdgeCases.js --month=2026-06 --section=bronny
node scripts/auditEnrollmentKpiEdgeCases.js --month=2026-06 --section=matrix --verbose
node scripts/auditEnrollmentKpiEdgeCases.js --month=2026-06 --json
```

**Options:** `--month=YYYY-MM`, `--branch-id=N`, `--program-id=N`, `--class-id=N`, `--section=all|partial|bronny|misclassified|tracks|matrix`, `--verbose`, `--json`, `--help`

## Adding New Scripts

### `auditEnrollmentDataQuality.js`

Read-only scan of **all** completed class payments (not June-only) for enrollment KPI anomalies:

- Partial-payment groups that would double-count without invoice-chain + phase dedupe
- Bronny-like same-day cross-class / upsell patterns (legacy flip vs current classification)
- Lower-completed + higher-program upsell merge candidates

```bash
node scripts/auditEnrollmentDataQuality.js
node scripts/auditEnrollmentDataQuality.js --pattern=partial
node scripts/auditEnrollmentDataQuality.js --from=2020-01-01 --branch-id=1 --limit=50
node scripts/auditEnrollmentDataQuality.js --student-id=123 --json
```

**Options:** `--pattern=all|partial|bronny|upsell|dedupe`, `--from`, `--to`, `--branch-id`, `--student-id`, `--limit`, `--json`, `--help`

### `repairEnrollmentAuditFindings.js`

Sets higher-program phase 1 rows to `upsell` when a lower program is already `completed` (pairs flagged by the audit).

```bash
node scripts/repairEnrollmentAuditFindings.js --dry-run
node scripts/repairEnrollmentAuditFindings.js --apply
node scripts/repairEnrollmentAuditFindings.js --apply --student-id=336
```

**Options:** `--dry-run`, `--apply`, `--student-id`, `--help`

### `repairKirstenMahinayMissedPhase5Generation.js`

One-off repair for **Kirsten Celesse J. Mahinay** (`cherryjaodmd@gmail.com`, profile **123**) — missed **phase 5** (June 25, 2026) due to late-start billing drift. Restores `generated_count`, resets queue to Jun 25 / Jul 01, optionally generates the phase 5 invoice.

```bash
node backend/scripts/repairKirstenMahinayMissedPhase5Generation.js
node backend/scripts/repairKirstenMahinayMissedPhase5Generation.js --apply
node backend/scripts/repairKirstenMahinayMissedPhase5Generation.js --apply --generate
```

### `repairKirstenMahinayPhaseEnrollmentAndPayments.js`

One-off repair for **Kirsten Celesse J. Mahinay** (`cherryjaodmd@gmail.com`). **Cascades** earlier invoice + AR onto later phase slots (payments stay on the same physical invoice rows):

| Phase slot | Invoice | AR | Payment | Issued | Due | Enrollment |
|------------|---------|-----|---------|--------|-----|------------|
| 1 | — | — | — | — | — | Not enrolled |
| 2 | **311** (was ph.1) | — | PAY-209 | 2026-03-25 | 2026-04-05 | New (paid) |
| 3 | **571** (was ph.2) | **260224** | PAY-681 | 2026-04-25 | 2026-05-05 | Re-enrolled (paid) |
| 4 | **1012** (was ph.3) | **260674** | — | 2026-05-25 | 2026-06-05 | Generated, unpaid |

INV-**1511** (old phase 4) is **Cancelled** and **detached** from the profile (`installmentinvoiceprofiles_id = NULL`) so it cannot appear on phase slot 1. Sets `TARGET_PHASE` on 311/571/1012 for correct Student History mapping.

**Attendance:** `attendancetbl` rows on class **curriculum** phase 1 sessions move to matching phase 2 sessions (same `phase_session_number`), then phase 2 → phase 3. Together with enrollment on phases 2 and 3, Student History and class attendance show those marks under the correct billing phases.

```bash
node scripts/repairKirstenMahinayPhaseEnrollmentAndPayments.js --dry-run
node scripts/repairKirstenMahinayPhaseEnrollmentAndPayments.js --apply
```

### `repairKirstenMahinayDetachOrphanInvoice1511.js`

Supplemental one-off if INV-**1511** was cancelled but still linked to profile **123** (Student History showed cancelled data on phase 1). Detaches the orphan and strips `TARGET_PHASE` from its remarks.

```bash
node scripts/repairKirstenMahinayDetachOrphanInvoice1511.js --dry-run
node scripts/repairKirstenMahinayDetachOrphanInvoice1511.js --apply
```

### `repairKirstenMahinayRestoreTargetPhases.js`

If Student History shows invoices shifted one slot early (phase 1 has INV-311, phase 4 empty), the phases API auto-repair may have rewritten `TARGET_PHASE` to 1/2/3. This script restores **2/3/4** on INV-311/571/1012. Requires the enrollment-aware gap fix in `installmentPhaseBillingSync.js` so the API does not re-shift on the next load.

```bash
node scripts/repairKirstenMahinayRestoreTargetPhases.js --dry-run
node scripts/repairKirstenMahinayRestoreTargetPhases.js --apply
```

### `diagnoseKirstenMahinayInstallmentProgress.js`

Read-only check for **Kirsten Celesse J. Mahinay** installment progress after late-start enrollment (class phase 2). Compares DB `generated_count`, list-page `paid_phases` / `generated_phases`, and Student History phase progress (complete / paid / generated).

```bash
node scripts/diagnoseKirstenMahinayInstallmentProgress.js
```

### `repairKirstenMahinayInstallmentProgressDisplay.js`

Ensures Kirsten's DB rows support **late-start** modal display: hide plan slot 1, progress **2/9 complete** and **3/10 paid** (downpayment + 2 paid phases). Pairs with phases API + `InstallmentPlanDetails` late_start_gap UI.

```bash
node scripts/repairKirstenMahinayInstallmentProgressDisplay.js --dry-run
node scripts/repairKirstenMahinayInstallmentProgressDisplay.js --apply
```

### `repairKirstenMahinayPhase34IssueDueDates.js`

Earlier date-only fix (Phase 3 issue/due). Superseded for enrollment/payment work by `repairKirstenMahinayPhaseEnrollmentAndPayments.js` above once Phase 3 dates are already correct.

```bash
node scripts/repairKirstenMahinayPhase34IssueDueDates.js --dry-run
node scripts/repairKirstenMahinayPhase34IssueDueDates.js --apply
```

### `setJaliyahAlmendrasInstallmentPhaseStart2.js`

Set **Jaliyah Callie Almendras** (`rinadeleon713@gmail.com`, profile `150`, class `47`) installment **`phase_start` → 2** so the plan begins at class Phase 2 (curriculum phase 1 is outside the plan grid).

- **`--apply`**: updates `installmentinvoiceprofilestbl.phase_start` and aligns `program_enrollment_status` (phase 1 `new`, phases 2–4 `re_enrolled`).
- **`--shift-attendance`**: optional with `--apply` — moves attendance rows phase 1→2, 2→3, 3→4 when present (dry-run previews shifts).

```bash
node scripts/setJaliyahAlmendrasInstallmentPhaseStart2.js
node scripts/setJaliyahAlmendrasInstallmentPhaseStart2.js --dry-run
node scripts/setJaliyahAlmendrasInstallmentPhaseStart2.js --apply
node scripts/setJaliyahAlmendrasInstallmentPhaseStart2.js --apply --shift-attendance
```

### `repairJaliyahAlmendrasPhaseProgressDisplay.js`

Align **Installment Invoice Logs** phase progress with Kirsten (same class): **5 / 10** not **5 / 11**. Sets `phase_start` → `NULL` and `generated_count` → `5` when phase 5 invoice exists.

```bash
node backend/scripts/repairJaliyahAlmendrasPhaseProgressDisplay.js
node backend/scripts/repairJaliyahAlmendrasPhaseProgressDisplay.js --apply
```

### `repairJaliyahAlmendrasInstallmentIssueDueDates.js`

Correct **issue/due dates** and `TARGET_PHASE` remarks for Jaliyah Callie Almendras (`rinadeleon713@gmail.com`, profile **150**, class **47**) to match the same class billing cadence as Kirsten Mahinay (25th issue / 5th next-month due). Resets INV-1525 to **Unpaid** after moving phase 5 to Jun 25 / Jul 5.

```bash
node backend/scripts/repairJaliyahAlmendrasInstallmentIssueDueDates.js
node backend/scripts/repairJaliyahAlmendrasInstallmentIssueDueDates.js --apply
```

### `repairJaliyahAlmendrasInstallmentInvoiceSlots.js`

Swap installment invoice slots so **display Phase 4 = paid (INV-1043)** and **Phase 5 = overdue / Pay Now (INV-1525)**. Sets `TARGET_PHASE:4` on 1043 and `TARGET_PHASE:5` on 1525.

```bash
node scripts/repairJaliyahAlmendrasInstallmentInvoiceSlots.js
node scripts/repairJaliyahAlmendrasInstallmentInvoiceSlots.js --apply
```

### `repairMariashaPangilinPhase1EnrollmentAnchor.js`

Set phase 1 `classstudentstbl.enrolled_at` to the class Phase 1 start session so the month re-enrollment matrix shows **new** in **March** (not May when auto-enroll used a later payment date).

```bash
node scripts/repairMariashaPangilinPhase1EnrollmentAnchor.js
node scripts/repairMariashaPangilinPhase1EnrollmentAnchor.js --apply
```

When adding new scripts to this directory:

1. Follow the ES module syntax (import/export)
2. Include proper error handling
3. Add command-line argument parsing if needed
4. Include a `--help` option
5. Update this README with script documentation
6. Use descriptive console output with emojis for better readability

