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

Form fields follow the **LCA Lesson Plan PDF**: phase/session, early learning goals, objectives 1–3, assessment method/criteria, materials, general lesson overview (preliminaries / lesson proper / conclusion), class-specific adjustments (Class 1–3). Grade level + subject remain for program browsing.

- Branch-based DepEd letterhead (Region / Schools Division Office from branch; DepEd seal `/deped-seal.png`); School ID always `411093`
- After approval, teachers see read-only **Head Teacher's Review and Feedback** (Overall Assessment, Specific Feedback, Next Steps)
- Save draft / submit for verification (Teacher's Reflection locked at submit)
- Reflections: Successes, Amazing Moments, Challenges, Improvements — unlock **only on the lesson date** after verifier approve (`awaiting_reflection` → `completed`)
- When status is **`revision_requested`**, structured revision notes appear **under each flagged field**
- Prepared by = logged-in teacher
- Superadmin → Settings → Lesson Plans selects **Admin** verifiers only; all Superadmins can already review

**API:** `/api/sms/lesson-plans`

**APIs:**

- `GET /dashboard/operational-attendance-sessions` (teacher-scoped via auth)
- `GET /classes?branch_id=…` (filtered client-side to assigned teacher)

Legacy URLs `/teacher/daily-operational-dashboard` and `/teacher/monthly-operational-dashboard` redirect to `/teacher`.
