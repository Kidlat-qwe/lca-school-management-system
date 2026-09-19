# Teachers API

Routes: `../teachers.js` mounted at `/api/sms/teachers`.

## Endpoints

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| `GET` | `/teachers` | Superadmin, Admin | List teachers with active assigned classes |
| `GET` | `/teachers/:id/classes` | Superadmin, Admin | Classes for one teacher |
| `GET` | `/teachers/:id/available-substitutes` | Superadmin, Admin | Conflict-free teachers for personnel suspension |
| `GET` | `/teachers/:id/class-history` | Superadmin, Admin | View-only assignment history (assigned / turnover or class end dates) |
| `POST` | `/teachers/:id/turnover/preview` | Superadmin, Admin | Dry-run schedule fit per class (shown as soon as destination teacher is selected) |
| `POST` | `/teachers/:id/turnover` | Superadmin, Admin | Move selected classes to another teacher |

History is stored in `teacher_class_historytbl` (migration `118_create_teacher_class_historytbl.sql`). Turnover writes end dates; open assignments are backfilled from `classteacherstbl` on history load.

## Available substitutes (`GET /teachers/:id/available-substitutes`)

Used by Superadmin Edit Personnel when setting a teacher to **Suspended**.

- Loads the source teacher's **active** classes
- Candidates are other Active teachers in the same branch (Admin: own branch only)
- Each candidate is evaluated with `evaluateClassForTurnover` / `checkTeacherScheduleConflict`
- Returns only teachers with no schedule conflicts (already-assigned-to-class is allowed)
- Does **not** reassign classes; that remains Class Turnover. This endpoint only powers the substitute dropdown.

## Turnover rules

- Source and destination must both be `user_type = Teacher`
- Admin may only transfer within their branch
- Destination schedule is checked with `checkTeacherScheduleConflict` (existing class schedule conflict utility)
- On success: remove source from `classteacherstbl`, add destination, update `classestbl.teacher_id` when it pointed at the source teacher
- Also syncs `classsessionstbl.assigned_teacher_id` / `original_teacher_id` via `syncClassSessionTeachersFromClass` (sessions without an active substitute)
- Co-teachers on the class are preserved (only the resigning teacher is replaced)

If older turnovers left session teacher IDs stale, run:

`node scripts/repairStaleSessionTeachersAfterTurnover.js`

## Deep-link turnover from Personnel

When setting a teacher to **Inactive**, Personnel can open:

`/superadmin/teachers?tab=turnover&turnoverTeacherId=<id>`  
(or `/admin/teachers?...` for Branch Admin)

Teachers page switches to the **Turnover class** tab and opens the turn-over modal for that teacher.
