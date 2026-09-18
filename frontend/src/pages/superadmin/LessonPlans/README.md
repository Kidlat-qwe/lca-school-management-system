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

## List UI (table + tabs)

Matches the teacher Lesson Plans table layout (`LessonPlanSubmissionsTable`):

| Column | Source |
|--------|--------|
| Lesson Date | `lesson_date` |
| Teacher | `teacher_name` (Pending / Revision / Verified) |
| Topic | `topic` |
| Class Code | `class_code` / `class_label` / `subject` |
| Phase and Session | `phase` · `session` |
| Grade Level | `grade_level` |
| Status | `status` |
| Submitted At | `submitted_at` (Pending / Revision tabs; Asia/Manila) |
| Verified At | `verified_at` (**Verified** tab only; replaces Submitted At) |
| Action | Eye → open review modal |

### Tabs

| Tab | Statuses | Meaning |
|-----|----------|---------|
| **Pending** | `submitted` | Awaiting verifier approve / request revision |
| **Revision** | `revision_requested` | Sent back to teacher; waiting for edits + resubmit |
| **Verified** | `awaiting_reflection`, `completed` | Approved by verifier |
| **Missed** | *(no plan row)* | Overdue class sessions with no submitted plan (`GET /lesson-plans/missed`) |

### Missed tab

- Shows overdue expected lesson plans within the **Track from** window (`scheduled_date >= since` and before today, Asia/Manila).
- Default `since` comes from code constant `LESSON_PLAN_MISSED_SINCE_DEFAULT` (**2026-09-19**) so months before the feature do not flood the list. Change **Track from** on the Missed tab to widen/narrow.
- Draft plans do **not** clear a miss.
- Columns: Scheduled Date, Teacher, Topic, Class Code, Phase and Session, Grade Level, Days Overdue.
- Component: `LessonPlanMissedTable`. Superadmin branch filter applies via `branch_id`.

### Status flow

1. Teacher submits → **Pending** (`submitted`)
2. Verifier requests revision → **Revision** (`revision_requested`)
3. Teacher resubmits → **Pending** again (`submitted`) — backend `POST /lesson-plans/:id/submit`
4. Verifier approves → **Verified** (`awaiting_reflection` → later `completed`)

Badge counts on each tab respect the Superadmin header branch filter.

### Filters

- Search (topic, teacher, class code, grade, branch name, …)
- Lesson date (`LessonPlanDateFilter`)
- Grade level (options derived from loaded plans)
- **Branch** (Superadmin only) — yellow app header dropdown (`useGlobalBranchFilter` / `lesson-plans` route segment); sends `branch_id` on `GET /lesson-plans`. Empty selection = All Branches.

Admin verifiers do not get the header branch control; the API already scopes their queue to their designated branch.

## Review modal (LCA form fields)

Detail modal opens as a larger document-style sheet; body scrolls inside `max-h-[94vh]`; page scroll is locked while open. Header meta still shows lesson date, grade level, **class**, and teacher.

Body fields follow the LCA Lesson Plan PDF order and are flaggable in revision mode:

- Topic, Phase, Session, **Class** (CMS class from branch roster)
- Early Learning Goals; Objective 1–3
- Assessment Method / Criteria
- Materials Needed To Prepare
- Procedure: Preliminaries, Lesson Proper, Conclusion (activity & goal each; time fields removed from UI)
- Class-Specific Adjustments: considerations and adjustments for the selected class
- Teacher's Reflection (read-only): Successes, Amazing Moments, Challenges, Improvements
- **Head Teacher's Review and Feedback** (editable on Approve; read-only after): Overall Assessment, Specific Feedback, Next Steps — also shown read-only to the teacher after approval

**Approve** / **Request revision** stay fixed at the bottom when status is `submitted` (Pending tab). Plans on the Revision tab are view-only until the teacher resubmits.

### Head Teacher's Review (verifier-only)

When status is `submitted` and not in revision mode, the verifier **must** fill three textareas before Approve:

- `head_teacher_overall_assessment`
- `head_teacher_specific_feedback`
- `head_teacher_next_steps`

Approve stays disabled until all three are non-empty. The API also rejects approve without them.

These are sent on `POST /lesson-plans/:id/approve`. For `awaiting_reflection` and `completed` plans, the saved values are shown read-only.

After verification, status is **`awaiting_reflection`** until the teacher completes Teacher's Reflection → **`completed`**. Verified plans appear under the **Verified** tab. The Approve action still sets verification metadata (`verified_by` / `verified_at`).

## Request revision (structured)

Verifiers (after clicking **Request revision**) can:

- Check **Field needs revision** → **Add Revision Reason** modal
- Field content is shown in bordered containers; then **Review & submit revision**
- Revision field dropdown options match the LCA flaggable keys above (reflections excluded)
