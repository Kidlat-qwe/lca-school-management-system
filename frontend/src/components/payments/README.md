# Payments UI Components

Shared UI for finance payment logs and related flows.

## Components

| File | Purpose |
|------|---------|
| `UnappliedArPaymentLogStatus.jsx` | Status column for unapplied package AR rows in Payment Logs. **Pending** rows are clickable for Finance/Superfinance (opens reference modal → verifies AR). **Approved** shows verifier name when Finance verified. |
| `FiuuPayOnlinePanel.jsx` | Staff-assisted **Pay via FIUU (QRPH)** on invoice Record Payment modal (Admin/Superadmin). Toggle with `FIUU_PAYMENT_UI_ENABLED` in `frontend/src/utils/fiuuPayment.js` (currently **true** for Coolify UAT). |

## Related utils

- `frontend/src/utils/unappliedArPaymentLog.js` — parse `AR-{id}` rows and call `PUT /acknowledgement-receipts/:id/verify`
- `frontend/src/utils/fiuuPayment.js` — FIUU create/status/poll helpers. `FIUU_PAYMENT_UI_ENABLED` shows/hides the payment-modal tab.

## Related backend

- `GET /api/sms/payments/finance-unified` — includes unapplied package AR (`Submitted` or `Verified`); approval from `paymentLogArApproval.js`
- `PUT /api/sms/acknowledgement-receipts/:id/verify` — Finance verify from Payment Logs or AR page
- `POST /api/sms/payments/fiuu/create` — start FIUU invoice payment (see `backend/services/fiuu/README.md`)
- `GET|POST /api/webhooks/fiuu/notify|callback|return` — FIUU Check (GET) + payment IPN (POST)
