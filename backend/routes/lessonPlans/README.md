# Lesson plans API

`GET/POST /api/sms/lesson-plans` and related actions.

## Teacher

| Method | Path | Description |
|--------|------|-------------|
| GET | `/meta` | Grade/subject options, prepared_by, branch header fields |
| GET | `/` | Own lesson plans |
| GET | `/:id` | One plan |
| POST | `/` | Create draft (or `status: submitted`) |
| PUT | `/:id` | Update draft / revision_requested |
| POST | `/:id/submit` | Submit for verification |

## Superadmin / Admin verifiers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/verifiers/me` | Whether the current Superadmin/Admin is a configured verifier |
| GET | `/verifiers` | Configured verifier users (Settings; Superadmin only) |
| PUT | `/verifiers` | Replace verifier list (`user_ids`: Superadmin and Admin). Admin users must have a `branch_id`. |
| GET | `/?status=…` | Review queue (configured verifiers). Admin scoped to their branch. |
| GET | `/:id` | One plan (configured verifiers; Admin branch-scoped) |
| POST | `/:id/approve` | Approve (configured verifier; Admin branch-scoped) |
| POST | `/:id/request-revision` | Send back with optional `reason` (Admin branch-scoped) |

Review UI:
- Superadmin **Lesson Plans** (`/superadmin/lesson-plans`) — all branches
- Admin **Lesson Plans** (`/admin/lesson-plans`) — designated branch only

Settings only manages the verifier list.

## Notifications

| Event | Recipients | `navigation_key` |
|-------|------------|------------------|
| Teacher submits | Matching verifiers: Superadmin + Admin for plan branch (fallback: all Superadmins) | `lesson-plans` |
| Verifier approves | Teacher who authored the plan | `lesson-plans` |
| Verifier requests revision | Teacher who authored the plan | `lesson-plans` |

Migration: `141_create_lesson_plan_tables.sql`
