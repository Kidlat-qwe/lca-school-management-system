# Student Status Report

Powers **Reports → Student Status** active/inactive classification.

## Active definition

Matches **Monthly Operational Dashboard → Total Active Students** for the selected billing month:

- **New** matrix cells (`new`)
- **Re-enrollment** matrix cells (`re-enrolled`)
- **Qualifying completed** — multi-phase **and** prior `new` / `re-enrolled` / `rejoin` on the same track (standalone completed excluded; same as Total Active)
- **Rejoin** matrix cells (`rejoin`)
- **Upsell** matrix cells (`upsell`)

Reserved, dropped, pending enrollment, lifecycle **Inactive (X)**, standalone completed, and other labels are **inactive** for that month.

**Partial / unpaid remaining balance:** installment enrollment badges (`new` / `re_enrolled`) are created only after the phase chain is fully Paid. Open partial balances keep Enrollment blank so the Month Re-enrollment lifecycle overlay can show **Inactive**, and this report / Monthly Operational Total Active stay aligned with that month column.

## Counting

**Active list / `meta.active_students`** = one row per **active matrix track/cell** (same cell sum as Total Active).  
Example: one student active on Nursery and Pre-K in July appears **twice** → dashboard 37 and report 37.

`meta.active_unique_students` = distinct people (36 in that example).  
Inactive remains unique students with no active July cell.

## API

`GET /api/sms/reports/student-status`

| Query | Description |
|-------|-------------|
| `summary_month` | `YYYY-MM` billing month (default: current month, Asia/Manila) |
| `status` | `all` \| `active` \| `inactive` |
| `branch_id` | Optional branch filter (Superadmin) |
| `search`, `page`, `limit` | List filters |

Active rows include `class_id`, `class_name`, and a single `matrix_labels` value for that track.

## Excel export

Frontend **Export to Excel** on Report → Student Status downloads Active / Inactive / All via paged calls to this API (`status` + `summary_month`). See `frontend/src/utils/studentStatusExcelExport.js`.

## Module

- `studentStatusReport.js` — `loadStudentStatusReportPage`
- Matrix rules live in `../enrollmentRateMetrics.js` (`buildMonthMatrixActiveTrackRows`, `buildMonthMatrixActiveStudentIndex`)
