# Superadmin / Admin Lesson Plan Review

Pages:
- `/superadmin/lesson-plans` (Superadmin verifiers — all branches)
- `/admin/lesson-plans` (Admin verifiers — designated branch only)

Component: `index.jsx` (shared)

## Access

- Visible in the sidebar only when the signed-in user is listed under **Settings → Lesson Plans → Lesson plan verifiers**.
- Direct URL visits by non-verifiers redirect to `/superadmin` or `/admin`.
- Backend enforces verifier membership; Admin verifiers are further limited to `lessonplanstbl.branch_id = admin.branch_id`.

## UI flow

1. Grade-level cards (grouped from submitted / revision_requested / approved plans).
2. Filtered list (teacher, subject, status).
3. Detail modal opens as a larger document-style sheet (teacher form visual); body scrolls inside `max-h-[94vh]`; page scroll is locked while open. **Approve** / **Request revision** stay fixed at the bottom when status is `submitted`.

UI layout is adapted from the QA guide (`QA_LessonPlans.jsx`) using Tailwind to match PSMS.
