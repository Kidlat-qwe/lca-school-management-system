# Student Status Report

Powers **Reports → Student Status** active/inactive classification.

## Active definition

Matches **Monthly Operational Dashboard → Total Active Students** for the selected billing month:

- **New** matrix cells (`new`)
- **Re-enrollment** matrix cells (`re-enrolled` and qualifying `completed` — same as the month matrix rate-header numerator)
- **Rejoin** matrix cells (`rejoin`)

Upsell, reserved, dropped, and other labels are **inactive** for that month.

## API

`GET /api/sms/reports/student-status`

| Query | Description |
|-------|-------------|
| `summary_month` | `YYYY-MM` billing month (default: current month, Asia/Manila) |
| `status` | `all` \| `active` \| `inactive` |
| `branch_id` | Optional branch filter (Superadmin) |
| `search`, `page`, `limit` | List filters |

## Module

- `studentStatusReport.js` — `loadStudentStatusReportPage`
- Matrix rules live in `../enrollmentRateMetrics.js` (`buildMonthMatrixActiveStudentIndex`)
