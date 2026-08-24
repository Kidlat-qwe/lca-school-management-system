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

## Superadmin

| Method | Path | Description |
|--------|------|-------------|
| GET | `/verifiers/me` | Whether the current Superadmin is a configured verifier |
| GET | `/verifiers` | Configured verifier users (Settings) |
| PUT | `/verifiers` | Replace verifier list (`user_ids`, Superadmin only) |
| GET | `/?status=…` | Review queue (configured verifiers only) |
| GET | `/:id` | One plan (configured verifiers only) |
| POST | `/:id/approve` | Approve (must be configured verifier) |
| POST | `/:id/request-revision` | Send back with optional `reason` |

Review UI: Superadmin **Lesson Plans** page (`/superadmin/lesson-plans`), shown only to configured verifiers. Settings only manages the verifier list.

## Notifications

| Event | Recipients | `navigation_key` |
|-------|------------|------------------|
| Teacher submits | Configured verifiers (fallback: all Superadmins) | `lesson-plans` |
| Verifier approves | Teacher who authored the plan | `lesson-plans` |
| Verifier requests revision | Teacher who authored the plan | `lesson-plans` |

Migration: `141_create_lesson_plan_tables.sql`
