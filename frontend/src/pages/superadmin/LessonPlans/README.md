# Superadmin / Admin Lesson Plan Review

Pages:
- `/superadmin/lesson-plans` (Superadmin verifiers — all branches)
- `/admin/lesson-plans` (Admin verifiers — designated branch only)

Component: `index.jsx` (shared)

## Access

- Visible in the sidebar only when the signed-in user is listed under **Settings → Lesson Plans → Lesson plan verifiers**.
- Direct URL visits by non-verifiers redirect to `/superadmin` or `/admin`.
- Backend enforces verifier membership; Admin verifiers are further limited to `lessonplanstbl.branch_id = admin.branch_id`.

## Folder navigation

Browse like a file cabinet:

1. **Program** folders — grouped by lesson plan `grade_level` (Nursery, Kindergarten, …). Badge = pending `submitted` count.
2. **Teacher** folders — teachers who have plans under the selected program.
3. **Lesson plans** — document-style cards for that teacher; open to review.

Breadcrumb path: `Programs / {Program} / {Teacher}`. Back button returns one level.

## Review modal

Detail modal opens as a larger document-style sheet; body scrolls inside `max-h-[94vh]`; page scroll is locked while open. **Approve** / **Request revision** stay fixed at the bottom when status is `submitted`.

After verification, status is **`awaiting_reflection`** until the teacher completes Teacher's Reflection on the lesson date → **`completed`**. Verifiers can browse these plans in the folders. The Approve action still sets verification metadata (`verified_by` / `verified_at`).

## Request revision (structured)

Verifiers (after clicking **Request revision**) can:

- Check **Field needs revision** → **Add Revision Reason** modal
- Select text → **Highlight selected text** → same reason modal with quoted text
- Field content is shown in bordered containers; then **Review & submit revision**
