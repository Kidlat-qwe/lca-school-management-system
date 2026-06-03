# Payments UI Components

Shared UI for finance payment logs and related flows.

## Components

| File | Purpose |
|------|---------|
| `UnappliedArPaymentLogStatus.jsx` | Status column for unapplied package AR rows in Payment Logs; shows **Approved** and verifier name when the AR was verified on the AR page (`verified_by_user_id`). |

## Related backend

- `GET /api/sms/payments/finance-unified` — maps unapplied verified AR approval from `acknowledgement_receiptstbl.verified_by_user_id`
- `PUT /api/sms/acknowledgement-receipts/:id/verify` — sets verifier columns and syncs linked `paymenttbl` when `payment_id` exists
