# Lesson plans API

`GET/POST /api/sms/lesson-plans` and related actions.

## Teacher

| Method | Path | Description |
|--------|------|-------------|
| GET | `/meta` | Grade levels and classes derived from the teacher's branch roster (`classestbl`), prepared_by, branch header fields |
| GET | `/` | Own lesson plans |
| GET | `/missed` | Own overdue sessions with no submitted lesson plan (draft does not count) |
| GET | `/:id` | One plan |
| POST | `/` | Create draft (or `status: submitted`) |
| PUT | `/:id` | Update draft / revision_requested (reflections cleared). Or, when `awaiting_reflection`, save complete reflections → `completed` |
| POST | `/:id/submit` | Submit for verification (clears reflections) |

## Superadmin / Admin verifiers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/verifiers/me` | Whether the current user may verify (`true` for all Superadmins; Admins only if selected in Settings) |
| GET | `/verifiers` | Selected Admin verifier users (Settings; Superadmin only) |
| PUT | `/verifiers` | Replace Admin verifier list (`user_ids`: Admin only, must have `branch_id`). Superadmins are not stored. |
| GET | `/?status=…` | Review queue. Superadmin: all branches. Admin verifier: own branch. |
| GET | `/missed` | Overdue sessions missing a submitted plan. Superadmin: optional `branch_id`. Admin: designated branch. |
| GET | `/:id` | One plan (Superadmin or configured Admin; Admin branch-scoped) |
| POST | `/:id/approve` | Approve; **requires** Head Teacher review body: `head_teacher_overall_assessment`, `head_teacher_specific_feedback`, `head_teacher_next_steps` |
| POST | `/:id/request-revision` | Send back with structured feedback: `items[{ field, highlight, note }]` and/or `reason` (general). Stored as JSON in `revision_reason`. |

### Missed lesson plans

A session is **missed** when:

1. `classsessionstbl.scheduled_date` is **on/after** `since` and **before** today (Asia/Manila)
2. Class is Active and not archived; session is not Cancelled
3. Teacher is assigned (`classestbl.teacher_id` or `classteacherstbl`)
4. No lesson plan for that teacher + class + phase + session with status in `submitted` | `revision_requested` | `awaiting_reflection` | `completed` (draft does not count)

**Go-live cutoff:** code constant `LESSON_PLAN_MISSED_SINCE_DEFAULT` in `lib/lessonPlans` (**2026-09-19**). Override per request with `?since=YYYY-MM-DD`. Response includes `meta.since` / `meta.default_since`. Not stored in `.env`.

Teacher body fields follow the **LCA Lesson Plan PDF** (phase/session, goals, objectives, assessment, materials, lesson overview, one CMS class via `class_id`, class-specific considerations/adjustments). Reflections: Successes / Amazing Moments / Challenges / Improvements.

Migrations: `141_create_lesson_plan_tables.sql`, `145_align_lesson_plan_fields_to_lca_form.sql`, `146_add_deped_meta_to_branchestbl.sql`, `148_add_class_id_to_lessonplanstbl.sql`

`/meta` and plan rows return per-branch DepEd header fields (`region` / `division` / `district` from `branchestbl`); `school_id` is always `411093`.
