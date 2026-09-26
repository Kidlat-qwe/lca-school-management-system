# First enrollment welcome email

Sends a **single email** when a student is **first officially enrolled** (`program_enrollment_status = 'new'`).

## Contents

| Part | Content |
|------|---------|
| HTML body | Full-page **image** of the designed welcome letter (`LCA EMAIL.pdf` rasterized to JPEG) |
| Plain text | Short fallback for clients that strip HTML |
| Attachment | Optional **AR PDF** only (acknowledgement receipt) — never `LCA EMAIL.pdf` |

Gmail and most clients **cannot display a PDF inside the message body**. Attaching the PDF would only show a downloadable file. The welcome design is therefore shipped as a JPEG `<img>`.

## Welcome page image

| Mechanism | Purpose |
|-----------|---------|
| `<img src="https://…/public/email-assets/welcome-email.jpg">` | Visible designed letter in Gmail |
| `GET /api/sms/public/email-assets/welcome-email.jpg` | Public file from `assets/lca-welcome-email-page.jpg` |
| Source design | `frontend/public/LCA EMAIL.pdf` (regenerate JPEG when the PDF changes) |

After deploying the matching backend, confirm the image opens in a browser:

| `NODE_ENV` | Welcome page URL |
|------------|------------------|
| `development` | `https://cms.lca-app.com/api/sms/public/email-assets/welcome-email.jpg` |
| `production` | `https://cms.little-champion.com/api/sms/public/email-assets/welcome-email.jpg` |

Env overrides (optional):

| Variable | Purpose |
|----------|---------|
| `EMAIL_WELCOME_PAGE_IMAGE_URL` | Full absolute image URL |
| `EMAIL_WELCOME_ASSET_ORIGIN` | Force origin (overrides NODE_ENV host pick) |
| `PUBLIC_API_BASE_URL` | If set, asset URLs are built from this API base |

## Behavior

- **Trigger:** enrollment status assigned as `new` (not pending/reserved/re_enrolled/upsell/rejoin).
- **Recipients:** student `userstbl.email` + primary guardian `guardianstbl.email` (lowest `guardian_id`).
- Same address on student and guardian → **one** email (`normalizeNotificationRecipients`).
- Attaches downloadable **AR PDF** when an invoice/AR can be resolved (same helper as Payment Received).
- **Idempotency:** `system_logstbl` row with `entity_type = first_enrollment_onboarding_sequence`. Legacy rows with `first_enrollment_welcome_email` also block re-send.
- **Earliest enrollment:** only the first `new` class enrollment for the student triggers the email.
- Hard-delete wipe script clears both log types so re-enroll tests can send again.
- Uses existing Brevo/SMTP stack via `emailService.js` / `emailTransport.js`.
- Settings → Templates subject/enabled are respected; **HTML body always uses the page image** (Settings text bodies are not sent as the visual letter).

## Module layout

| File | Purpose |
|------|---------|
| `index.js` | Queue/send orchestration, AR attachment, idempotency |
| `emailBodies.js` | Plain-text fallback + HTML builders (`wrapWelcomePageEmailHtml`) |
| `defaultTemplates.js` | Default Settings → Templates JSON (short body note) |
| `templateConfig.js` | Loads Settings subject/enabled; forces image HTML for onboarding |
| `classContext.js` | Load enrolled-phase first session date + weekly schedule from CMS |
| `branchGroupChat.js` | Branch-specific Messenger group chat invite URLs |

## Settings → Templates

Editable under **Settings → Templates → First enrollment onboarding** (Superadmin and Admin):

| Template key | Purpose |
|--------------|---------|
| `template_first_enrollment_onboarding` | Subject + enabled flag (body text is not used for the visual letter) |

Legacy keys (`class_schedule`, `things_to_prepare`, `important_reminders`, `stay_connected`) remain in the settings registry for DB compatibility but are **not sent** and are hidden from the Templates UI.

## API

| Export | Purpose |
|--------|---------|
| `queueFirstEnrollmentWelcomeEmail({ studentId, enrollmentStatus, classstudentId, invoiceId, ackReceiptId })` | Fire-and-forget (preferred from enrollment writers) |
| `maybeSendFirstEnrollmentWelcomeEmail(...)` | Awaitable send (tests / after-COMMIT hooks) |
| `buildSequenceEmail(emailId, context)` | Build subject + HTML (`onboarding` = page image) |
| `buildOnboardingPlainText()` / `buildOnboardingHtml()` | Plain fallback + image HTML |
| `loadEnrollmentClassContext(classstudentId)` | Class start date + schedule text |

## Env (optional)

| Variable | Default | Purpose |
|----------|---------|---------|
| `FIRST_ENROLLMENT_WELCOME_ACADEMIC_YEAR` | `2026–2027` | Kept for legacy helpers / Settings variables |
| `FIRST_ENROLLMENT_WELCOME_EMAIL_DELAY_MS` | `3000` | Delay before send (DB commit) |
| `FIRST_ENROLLMENT_FACEBOOK_URL` | `https://www.facebook.com/littlechampionsacademy` | Facebook link (legacy) |
| `EMAIL_WELCOME_PAGE_IMAGE_URL` | `{cms}/api/sms/public/email-assets/welcome-email.jpg` | Absolute URL for welcome page image |
| `FIRST_ENROLLMENT_BRANCH_GROUP_CHAT_URLS` | _(built-in defaults)_ | Optional JSON override by branch |

## Hook points

- `routes/students.js` — direct enroll
- `utils/installmentEnrollmentSync.js` — installment phase paid → `new`
- `utils/fullPaymentPhaseEnrollment.js` — full-payment phase range
- `utils/enrollmentStatus.js` — orphan pending promote
- `routes/acknowledgementreceipts.js` — AR full-payment auto-enroll

## Test script

```bash
node backend/scripts/sendTestFirstEnrollmentWelcomeEmail.js
node backend/scripts/sendTestFirstEnrollmentWelcomeEmail.js --email=someone@example.com
node backend/scripts/sendTestFirstEnrollmentWelcomeEmail.js --email=someone@example.com --force-sequence
```

Clears idempotency logs for the student, then sends the welcome email (page image + optional AR).

To reset logs only:

```bash
node backend/scripts/clearFirstEnrollmentOnboardingLogs.js --student-id=123
```
