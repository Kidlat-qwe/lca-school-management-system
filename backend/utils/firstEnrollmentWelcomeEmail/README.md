# First enrollment welcome email

Sends a one-time welcome email when a student is **first officially enrolled** (`program_enrollment_status = 'new'`).

## Behavior

- Trigger: enrollment status assigned as `new` (not pending/reserved/re_enrolled/upsell/rejoin).
- Recipients: student `userstbl.email` + primary guardian `guardianstbl.email` (lowest `guardian_id`).
- Same address on student and guardian → **one** email (`normalizeNotificationRecipients`).
- Attaches downloadable **AR PDF** when an invoice/AR can be resolved (same helper as Payment Received).
- Idempotency: `system_logstbl` row with `entity_type = first_enrollment_welcome_email` plus earliest-`new` enrollment check.
- Hard-delete wipe script also clears that welcome log so re-enroll tests can send again.
- Uses existing Brevo/SMTP stack via `emailService.js` / `emailTransport.js`.

## Email body (exact copy)

```
Congratulations!

We are pleased to inform you that you are now officially enrolled at Little Champions Academy Inc. for Academic Year 2026–2027.

We are delighted to welcome you to the Little Champions family! We look forward to partnering with you in creating a meaningful and exciting learning journey filled with opportunities to play, learn, and succeed.

Thank you for choosing Little Champions Academy. We are excited to have you with us!

Welcome to Little Champions Academy!

Best Regards,
Little Champions Academy Inc.
Play . Learn . Succeed
```

Built by `buildFirstEnrollmentWelcomePlainText()` / `buildFirstEnrollmentWelcomeHtml()`.

HTML uses the same branded shell as Payment Received emails (`plainTextToEmailHtml`):
yellow LCA header banner, white body, gray “automated email” footer.

## API

| Export | Purpose |
|--------|---------|
| `queueFirstEnrollmentWelcomeEmail({ studentId, enrollmentStatus, classstudentId, invoiceId, ackReceiptId })` | Fire-and-forget (preferred from enrollment writers) |
| `maybeSendFirstEnrollmentWelcomeEmail(...)` | Awaitable send (tests / after-COMMIT hooks) |
| `buildFirstEnrollmentWelcomeHtml()` | Branded HTML body |

## Env (optional)

| Variable | Default | Purpose |
|----------|---------|---------|
| `FIRST_ENROLLMENT_WELCOME_ACADEMIC_YEAR` | `2026–2027` | Year text in the body |
| `FIRST_ENROLLMENT_WELCOME_EMAIL_DELAY_MS` | `3000` | Delay before send so the DB transaction can commit |

## Hook points

- `routes/students.js` — direct enroll
- `utils/installmentEnrollmentSync.js` — installment phase paid → `new`
- `utils/fullPaymentPhaseEnrollment.js` — full-payment phase range
- `utils/enrollmentStatus.js` — orphan pending promote
- `routes/acknowledgementreceipts.js` — AR full-payment auto-enroll
