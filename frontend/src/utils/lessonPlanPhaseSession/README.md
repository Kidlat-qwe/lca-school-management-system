# Lesson plan phase / session helpers

Used by `teacherLessonPlans.jsx` to populate Class Code, Phase, and Session from `GET /classes/:id/sessions`.

- After **Grade Level** is chosen, Class Code / Phase / Session stay empty until the teacher picks a Class Code (no auto-default).
- **Class Code** uses a custom dropdown (`LessonPlanClassCodeSelect`) that opens **below** the field and highlights the first option on open. Options are per-session `class_code` values (same as **Classes → View Class Details**), without the schedule date in the label.
- Selecting a **Class Code** sets `class_id` + **Phase** + **Session** to that session’s values.
- Changing Phase defaults Session to the first upcoming session in that phase (Class Code selection follows via `class_id|phase-session`).
- Past sessions (`scheduled_date` before today, Manila) are hidden unless editing an existing plan.
- **Lesson date** auto-fills from `scheduled_date` once a session is selected.

Form state stores internal keys (`phase`: `"1"`, `session`: `"1-2"`, class code value: `"94|1-2"`). Save converts phase/session to API strings (`Phase 1`, `Session 2 — Topic`).

`buildLessonPlanClassCodeValue` accepts either a bare session number or a full session key so form values (`session: "1-6"`) match option values.
