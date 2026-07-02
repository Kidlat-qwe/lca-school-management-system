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

**APIs:**

- `GET /dashboard/operational-attendance-sessions` (teacher-scoped via auth)
- `GET /classes?branch_id=…` (filtered client-side to assigned teacher)

Legacy URLs `/teacher/daily-operational-dashboard` and `/teacher/monthly-operational-dashboard` redirect to `/teacher`.
