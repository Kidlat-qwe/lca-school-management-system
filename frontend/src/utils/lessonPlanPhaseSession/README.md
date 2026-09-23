# Lesson plan phase / session helpers

Used by `teacherLessonPlans.jsx` to populate Class Code, Phase/Week, and Session from `GET /classes/:id/sessions`.

## Grade-level behavior

| Grade level | Field after Class Code | Saved `phase` value |
|-------------|------------------------|---------------------|
| Nursery, Pre Kindergarten, others | **Phase** (from schedule) | `Phase N` |
| **Kindergarten**, **Grade School** (and Grade 1–6) | **Week** (1–44) | `Week N` |

## Cancelled / Makeup sessions (Class Code list)

Class Code options include:

| Status | Visible | Selectable | Secondary label |
|--------|---------|------------|-----------------|
| **Cancelled** (suspended original) | Yes (even if past) | No | `Cancelled · Phase X - Session Y` |
| **Rescheduled** (makeup) | Yes | Yes | `Makeup · Phase X - Session Y` |
| Scheduled (upcoming) | Yes | Yes | `Phase X - Session Y` |

Display session numbers match **Class Details**: cancelled keep the original number; active + makeup are renumbered chronologically within each class+phase (makeup for cancelled Session 1 → Session 1).

Option values include `classsession_id` so cancelled and makeup rows stay unique even when DB session numbers differ from display numbers.

## Form flow

1. **Grade Level** → filters Class list  
2. **Class** → filters Class Code list (Class Code is a full-width row **below** Class)
3. **Class Code** → sets schedule Phase / Session (and week grades still pick Week separately)  
4. Past **Scheduled** sessions are hidden unless editing; **Cancelled** and **Makeup** stay listed for context.
5. **Phase** / **Session** / **Week** dropdown option text is **numbers only** (e.g. `1`, `2`); Session may append the schedule date in parentheses.
6. For **Kindergarten** / **Grade School** (Week grades), the **Session** dropdown shows **dates only** (no session number).

Helpers: `isLessonPlanWeekGradeLevel`, `isLessonPlanMakeupSession`, `isLessonPlanCancelledSession`, `buildLessonPlanDisplaySessionNumberMap`, `formatLessonPlanPhaseSessionLabel`, `LESSON_PLAN_WEEK_OPTIONS`.
