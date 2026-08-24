# Announcement recipient emails

Resolves email addresses for announcement **recipient groups** and sends branded notification emails when a board announcement is created with **Active** status.

## Recipient groups

| Group | Email source |
|-------|----------------|
| Students | `userstbl.email` where `user_type = 'Student'` **and** actively enrolled (`new` / `re_enrolled` / `upsell` / `rejoin`, `removed_at` null) |
| Teachers | `userstbl.email` where `user_type = 'Teacher'` |
| Admin | `userstbl.email` where `user_type = 'Admin'` |
| Finance | `userstbl.email` where `user_type = 'Finance'` (branch finance + network finance with no branch) |
| Superadmin | All `Superadmin` users (network-wide) |
| Superfinance | All `Superfinance` users (network-wide) |
| Guardians | `guardianstbl.email` only when linked student is actively enrolled |
| All | Expands to every group above |

Branch scoping follows the announcement’s `branch_id`. When `branch_id` is null, recipients are resolved network-wide.

**Academic audience (optional):** `program_ids` / `class_ids` further narrow **Students**, **Guardians**, and **Teachers**. Empty = all programs/classes. Students and Guardians always require active enrollment (same statuses as Reports Active / class ops). Admin / Finance / Super* are not filtered by program/class.

**Email subject:** uses `announcementstbl.email_subject` when set. If it is empty, the mail subject falls back to `[Announcement] ${title}`.

**Image attachments:** when `attachment_url` is an image, the email shows the announcement description (`body`) first, then the hosted image below it (`<img src="…">`, 7-day signed S3 URL). Priority is not included. Non-image files remain a download link under the message. Creating an announcement with no attachment is valid (`attachment_url` may be `null` or omitted).

## Usage

Called from `POST /announcements` after a successful create (fire-and-forget) when the client sends `send_email: true` (default). Emails are skipped when:

- `send_email` is `false` (board-only announcement)
- Status is not `Active` (Draft / Inactive)
- SMTP / Brevo is not configured
- No valid email addresses were found

## Exports

- `expandAnnouncementRecipientGroups(recipientGroups)`
- `resolveAnnouncementRecipientEmails({ recipientGroups, branchId })`
- `buildAnnouncementEmailHtml(options)`
- `sendAnnouncementCreatedEmails({ announcement, branchName })`
