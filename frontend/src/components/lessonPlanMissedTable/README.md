# LessonPlanMissedTable

Responsive table for **missed** lesson plans: overdue class sessions with no submitted plan.

## Rules (backend)

- Window: `since <= scheduled_date < today` (Asia/Manila)
- Default `since`: code constant `LESSON_PLAN_MISSED_SINCE_DEFAULT` (**2026-09-25**)
- Draft does **not** count as submitted
- Match: teacher + `class_id` + session `class_code` / subject (or phase+session; Week plans use subject or session number)
- Statuses that clear a miss: `submitted`, `revision_requested`, `awaiting_reflection`, `completed`
- **Makeup** sessions (`is_makeup` / `Rescheduled` / `suspension_id`) are included when overdue; cancelled originals are not

## Columns

| Column | Source |
|--------|--------|
| Scheduled Date | `scheduled_date` |
| Teacher | `teacher_name` (optional via `showTeacher`) |
| Topic | Curriculum session `topic` |
| Class Code | Session `class_code` (+ **Makeup** badge when `is_makeup`) |
| Phase and Session | `phase` · `session` (prefixed **Makeup ·** when applicable) |
| Grade Level | Class `level_tag` |
| Days Overdue | Calendar days past scheduled date |
| Action | Optional **Create** (`onCreate`) for teachers |
