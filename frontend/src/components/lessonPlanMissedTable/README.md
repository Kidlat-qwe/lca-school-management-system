# LessonPlanMissedTable

Responsive table for **missed** lesson plans: overdue class sessions with no submitted plan.

## Rules (backend)

- Window: `since <= scheduled_date < today` (Asia/Manila)
- Default `since`: code constant `LESSON_PLAN_MISSED_SINCE_DEFAULT` (**2026-09-19**)
- Draft does **not** count as submitted
- Match: teacher + `class_id` + phase number + session number
- Statuses that clear a miss: `submitted`, `revision_requested`, `awaiting_reflection`, `completed`

## Columns

| Column | Source |
|--------|--------|
| Scheduled Date | `scheduled_date` |
| Teacher | `teacher_name` (optional via `showTeacher`) |
| Topic | Curriculum session `topic` |
| Class Code | Session `class_code` |
| Phase and Session | `phase` · `session` |
| Grade Level | Class `level_tag` |
| Days Overdue | Calendar days past scheduled date |
| Action | Optional **Create** (`onCreate`) for teachers |
