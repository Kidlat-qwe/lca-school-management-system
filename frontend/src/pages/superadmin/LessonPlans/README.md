# Superadmin / Admin Lesson Plan Review

Pages:
- `/superadmin/lesson-plans` (all Superadmins — all branches)
- `/admin/lesson-plans` (Admin verifiers selected in Settings — designated branch only)

Component: `index.jsx` (shared)

## Access

- **Superadmin**: always see Lesson Plans in the sidebar; no Settings selection required.
- **Admin**: visible in the sidebar only when selected under **Settings → Lesson Plans**.
- Direct URL visits by non-verifiers redirect to `/superadmin` or `/admin`.
- Backend: every Superadmin may verify; Admin verifiers are limited to `lessonplanstbl.branch_id = admin.branch_id`.

## Folder navigation

Browse like a file cabinet:

1. **Program** folders — grouped by lesson plan `grade_level` (Nursery, Kindergarten, …). Badge = pending `submitted` count.
2. **Teacher** folders — teachers who have plans under the selected program.
3. **Lesson plans** — document-style cards for that teacher; open to review.

Breadcrumb path: `Programs / {Program} / {Teacher}`. Back button returns one level.

## Review modal (LCA form fields)

Detail modal opens as a larger document-style sheet; body scrolls inside `max-h-[94vh]`; page scroll is locked while open. Header meta still shows lesson date, grade level, subject, and teacher.

Body fields follow the LCA Lesson Plan PDF order and are flaggable in revision mode:

- Topic, Phase, Session
- Early Learning Goals; Objective 1–3
- Assessment Method / Criteria
- Materials Needed To Prepare
- Procedure: Preliminaries, Lesson Proper, Conclusion (time + activity each)
- Differentiation: Class 1–3 (name, age group, considerations, adjustments)
- Teacher's Reflection (read-only): Successes, Amazing Moments, Challenges, Improvements
- **Head Teacher's Review and Feedback** (editable on Approve; read-only after): Overall Assessment, Specific Feedback, Next Steps — also shown read-only to the teacher after approval

**Approve** / **Request revision** stay fixed at the bottom when status is `submitted`.

### Head Teacher's Review (verifier-only)

When status is `submitted` and not in revision mode, the verifier fills three textareas before Approve:

- `head_teacher_overall_assessment`
- `head_teacher_specific_feedback`
- `head_teacher_next_steps`

These are sent on `POST /lesson-plans/:id/approve`. For `awaiting_reflection` and `completed` plans, the saved values are shown read-only.

After verification, status is **`awaiting_reflection`** until the teacher completes Teacher's Reflection on the lesson date → **`completed`**. Verifiers can browse these plans in the folders. The Approve action still sets verification metadata (`verified_by` / `verified_at`).

## Request revision (structured)

Verifiers (after clicking **Request revision**) can:

- Check **Field needs revision** → **Add Revision Reason** modal
- Select text → **Highlight selected text** → same reason modal with quoted text
- Field content is shown in bordered containers; then **Review & submit revision**
- Revision field dropdown options match the LCA flaggable keys above (reflections excluded)
