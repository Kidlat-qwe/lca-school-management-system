# Users API

Routes: `../users.js` mounted at `/api/sms/users`.

## Personnel status (migration `150_add_status_to_userstbl.sql`)

| Column | Type | Notes |
| --- | --- | --- |
| `status` | `VARCHAR(20)` | `Active` (default), `Inactive`, or `Suspended` |
| `substitute_teacher_id` | `INTEGER` FK → `userstbl.user_id` | Set when a Teacher is Suspended; cleared otherwise |

## Status meanings

| Status | Meaning | Classes | Login |
| --- | --- | --- | --- |
| `Active` | Normal | Keep assignments | Allowed |
| `Suspended` | Temporary leave | Keep ownership; require **substitute teacher** for Teachers | Blocked |
| `Inactive` | No longer teaching | Must **turn over** all active (non-archived) classes first — no substitute | Blocked |

## Endpoints (status-related)

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| `GET` | `/users` | Superadmin, Admin | List users; includes `status` and `substitute_teacher_id` |
| `PUT` | `/users/:id` | Superadmin, Admin (or own profile for non-status fields) | Update user; admins may set `status` / `substitute_teacher_id` |

### `PUT /users/:id` status rules

- Only Superadmin / Admin may change `status` or `substitute_teacher_id`
- Valid `status` values: `Active`, `Inactive`, `Suspended`
- When `status` is not `Suspended`, `substitute_teacher_id` is forced to `null`
- When suspending a **Teacher**, `substitute_teacher_id` is required and must reference an Active Teacher
- When setting a **Teacher** to `Inactive`, reject if they still have active assigned classes (`TEACHER_HAS_ACTIVE_CLASSES`). Admin must use Teachers → Turnover class first.
- Auth middleware blocks API access for `Inactive` / `Suspended` accounts (`ACCOUNT_STATUS_BLOCKED`)
