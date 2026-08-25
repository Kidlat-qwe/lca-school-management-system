# Teacher pages

## Dashboard (`/teacher`)

Single unified dashboard for teachers (`TeacherDashboardView`). No separate daily/monthly operational dashboard routes.

**Sections:**

1. **Summary stats** — assigned classes, sessions on selected date, needs attendance, already taken
2. **Class sessions** — date picker + full attendance table with Take/View attendance modals
3. **My assigned classes** — preview table with link to `/teacher/classes`
4. **Monthly attendance** — month picker + compact card with See all modal

**Dedicated attendance dashboards** (sidebar: Dashboard → Attendance):

- `/teacher/daily-attendance-dashboard` — full daily stats, rates, charts, take/update attendance
- `/teacher/monthly-attendance-dashboard` — monthly summary, daily trend chart, full session list

## Lesson Plans (`/teacher/lesson-plans`)

UI styling matches the QA `TeacherLessonPlans.jsx` sheet (Poppins, header grid, peach primary buttons, submissions sidebar).

- Fixed school header meta (Region III, Bulacan, 5th District, School ID 411093)
- Save draft / submit for verification (Teacher's Reflection locked at submit)
- After verifier approves → status **`awaiting_reflection`** (UI: Awaiting Reflection); reflections unlock **only on the lesson date** (Manila); saving marks **`completed`** (no re-approval)
- When status is **`revision_requested`**, structured revision notes appear **under each flagged field** (highlight + note); general/legacy notes stay above the action buttons
- Prepared by = logged-in teacher
- Superadmin → Settings → Lesson Plans configures Superadmin + Admin verifiers; review is on `/superadmin/lesson-plans` or `/admin/lesson-plans` (Admin = designated branch only)

**API:** `/api/sms/lesson-plans`

**APIs:**

- `GET /dashboard/operational-attendance-sessions` (teacher-scoped via auth)
- `GET /classes?branch_id=…` (filtered client-side to assigned teacher)

Legacy URLs `/teacher/daily-operational-dashboard` and `/teacher/monthly-operational-dashboard` redirect to `/teacher`.
