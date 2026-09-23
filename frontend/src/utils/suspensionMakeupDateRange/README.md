# Suspension makeup date range

Helpers for **manual** class suspension makeup scheduling.

## Rule

For a phase that may span multiple months (e.g. Phase 1: late September → mid October):

| Bound | Value |
|-------|--------|
| **Min** | Earliest `scheduled_date` among sessions in that phase |
| **Max** | **Last calendar day** of the month that contains the phase’s latest session date |

Example: last Phase 1 session is Oct 20 → makeup allowed through **Oct 31**.

Used by Superadmin/Admin Classes suspension modal (`validateMakeupSchedules` + date input `min`/`max`).

## Time conflict rule

- **Same date / day is allowed**
- **Overlapping clock time is not** (against other non-Cancelled sessions in the class, and against other makeup rows in the same submit)

Uses `findManualMakeupTimeConflicts` / `getManualMakeupTimeConflictsBySessionId`. Adjacent slots (e.g. 10:00–11:00 and 11:00–12:00) are allowed.

On the Schedule Makeup step, conflicting **Start Time** fields show a red border and an inline error; **Create Suspension** stays disabled until resolved.
