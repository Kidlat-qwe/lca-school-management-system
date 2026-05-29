# SMS (Semaphore)

Outbound SMS for parent/guardian notifications paired with email templates.

## Supported templates (Settings)

| Template key | Trigger |
|--------------|---------|
| `template_payment_confirmation` | Payment recorded |
| `template_payment_reminder` | Overdue invoice reminder |
| `template_monthly_invoice_notice` | Auto-generated monthly installment invoice |

SMS uses `sms_body` from Settings when set; otherwise the email `body` (plain text).

## Environment (`backend/.env`)

```env
SEMAPHORE_API_KEY=your_api_key_here
SEMAPHORE_SENDER_NAME=YourSender
SMS_NOTIFICATIONS_ENABLED=true
# Optional override:
# SEMAPHORE_API_URL=https://api.semaphore.co/api/v4/messages
```

- Register sender name at [Semaphore](https://semaphore.co/).
- Messages starting with `TEST` are rejected by Semaphore.

## Phone numbers

Collected from `guardianstbl.guardian_phone_number` and `userstbl.phone_number`, normalized to `63XXXXXXXXXX`.

## Behaviour

- SMS is sent **after** the matching email is sent (same template variables).
- If the template is **disabled**, both email and SMS are skipped.
- If **SMS enabled** is off on the template, email still sends; SMS does not.
- SMS failures are logged; they do not roll back the email or invoice.
