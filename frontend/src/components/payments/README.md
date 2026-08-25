# Payments UI Components

Shared UI for finance payment logs and related flows.

## Components

| File | Purpose |
|------|---------|
| `UnappliedArPaymentLogStatus.jsx` | Status column for unapplied package AR rows in Payment Logs. |
| `FiuuPayOnlinePanel.jsx` | FIUU tab for invoice Record Payment and AR Create Step 2. |

## Auto-debit (installment) — on FIUU Card page only

Staff does not configure auto-debit in CMS. For installment invoices / Package AR:

1. CMS sends pay link → `/go` briefly bridges to **FIUU Card** (`CREDIT` + `token_status=0`).
2. On FIUU’s card form, the client may toggle **“I consent to my payment details being securely stored…”** (defaults off via `token_status=0`).
3. If ON and pay succeeds, FIUU returns a token → CMS stores it and enables class-scoped consent.
4. QRPH / non-card channels do not offer this toggle.

## Related

- `frontend/src/utils/fiuuPayment.js`
- `backend/services/fiuu/README.md`
