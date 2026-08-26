# Lesson plans API

`GET/POST /api/sms/lesson-plans` and related actions.

## Teacher

| Method | Path | Description |
|--------|------|-------------|
| GET | `/meta` | Grade/subject options, prepared_by, branch header fields |
| GET | `/` | Own lesson plans |
| GET | `/:id` | One plan |
| POST | `/` | Create draft (or `status: submitted`) |
| PUT | `/:id` | Update draft / revision_requested (reflections cleared). Or, when `awaiting_reflection` and today is the lesson date (Manila), save reflections → `completed` |
| POST | `/:id/submit` | Submit for verification (clears reflections) |

## Superadmin / Admin verifiers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/verifiers/me` | Whether the current user may verify (`true` for all Superadmins; Admins only if selected in Settings) |
| GET | `/verifiers` | Selected Admin verifier users (Settings; Superadmin only) |
| PUT | `/verifiers` | Replace Admin verifier list (`user_ids`: Admin only, must have `branch_id`). Superadmins are not stored. |
| GET | `/?status=…` | Review queue. Superadmin: all branches. Admin verifier: own branch. |
| GET | `/:id` | One plan (Superadmin or configured Admin; Admin branch-scoped) |
| POST | `/:id/approve` | Approve; optional Head Teacher review body: `head_teacher_overall_assessment`, `head_teacher_specific_feedback`, `head_teacher_next_steps` |
| POST | `/:id/request-revision` | Send back with structured feedback: `items[{ field, highlight, note }]` and/or `reason` (general). Stored as JSON in `revision_reason`. |

Teacher body fields follow the **LCA Lesson Plan PDF** (phase/session, goals, objectives, assessment, materials, lesson overview, class 1–3 adjustments). Reflections: Successes / Amazing Moments / Challenges / Improvements.

Migrations: `141_create_lesson_plan_tables.sql`, `145_align_lesson_plan_fields_to_lca_form.sql`, `146_add_deped_meta_to_branchestbl.sql`

`/meta` and plan rows return per-branch DepEd header fields (`region` / `division` / `district` from `branchestbl`); `school_id` is always `411093`.
