# Payments UI Components

Shared UI for finance payment logs and related flows.

## Components

| File | Purpose |
|------|---------|
| `UnappliedArPaymentLogStatus.jsx` | Status column for unapplied package AR rows in Payment Logs. |
| `FiuuPayOnlinePanel.jsx` | FIUU tab for invoice Record Payment and AR Create Step 2. **Primary:** Send payment link to guardian email. **Secondary:** Open FIUU now. CMS stays unpaid until webhook. Toggle with `FIUU_PAYMENT_UI_ENABLED`. |

## Public pay page

| Path | File |
|------|------|
| API `GET /payments/fiuu/go/:token` | Backend HTML auto-POST to FIUU — **used by email Pay now** |
| `/pay/fiuu/:token` | Optional CMS landing (`FiuuPublicPayPage.jsx`) for diagnostics |

## Related utils

- `frontend/src/utils/fiuuPayment.js` — create (invoice/AR), public fetch, poll, form POST helpers

## Related backend

- `POST /api/sms/payments/fiuu/create` — `send_email` + `recipient_email`
- `POST /api/sms/payments/fiuu/create-ar` — same
- `GET /api/sms/payments/fiuu/public/:token` — unauthenticated landing payload
- See `backend/services/fiuu/README.md`
