# Announcement creator permissions

Superadmin **Settings → Announcements** controls who may create board announcements.

## Modes

| Mode | Behavior |
|------|----------|
| `all` | Any authenticated user may create announcements |
| `roles` | Only selected user types (Admin, Teacher, Student, …) |
| `specific` | Only users listed in `announcement_creatorstbl` |

**Superadmin** users always have create access (not stored in the allowlist table).

## Storage

- `system_settingstbl`: `announcement_creator_mode`, `announcement_creator_roles`
- `announcement_creatorstbl`: explicit user allowlist when mode = `specific`
- Table is auto-created on first use if migration 148 was not applied yet; run `148_create_announcement_creatorstbl.sql` on production for a controlled deploy.

## API

- `GET /api/sms/announcements/creators/me` — `{ can_create: boolean }`
- `GET /api/sms/announcements/creators` — Superadmin: full config
- `PUT /api/sms/announcements/creators` — Superadmin: save config

Enforced on `POST/PUT/DELETE /announcements` and `POST /upload/announcement-file`.
