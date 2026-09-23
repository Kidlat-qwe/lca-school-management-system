# Suspension makeup conflicts

Server-side checks for **manual** suspension makeup schedules.

## Rules

| Rule | Behavior |
|------|----------|
| Date window | Phase first session → last calendar day of phase’s last month (enforced in `routes/suspensions.js`) |
| Same day | Allowed |
| Overlapping time | **Blocked** vs other non-Cancelled class sessions and vs other makeup rows in the same request |

`findManualMakeupTimeConflicts` — adjacent slots (end === next start) are allowed.
