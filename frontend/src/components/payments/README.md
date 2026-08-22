# Payments UI Components

Shared UI for finance payment logs and related flows.

## Components

| File | Purpose |
|------|---------|
| `UnappliedArPaymentLogStatus.jsx` | Status column for unapplied package AR rows in Payment Logs. |
| `FiuuPayOnlinePanel.jsx` | FIUU tab for invoice Record Payment and AR Create Step 2. **Send payment link**, **Open FIUU now**, and **Advanced settings** (expiry, disable after payment, Preview). |

## Public pay page

| Path | File |
|------|------|
| API `GET /payments/fiuu/go/:token` | Backend HTML auto-POST to FIUU — **used by email Pay now** |
| `/pay/fiuu/:token` | Optional CMS landing (`FiuuPublicPayPage.jsx`) for diagnostics |

## Advanced settings (`FiuuPayOnlinePanel`)

Collapsible section matching FIUU-style options:

| Control | Behavior |
|---------|----------|
| Expiry Date | Optional; blank uses 7-day server TTL. Sent as `pay_link_expires_on` when set |
| Disable Payment Link After Payment | Off by default; when on, paid links show already-paid |
| Preview | Opens HTML preview via `POST /payments/fiuu/preview-email` |

## Related utils

- `frontend/src/utils/fiuuPayment.js` — create (invoice/AR), preview email, public fetch, poll, form POST helpers

## Related backend

- `POST /api/sms/payments/fiuu/create` — `send_email`, advanced link options
- `POST /api/sms/payments/fiuu/create-ar` — same
- `POST /api/sms/payments/fiuu/preview-email` — HTML preview only
- `GET /api/sms/payments/fiuu/public/:token` — unauthenticated landing payload
- See `backend/services/fiuu/README.md`
