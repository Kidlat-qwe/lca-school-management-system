# Announcement recipient emails

Resolves email addresses for announcement **recipient groups** and sends branded notification emails when a board announcement is created with **Active** status.

## Recipient groups

| Group | Email source |
|-------|----------------|
| Students | `userstbl.email` where `user_type = 'Student'` |
| Teachers | `userstbl.email` where `user_type = 'Teacher'` |
| Admin | `userstbl.email` where `user_type = 'Admin'` |
| Finance | `userstbl.email` where `user_type = 'Finance'` (branch finance + network finance with no branch) |
| Superadmin | All `Superadmin` users (network-wide) |
| Superfinance | All `Superfinance` users (network-wide) |
| Guardians | `guardianstbl.email` linked through the student’s branch |
| All | Expands to every group above |

Branch scoping follows the announcement’s `branch_id`. When `branch_id` is null, recipients are resolved network-wide.

**Email subject:** uses `announcementstbl.email_subject` when set. If it is empty, the mail subject falls back to `[Announcement] ${title}`.

**Image attachments:** when `attachment_url` is an image, the email shows it as a hosted hero image at the top (`<img src="…">`, 7-day signed S3 URL). The announcement description (`body`) is below the image. Priority is not included. Non-image files remain a download link only. Creating an announcement with no attachment is valid (`attachment_url` may be `null` or omitted).

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
