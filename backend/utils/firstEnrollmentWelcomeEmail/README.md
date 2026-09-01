# First enrollment onboarding email sequence

Sends a **one-time sequence of five emails** when a student is **first officially enrolled** (`program_enrollment_status = 'new'`).

## Sequence

| # | ID | Subject | Content |
|---|-----|---------|---------|
| 1 | `onboarding` | Welcome to Little Champions Academy! | Official enrollment congratulations (Academic Year from env). Optional AR PDF attachment. |
| 2 | `class_schedule` | Your Class Schedule – Little Champions Academy | First day = first session of the enrolled phase (`MIN(classsessionstbl.scheduled_date)` for that `classstudentstbl.phase_number`); falls back to CMS class `start_date`. Weekly schedule from `roomschedtbl` (fallback: sessions for that phase). |
| 3 | `things_to_prepare` | Things to Prepare for Class – Little Champions Academy | Static checklist (clothes, hygiene kit, snack, water bottle). |
| 4 | `important_reminders` | Important Reminders – Little Champions Academy | Static bullet reminders. |
| 5 | `stay_connected` | Stay Connected – Little Champions Academy | Facebook page link + branch Messenger group chat link (Malolos, Pampanga, Guiguinto, Cavite). |

Emails are sent **separately** (not one combined message), with a short delay between each step.

## Behavior

- **Trigger:** enrollment status assigned as `new` (not pending/reserved/re_enrolled/upsell/rejoin).
- **Recipients:** student `userstbl.email` + primary guardian `guardianstbl.email` (lowest `guardian_id`).
- Same address on student and guardian → **one** email per step (`normalizeNotificationRecipients`).
- **Email 1** attaches downloadable **AR PDF** when an invoice/AR can be resolved (same helper as Payment Received).
- **Idempotency:** `system_logstbl` row with `entity_type = first_enrollment_onboarding_sequence`. Legacy rows with `first_enrollment_welcome_email` also block re-send.
- **Earliest enrollment:** only the first `new` class enrollment for the student triggers the sequence.
- Hard-delete wipe script clears both log types so re-enroll tests can send again.
- Uses existing Brevo/SMTP stack via `emailService.js` / `emailTransport.js`.

## Module layout

| File | Purpose |
|------|---------|
| `index.js` | Queue/send orchestration, AR attachment, idempotency |
| `emailBodies.js` | Fallback plain-text + HTML builders (used when Settings template missing) |
| `defaultTemplates.js` | Default Settings → Templates JSON for all five emails |
| `templateConfig.js` | Maps email IDs to template keys; loads Settings templates at send time |
| `classContext.js` | Load enrolled-phase first session date + weekly schedule from CMS |
| `branchGroupChat.js` | Branch-specific Messenger group chat invite URLs |

## Settings → Templates

Each of the five onboarding emails is editable under **Settings → Templates → First enrollment onboarding** (Superadmin and Admin). Same editor as Payment Confirmation: title, subject, body, enabled toggle, and `{variable}` palette.

| Template key | Email |
|--------------|-------|
| `template_first_enrollment_onboarding` | 1 — Welcome |
| `template_first_enrollment_class_schedule` | 2 — Class schedule |
| `template_first_enrollment_things_to_prepare` | 3 — Things to prepare |
| `template_first_enrollment_important_reminders` | 4 — Important reminders |
| `template_first_enrollment_stay_connected` | 5 — Stay connected |

Global defaults apply to all branches; branch overrides are supported like other templates. Disabling a template skips that step in the sequence.

## API

| Export | Purpose |
|--------|---------|
| `queueFirstEnrollmentWelcomeEmail({ studentId, enrollmentStatus, classstudentId, invoiceId, ackReceiptId })` | Fire-and-forget (preferred from enrollment writers) |
| `maybeSendFirstEnrollmentWelcomeEmail(...)` | Awaitable send (tests / after-COMMIT hooks) |
| `buildSequenceEmail(emailId, context)` | Build subject + HTML for one step |
| `buildOnboardingPlainText()` / `buildOnboardingHtml()` | Email 1 body |
| `loadEnrollmentClassContext(classstudentId)` | Class start date + schedule text |

## Env (optional)

| Variable | Default | Purpose |
|----------|---------|---------|
| `FIRST_ENROLLMENT_WELCOME_ACADEMIC_YEAR` | `2026–2027` | Year text in onboarding email |
| `FIRST_ENROLLMENT_WELCOME_EMAIL_DELAY_MS` | `3000` | Delay before sequence starts (DB commit) |
| `FIRST_ENROLLMENT_SEQUENCE_STEP_DELAY_MS` | `45000` | Delay between emails 2–5 |
| `FIRST_ENROLLMENT_FACEBOOK_URL` | `https://www.facebook.com/littlechampionsacademy` | Facebook link in Stay Connected email |
| `FIRST_ENROLLMENT_BRANCH_GROUP_CHAT_URLS` | _(built-in defaults)_ | Optional JSON override, e.g. `{"malolos":"https://m.me/j/..."}` or `{"1":"https://..."}` by branch_id |

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

Clears idempotency logs for the student, then sends the full sequence (or onboarding preview if no student row exists).

To reset logs only (keep current enrollment):

```bash
node backend/scripts/clearFirstEnrollmentOnboardingLogs.js --email=someone@example.com
```
