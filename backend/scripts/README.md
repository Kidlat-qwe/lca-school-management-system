# Backend Scripts

This directory contains utility scripts for managing and maintaining the Physical School Management System backend.

## Available Scripts

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

### Installment invoice list / NULL `status` (migration `105`)

If Finance **Installment Invoice Logs** missed students because only the first 100 API rows loaded, deploy the frontend/backend changes that paginate until all rows are fetched and return `pagination.total`.

To backfill **`installmentinvoicestbl.status`** where it was `NULL`, apply migration **`105_backfill_installmentinvoicestbl_status.sql`** on production.

## Adding New Scripts

When adding new scripts to this directory:

1. Follow the ES module syntax (import/export)
2. Include proper error handling
3. Add command-line argument parsing if needed
4. Include a `--help` option
5. Update this README with script documentation
6. Use descriptive console output with emojis for better readability

