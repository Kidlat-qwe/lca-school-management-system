# Payments UI Components

Shared UI for finance payment logs and related flows.

## Components

| File | Purpose |
|------|---------|
| `UnappliedArPaymentLogStatus.jsx` | Status column for unapplied package AR rows in Payment Logs. **Pending** rows are clickable for Finance/Superfinance (opens reference modal → verifies AR). **Approved** shows verifier name when Finance verified. |

## Related utils

- `frontend/src/utils/unappliedArPaymentLog.js` — parse `AR-{id}` rows and call `PUT /acknowledgement-receipts/:id/verify`

## Related backend

- `GET /api/sms/payments/finance-unified` — includes unapplied package AR (`Submitted` or `Verified`); approval from `paymentLogArApproval.js`
- `PUT /api/sms/acknowledgement-receipts/:id/verify` — Finance verify from Payment Logs or AR page
