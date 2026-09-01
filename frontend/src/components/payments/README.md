# Payments UI Components

Shared UI for finance payment logs and related flows.

## Components

| File | Purpose |
|------|---------|
| `UnappliedArPaymentLogStatus.jsx` | Status column for unapplied package AR rows in Payment Logs. |
| `FiuuPayOnlinePanel.jsx` | FIUU tab for invoice Record Payment and AR Create Step 2. Send link / Open pay page, tip/discount, advanced expiry/preview. |

**Visibility:** Staff FIUU tabs are hidden unless `VITE_FIUU_PAYMENT_UI_ENABLED=true` in frontend env (see `frontend/src/utils/fiuuPayment.js`). Public `/pay/fiuu/:token` and API `/go` links still work for links already sent.

## Auto-debit (installment) — client decides

Staff does **not** configure auto-debit in CMS. For installment invoices / installment Package AR:

1. Staff sends the payment link (or opens the pay page).
2. On `/go`, **LCA AutoPay** toggle defaults **OFF**.
3. Turning the toggle **ON** opens a **Terms modal** (LCA AutoPay Recurring Payment T&C summary) explaining authorization, 5th-of-month billing, failed payments, cancellation, and privacy; Agree enables it, Cancel keeps it off.
4. Continue to payment → FIUU. If enabled, Card (CREDIT) is used so FIUU can tokenize.
5. **AutoPay ON:** after Terms, parent verifies via **SMS** (enter mobile → OTP) or **email** (enter email → click link in message), then continues to FIUU.

## Public pay page

| Path | Purpose |
|------|---------|
| `GET /payments/fiuu/go/:token` | Client auto-debit choice (if installment) then FIUU |
| `POST /payments/fiuu/go/:token/consent` | Client accept/decline |

Paid links always show already paid.

## Related

- `frontend/src/utils/fiuuPayment.js`
- `backend/services/fiuu/README.md`
