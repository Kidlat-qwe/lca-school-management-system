# Teachers API

Routes: `../teachers.js` mounted at `/api/sms/teachers`.

## Endpoints

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| `GET` | `/teachers` | Superadmin, Admin | List teachers with active assigned classes |
| `GET` | `/teachers/:id/classes` | Superadmin, Admin | Classes for one teacher |
| `GET` | `/teachers/:id/class-history` | Superadmin, Admin | View-only assignment history (assigned / turnover or class end dates) |
| `POST` | `/teachers/:id/turnover/preview` | Superadmin, Admin | Dry-run schedule fit per class (shown as soon as destination teacher is selected) |
| `POST` | `/teachers/:id/turnover` | Superadmin, Admin | Move selected classes to another teacher |

History is stored in `teacher_class_historytbl` (migration `118_create_teacher_class_historytbl.sql`). Turnover writes end dates; open assignments are backfilled from `classteacherstbl` on history load.

## Turnover rules

- Source and destination must both be `user_type = Teacher`
- Admin may only transfer within their branch
- Destination schedule is checked with `checkTeacherScheduleConflict` (existing class schedule conflict utility)
- On success: remove source from `classteacherstbl`, add destination, update `classestbl.teacher_id` when it pointed at the source teacher
- Co-teachers on the class are preserved (only the resigning teacher is replaced)

## Query params (`GET /teachers`)

- `branch_id` — Superadmin optional filter
- `search` — name/email
- `page`, `limit`
