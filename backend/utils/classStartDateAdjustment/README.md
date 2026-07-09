# Class start date adjustment

Productized workflow for shifting a class `start_date` after enrollments and installment invoices exist.

## Problem

Editing `start_date` on `PUT /classes/:id` regenerates sessions but leaves unpaid invoice `due_date` values on the old schedule. Delinquency jobs then penalize or auto-drop students.

## Module files

| File | Role |
|------|------|
| `classStartDateAdjustmentService.js` | `previewStartDateAdjustment`, `applyStartDateAdjustment`, conflict checks |
| `billingRealignment.js` | Invoice/queue/penalty/drop-restore planning and apply |
| `../classSessionRegeneration.js` | Session simulation and persistence |

## API

```
POST /classes/:id/adjust-start-date/preview
POST /classes/:id/adjust-start-date/apply
```

### Preview body

```json
{ "new_start_date": "2026-08-03", "acknowledge_warnings": false }
```

### Apply body

```json
{ "new_start_date": "2026-08-03", "reason": "Branch delayed room availability" }
```

## Billing rules (v1)

- **Paid / partially paid** phase invoices: dates unchanged
- **Unpaid phase 1**: `due_date` = new phase 1 session start − 1 day; penalties cleared
- **First generated invoice** without `TARGET_PHASE` in remarks (e.g. enrollment merch overwrite) is still treated as phase 1 when `generated_count >= 1`
- **Unpaid phase 2+**: deleted when class has no completed sessions (premature generation)
- **Installment queue**: rebuilt via `buildPhaseInstallmentSchedule`
- **Delinquency drops** on old due dates: enrollment restored when drop reason references delinquency

## Guards

- `PUT /classes/:id` returns **409** when `start_date` changes and class has enrollments or installment billing
- Apply blocked when room/teacher conflicts exist
- Apply blocked when completed sessions have attendance (v1)

## Audit

`class_schedule_adjustmenttbl` stores old/new dates, reason, preview snapshot, and result summary. Modified invoices receive remark suffix `START_DATE_ADJUSTMENT:{id}`.
