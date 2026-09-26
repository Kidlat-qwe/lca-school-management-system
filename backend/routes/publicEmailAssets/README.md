# Public email assets

Unauthenticated routes for brand images used in transactional emails.

Brevo does **not** support CID inline images (they become downloadable attachments).
Welcome emails therefore reference these URLs in `<img src="…">`.

Gmail cannot display a PDF in the message body. The welcome letter design
(`frontend/public/LCA EMAIL.pdf`) is rasterized to JPEG and served here.

## Endpoints

| Method | Path | File served |
| --- | --- | --- |
| `GET` | `/public/email-assets/welcome-email.jpg` | `assets/lca-welcome-email-page.jpg` (full welcome letter page) |
| `GET` | `/public/email-assets/welcome-letterhead.jpg` | `assets/lca-welcome-email-header.jpg` (legacy cropped header) |
| `GET` | `/public/email-assets/welcome-letterhead-full.jpg` | `assets/lca-welcome-email-bg.jpg` (full letterhead) |

Mounted at `/api/sms` → full URL examples:

- Development: `https://cms.lca-app.com/api/sms/public/email-assets/welcome-email.jpg`
- Production: `https://cms.little-champion.com/api/sms/public/email-assets/welcome-email.jpg`
