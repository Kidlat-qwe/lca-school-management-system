# Backend Scripts

This directory contains utility scripts for managing and maintaining the Physical School Management System backend.

## Available Scripts

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

## Adding New Scripts

When adding new scripts to this directory:

1. Follow the ES module syntax (import/export)
2. Include proper error handling
3. Add command-line argument parsing if needed
4. Include a `--help` option
5. Update this README with script documentation
6. Use descriptive console output with emojis for better readability

