# Payments UI Components

Shared UI for finance payment logs and related flows.

## Components

| File | Purpose |
|------|---------|
| `UnappliedArPaymentLogStatus.jsx` | Status column for unapplied package AR rows in Payment Logs. |
| `FiuuPayOnlinePanel.jsx` | FIUU tab for invoice Record Payment and AR Create Step 2. **Send payment link**, **Open FIUU now**, invoice **tip/discount**, and **Advanced settings** (expiry, Preview). |

## Public pay page

| Path | File |
|------|------|
| API `GET /payments/fiuu/go/:token` | Backend HTML auto-POST to FIUU — **used by email Pay now** |
| `/pay/fiuu/:token` | Optional CMS landing (`FiuuPublicPayPage.jsx`) for diagnostics |

## Advanced settings (`FiuuPayOnlinePanel`)

Collapsible section matching FIUU-style options:

| Control | Behavior |
|---------|----------|
| Tip / Discount (invoice) | Same as manual Record Payment; FIUU charge = amount due − discount + tip |
| Expiry Date | Optional. When set → email shows that date and link expires then. When blank → email shows **N/A** (no auto-expiry) |
| Preview | Opens HTML preview via `POST /payments/fiuu/preview-email` |

Paid links are always disabled after FIUU confirms payment (no staff toggle). AR tip/discount stay on the create form above the panel.

## Related utils

- `frontend/src/utils/fiuuPayment.js` — create (invoice/AR), preview email, public fetch, poll, form POST helpers

## Related backend

- `POST /api/sms/payments/fiuu/create` — `send_email`, advanced link options
- `POST /api/sms/payments/fiuu/create-ar` — same
- `POST /api/sms/payments/fiuu/preview-email` — HTML preview only
- `GET /api/sms/payments/fiuu/public/:token` — unauthenticated landing payload
- See `backend/services/fiuu/README.md`
