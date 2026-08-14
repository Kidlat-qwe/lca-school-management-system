# FIUU payment gateway integration

Backend module connecting PSMS invoice payments to [FIUU](https://portal.fiuu.com) (Razer Merchant Services).

## Scope (v1)

- **Admin / Superadmin** invoice **full balance** payments via FIUU **QRPH** (GCash-compatible scan). Frontend tab is hidden until `FIUU_PAYMENT_UI_ENABLED` is true in `frontend/src/utils/fiuuPayment.js`.
- Auto-creates `paymenttbl` row as **Approved** when FIUU webhook confirms success.
- Manual Cash / E-wallet recording unchanged.

## Setup

1. Run migration `136_create_gateway_paymentstbl.sql`.
2. Add env vars to backend `.env` (see `.env.example`).
3. Register webhook URLs in FIUU Merchant Portal → Transactions → Settings:
   - Notify: `https://<api-host>/api/webhooks/fiuu/notify`
   - Callback: `https://<api-host>/api/webhooks/fiuu/callback`
   - Return: `https://<api-host>/api/webhooks/fiuu/return`
4. Enable **IPN** in FIUU portal.

Sandbox / demo testing (separate `_Dev` account): see `docs/FIUU_SANDBOX_ACCESS_GUIDE.md` (Word: `docs/FIUU_SANDBOX_ACCESS_GUIDE.docx` or open `.html` then Save As `.docx`).

CMS hosts: Coolify `*.lca-app.com` = development; Linode `cms.little-champion.com` = production. FIUU webhook URLs currently in portal are Coolify development, not Linode.

## Order ID standard

| Type | Pattern |
|---|---|
| Invoice | `PSMS-I-{invoice_id}-{attempt}` |

Description: `PSMS CMS | Invoice | {Student} | {Branch} | {Ref} | PHP {amount}`

## API (authenticated)

| Method | Path | Role |
|---|---|---|
| GET | `/api/sms/payments/fiuu/config` | Admin, Superadmin |
| POST | `/api/sms/payments/fiuu/create` | Admin, Superadmin |
| GET | `/api/sms/payments/fiuu/status/:orderid` | Admin, Superadmin |

## Webhooks (no Firebase auth)

| Method | Path | Purpose |
|---|---|---|
| GET / HEAD | `/api/webhooks/fiuu/notify` | FIUU portal **Check** / health |
| POST | `/api/webhooks/fiuu/notify` | Payment IPN (ACK + `treq=1`) |
| GET / HEAD | `/api/webhooks/fiuu/callback` | FIUU portal **Check** / health |
| POST | `/api/webhooks/fiuu/callback` | Deferred status (ACK `CBTOKEN:MPSTATOK`) |
| GET / HEAD | `/api/webhooks/fiuu/return` | FIUU portal **Check** / health |
| POST | `/api/webhooks/fiuu/return` | Browser return → redirect to CMS |

Webhooks verify FIUU `skey` using `FIUU_SECRET_KEY` for real CMS order IDs (`PSMS-I-…`).

FIUU **Check** may POST dummy orderids (`DEMO894`, etc.) or GET the URL. Those pings return **200** and do not create payments.

## Files

- `config.js` — env + pay URL
- `orderId.js` — order id / description builders
- `signature.js` — vcode + skey
- `gatewayPaymentRepository.js` — `gateway_paymentstbl` CRUD
- `applyGatewayInvoicePayment.js` — mark invoice paid after success
- `fiuuPaymentService.js` — create + webhook orchestration
- `../routes/fiuuPayments.js` — HTTP routes

## Next phases

- Installment plan payments (`PSMS-INS-*`)
- AR downpayment (`PSMS-AR-*`)
- Student self-pay portal
