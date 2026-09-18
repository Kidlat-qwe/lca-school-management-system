# LessonPlanSubmissionsTable

Responsive submissions table for teacher and verifier Lesson Plans, styled like **My Classes**.

## Behavior

- Table **headers always render**, including when there is no data (empty message in a full-width body row)
- Page does not scroll horizontally; only the table container scrolls

## Columns

| Column | Source |
| --- | --- |
| Lesson Date | `lesson_date` |
| Teacher | `teacher_name` (optional; pass `showTeacher` for verifier Pending / Revision / Verified) |
| Topic | `topic` (click selects plan for edit when `onSelect` is set) |
| Class Code | `class_code` / `class_label` |
| Phase and Session | `phase` · `session` (single line) |
| Grade Level | `grade_level` |
| Status | `status` badge |
| Submitted At / Verified At | `submitted_at` by default; pass `timestampMode="verified"` to show `verified_at` as **Verified At** (Asia/Manila, date + time on two lines) |
| Action | Eye icon → `onView(plan)` |

```jsx
import LessonPlanSubmissionsTable from '../components/lessonPlanSubmissionsTable';

<LessonPlanSubmissionsTable
  plans={filteredPlans}
  loading={loading}
  emptyMessage="No lesson plans submitted yet."
  showingLabel="Showing 3 of 3 lesson plans"
  timestampMode="submitted"
  showTeacher
  onView={(plan) => setViewPlan(plan)}
  onSelect={(plan) => handleSelectPlan(plan)}
/>
```
