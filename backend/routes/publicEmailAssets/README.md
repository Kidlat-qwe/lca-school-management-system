# Public email assets

Unauthenticated routes for brand images used in transactional emails.

Brevo does **not** support CID inline images (they become downloadable attachments).
Welcome emails therefore reference these URLs in `<img src="…">`.

## Endpoints

| Method | Path | File served |
| --- | --- | --- |
| `GET` | `/public/email-assets/welcome-letterhead.jpg` | `assets/lca-welcome-email-header.jpg` (cropped quar header) |
| `GET` | `/public/email-assets/welcome-letterhead-full.jpg` | `assets/lca-welcome-email-bg.jpg` (full letterhead) |

Mounted at `/api/sms` → full URL example:

`https://cms.little-champion.com/api/sms/public/email-assets/welcome-letterhead.jpg`
