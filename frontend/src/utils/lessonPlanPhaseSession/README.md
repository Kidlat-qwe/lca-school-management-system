# Lesson plan phase / session helpers

Used by `teacherLessonPlans.jsx` to populate Phase and Session dropdowns from `GET /classes/:id/sessions`.

- **Phase** options = distinct `phase_number` values for the selected class.
- **Session** options = rows matching the selected phase (`phase_session_number` + optional topic label).
- **Lesson date** auto-fills from `scheduled_date` when a session is selected. Session labels and helper text use `formatLessonPlanDateDisplay()` so dates match the Lesson Date field (`<input type="date">`).

Form state stores internal keys (`phase`: `"1"`, `session`: `"1-2"`). Save converts to API strings (`Phase 1`, `Session 2 — Topic`).
