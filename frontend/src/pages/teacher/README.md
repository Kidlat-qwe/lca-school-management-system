# Teacher pages

## Dashboard (`/teacher`)

Single unified dashboard for teachers (`TeacherDashboardView`). No separate daily/monthly operational dashboard routes.

**Sections:**

1. **Summary stats** — assigned classes, sessions on selected date, needs attendance, already taken
2. **Class sessions** — date picker + full attendance table with Take/View attendance modals
3. **My assigned classes** — preview table with link to `/teacher/classes`
4. **Monthly attendance** — month picker + compact card with See all modal

**Class Details** (`/teacher/classes` → View): phase session tables match Superadmin/Admin suspension display — makeup sessions are merged in, and rows are sorted by **scheduled date** (cancelled sessions stay chronological, not moved to the end of the phase).

**Dedicated attendance dashboards** (sidebar: Dashboard → Attendance):

- `/teacher/daily-attendance-dashboard` — full daily stats, rates, charts, take/update attendance
- `/teacher/monthly-attendance-dashboard` — monthly summary, daily trend chart, full session list

## Lesson Plans (`/teacher/lesson-plans`)

Page layout matches **My Classes**: page title, tabs, search + filters card, then a white shadowed table.

### Tabs

| Tab | Content |
|-----|---------|
| **My Plans** | Submitted / draft lesson plans (`LessonPlanSubmissionsTable`) |
| **Missed** | Overdue scheduled sessions without a submitted plan (`LessonPlanMissedTable`); **Track from** date limits history; **Create** opens the form prefilled for that session |

- Table headers always show (even with no rows)
- Filters: search, **Lesson Date** (native date input, off by default), **Grade Level**, **Status** (My Plans only)
- Columns (My Plans): Lesson Date, Topic, Class Code, Phase and Session, Grade Level, Status, Submitted At (Asia/Manila date + time on two lines; set on first submit only), Action (eye + download PDF)
- **Create Lesson Plan** → form modal
  - Flow: **Grade Level** → **Class** → **Class Code** (Class Code on its own full-width row below Class so long codes are fully visible)
  - **Kindergarten** and **Grade School**: **Week** dropdown (Week 1–44) replaces **Phase**; Class Code still shows Phase + Session from the schedule
  - **Makeup** class sessions appear in Class Code as options labeled `Makeup · Phase X - Session Y` (display numbers match Class Details)
  - **Cancelled** (suspended) sessions also appear for context with `Cancelled · …` (not selectable); pick the makeup Class Code instead
  - Other grades: Phase + Session as before
  - Closing the form (X, backdrop, Escape) while editing a **draft** / **revision** / new plan **auto-saves as draft** if anything changed
- **Eye icon** → read-only document modal
- **Download icon** → PDF (`GET /lesson-plans/:id/pdf`)
- **Delete** (view modal, after Edit) → only for **Draft**; confirms then `DELETE /lesson-plans/:id`
- **Topic click** → edit form modal (draft / revision)
- **Awaiting Reflection** → eye icon / topic opens the form scrolled to Teacher Reflection; reflection fields show a red blinking border; **Save Reflection & Mark Completed** sets status to `completed`

**API:** `/api/sms/lesson-plans` (including `GET /lesson-plans/missed`, `GET /lesson-plans/:id/pdf`)

**Modules:** `lessonPlanSubmissionsTable`, `lessonPlanMissedTable`, `lessonPlanViewModal`, `lessonPlanDateFilter`, `lessonPlanClassCodeSelect`, `lessonPlanPhaseSession`, `lessonPlanHeader`, `downloadLessonPlanPdf`

**APIs:**

- `GET /dashboard/operational-attendance-sessions` (teacher-scoped via auth)
- `GET /classes?branch_id=…` (filtered client-side to assigned teacher)

Legacy URLs `/teacher/daily-operational-dashboard` and `/teacher/monthly-operational-dashboard` redirect to `/teacher`.
