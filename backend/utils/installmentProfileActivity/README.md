# Installment profile activity (`is_active`)

Keeps `installmentinvoiceprofilestbl.is_active` aligned with enrollment drops so:

- **Student History → plan Status** shows Inactive when a class was dropped and the student did not rejoin that class (`is_active = false`). Overdue / under-grace Inactive (while the plan is still open) is computed separately — see `installmentPlanLifecycleStatus/`.
- **Re-enrollment matrix** paints Inactive lifecycle cells for that track (`profile_is_active = false`) **and** when the next unpaid invoice is past due

## Rule

A class has an **unrejoined drop** when:

1. There is at least one `classstudentstbl` row with `program_enrollment_status = 'dropped'` for that student+class, and
2. There is **no** later active enrollment (`new` / `re_enrolled` / `upsell` / `rejoin`, `removed_at IS NULL`) with a **higher `phase_number`** than the max dropped phase on that class

Earlier phases that remain `new` / `re_enrolled` do **not** count as a rejoin after a later drop.

## API

| Export | Purpose |
|--------|---------|
| `classHasUnrejoinedDrop(db, studentId, classId)` | Boolean check |
| `deactivateInstallmentProfileIfUnrejoinedDrop(db, { studentId, classId })` | Set `is_active = false` when rule matches |
| `syncStudentInstallmentProfilesForUnrejoinedDrops(db, studentId)` | Sync all classes for one student |
| `unrejoinedDropPredicateSql(paramIndex)` | SQL fragment for bulk UPDATE guards |

## Call sites

- Drop / delinquency: existing `deactivateInstallmentProfileForClassDrop` still forces Inactive
- Class reactivate / `syncInstallmentProfilesWithClassStatus`: must **not** reactivate profiles that still have an unrejoined drop
- After enrollment changes: `syncStudentInstallmentProfilesForUnrejoinedDrops`
