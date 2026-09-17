# First enrollment welcome email

Sends a **single combined email** when a student is **first officially enrolled** (`program_enrollment_status = 'new'`).

## Contents (one message)

| Section | Content |
|---------|---------|
| Welcome | Official enrollment congratulations (Academic Year from env). Optional AR PDF attachment. |
| Class Schedule | First day = first session of the enrolled phase; weekly schedule from CMS. |
| Things to Prepare | Static checklist (clothes, hygiene kit, snack, water bottle). |
| Important Reminders | Static bullet reminders. |
| Stay Connected | Facebook page link + branch Messenger group chat link. |

## Behavior

- **Trigger:** enrollment status assigned as `new` (not pending/reserved/re_enrolled/upsell/rejoin).
- **Recipients:** student `userstbl.email` + primary guardian `guardianstbl.email` (lowest `guardian_id`).
- Same address on student and guardian → **one** email (`normalizeNotificationRecipients`).
- Attaches downloadable **AR PDF** when an invoice/AR can be resolved (same helper as Payment Received).
- **Idempotency:** `system_logstbl` row with `entity_type = first_enrollment_onboarding_sequence`. Legacy rows with `first_enrollment_welcome_email` also block re-send.
- **Earliest enrollment:** only the first `new` class enrollment for the student triggers the email.
- Hard-delete wipe script clears both log types so re-enroll tests can send again.
- Uses existing Brevo/SMTP stack via `emailService.js` / `emailTransport.js`.

## Module layout

| File | Purpose |
|------|---------|
| `index.js` | Queue/send orchestration, AR attachment, idempotency |
| `emailBodies.js` | Fallback plain-text + HTML builders (used when Settings template missing/stale) |
| `defaultTemplates.js` | Default Settings → Templates JSON (combined body) |
| `templateConfig.js` | Loads Settings template; upgrades stale welcome-only bodies to combined fallback |
| `classContext.js` | Load enrolled-phase first session date + weekly schedule from CMS |
| `branchGroupChat.js` | Branch-specific Messenger group chat invite URLs |

## Settings → Templates

Editable under **Settings → Templates → First enrollment onboarding** (Superadmin and Admin):

| Template key | Purpose |
|--------------|---------|
| `template_first_enrollment_onboarding` | Combined welcome email (all sections) |

Legacy keys (`class_schedule`, `things_to_prepare`, `important_reminders`, `stay_connected`) remain in the settings registry for DB compatibility but are **not sent** and are hidden from the Templates UI.

If a branch still has an old welcome-only body saved under `template_first_enrollment_onboarding`, send-time logic uses the **combined code fallback** until Settings is updated to the new combined body.

## API

| Export | Purpose |
|--------|---------|
| `queueFirstEnrollmentWelcomeEmail({ studentId, enrollmentStatus, classstudentId, invoiceId, ackReceiptId })` | Fire-and-forget (preferred from enrollment writers) |
| `maybeSendFirstEnrollmentWelcomeEmail(...)` | Awaitable send (tests / after-COMMIT hooks) |
| `buildSequenceEmail(emailId, context)` | Build subject + HTML (`onboarding` = combined) |
| `buildOnboardingPlainText()` / `buildOnboardingHtml()` | Combined body |
| `loadEnrollmentClassContext(classstudentId)` | Class start date + schedule text |

## Env (optional)

| Variable | Default | Purpose |
|----------|---------|---------|
| `FIRST_ENROLLMENT_WELCOME_ACADEMIC_YEAR` | `2026–2027` | Year text in welcome section |
| `FIRST_ENROLLMENT_WELCOME_EMAIL_DELAY_MS` | `3000` | Delay before send (DB commit) |
| `FIRST_ENROLLMENT_FACEBOOK_URL` | `https://www.facebook.com/littlechampionsacademy` | Facebook link |
| `FIRST_ENROLLMENT_BRANCH_GROUP_CHAT_URLS` | _(built-in defaults)_ | Optional JSON override by branch |
| `FIRST_ENROLLMENT_SEQUENCE_STEP_DELAY_MS` | _(unused)_ | Deprecated — was delay between the old 5 emails |

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

Clears idempotency logs for the student, then sends the combined welcome email.

To reset logs only:

```bash
node backend/scripts/clearFirstEnrollmentOnboardingLogs.js --email=someone@example.com
```
