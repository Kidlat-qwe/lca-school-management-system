# Dashboard components

Shared UI for operational, enrollment, and financial dashboards.

## Operational attendance shortcuts

Superadmin and **Admin** operational dashboards use a compact **Take attendance** card in the Sales summary row (alongside Sales & Payments and Recent invoice payments). **Superadmin does not see this card** — use the dedicated Daily/Monthly Attendance dashboards to view summaries only.

| Component | Role |
|-----------|------|
| `OperationalAttendanceCard.jsx` | Preview card (3 pending sessions) + **See all** button |
| `OperationalAttendanceModal.jsx` | Full session list with filter tabs and accurate summary counts |
| `OperationalAttendanceShortcuts.jsx` | Full table for Teacher dashboard (daily sessions on main dashboard) |
| `TeacherDashboardView.jsx` | Unified teacher dashboard — stats, today’s sessions, assigned classes, monthly attendance card |

**API:** `GET /dashboard/operational-attendance-sessions`

Query params:

| Param | Description |
|-------|-------------|
| `mode` | `daily` or `monthly` |
| `summary_date` / `summary_month` | Period scope |
| `branch_id` | Optional branch filter |
| `program_id` | Optional program filter |
| `class_id` | Optional class filter |
| `teacher_id` | Optional teacher filter (Superadmin/Admin) |
| `attendance_filter` | `all`, `pending`, `taken`, or `upcoming` |
| `list_limit` | Optional row cap for card preview (summary counts always use full period) |

**Summary fields (full period, aligned with Class Details):**

- One row per class + phase + session (earliest scheduled date — same as Classes detail `classSessions.find(...)`)
- `pending_count` — due today or earlier, session status not `Completed`
- `taken_count` — session status is `Completed` (attendance saved in class details)
- `upcoming_count` — session date after today (Manila)
- `total_count` — all canonical sessions in the period (excluding cancelled)

**Modal filter tabs:** All · Needs attendance · Already taken · Upcoming

**Take / View attendance:** Opens `ClassSessionAttendanceModal` in place (no navigation to Classes). Saves via `POST /attendance/session/:classsessionId` — same data as **Classes → View class details → Attendance**.

## Dedicated Attendance dashboards

| Component | Role |
|-----------|------|
| `AttendanceDashboardView.jsx` | Full daily/monthly attendance dashboard — KPI cards, rates, mark distribution chart, monthly daily trend, rate summary tables, session table, modal |
| `AttendanceRateSummarySection.jsx` | Tabbed tables: attendance rates by teacher, program, and class (Present + Absences rates) |

**Routes (per role):**

| Role | Daily | Monthly |
|------|-------|---------|
| Superadmin | `/superadmin/daily-attendance-dashboard` | `/superadmin/monthly-attendance-dashboard` |
| Admin | `/admin/daily-attendance-dashboard` | `/admin/monthly-attendance-dashboard` |
| Teacher | `/teacher/daily-attendance-dashboard` | `/teacher/monthly-attendance-dashboard` |

Sidebar: **Dashboard → Attendance → Daily / Monthly Attendance Dashboard**

Extended API fields on `GET /dashboard/operational-attendance-sessions`: `session_completion_rate`, `mark_coverage_rate`, `present_rate`, `absent_rate`, mark counts, `daily_breakdown` (monthly), `rate_summaries` (`by_teacher`, `by_program`, `by_class`).

**Take attendance access:** Branch **Admin** and **Teacher** only. Superadmin can view sessions and summaries but cannot save attendance (`POST /attendance/session/:id` is Admin/Teacher only).

Filter dropdowns: `GET /dashboard/operational-attendance-filter-options?branch_id=&program_id=`

| Component | Role |
|-----------|------|
| `AttendanceDashboardFilters.jsx` | Program / class / teacher selects on attendance dashboards |
| `useAttendanceDashboardFilters.js` | Loads filter option lists for the selected branch |

**List columns:** Class, Branch (when multi-branch), Teacher, Session, Schedule, Attendance status, Action

**Deep link params on `/classes`:** Still supported for direct links from other pages: `classId`, `sessionId`, `phaseNumber`, `phaseSessionNumber`, `scheduledDate`, `openAttendance=1`

See also: `backend/lib/operationalAttendanceSessions.js`, `frontend/src/hooks/useOperationalAttendanceSessions.js`, `frontend/src/utils/operationalAttendanceDisplay.js`, `frontend/src/components/class/ClassSessionAttendanceModal.jsx`.
