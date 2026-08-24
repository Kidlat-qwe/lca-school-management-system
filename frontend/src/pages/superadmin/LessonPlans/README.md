# Superadmin Lesson Plan Review

Page: `/superadmin/lesson-plans`  
Component: `index.jsx`

## Access

- Visible in the Superadmin sidebar only when the signed-in user is listed under **Settings → Lesson Plans → Lesson plan verifiers**.
- Direct URL visits by non-verifiers redirect to `/superadmin`.
- Backend also enforces verifier membership on list/get/approve/request-revision.

## UI flow

1. Grade-level cards (grouped from submitted / revision_requested / approved plans).
2. Filtered list (teacher, subject, status).
3. Detail modal opens as a larger document-style sheet (teacher form visual); body scrolls inside `max-h-[94vh]`; page scroll is locked while open. **Approve** / **Request revision** stay fixed at the bottom when status is `submitted`.

UI layout is adapted from the QA guide (`QA_LessonPlans.jsx`) using Tailwind to match PSMS.
