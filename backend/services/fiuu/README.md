# FIUU payment gateway integration

Backend module connecting PSMS invoice and acknowledgement-receipt payments to [FIUU](https://portal.fiuu.com) (Razer Merchant Services).

## Scope (v1)

- **Admin / Superadmin** invoice **full balance** payments via FIUU **QRPH** (GCash-compatible scan). Frontend tab: `FIUU_PAYMENT_UI_ENABLED` in `frontend/src/utils/fiuuPayment.js`.
- **Admin / Superadmin** Merchandise / Package **Acknowledgement Receipt Create → Step 2** via the same Manual | Pay via FIUU tabs (`POST /payments/fiuu/create-ar`). Event AR is out of scope.
- Auto-creates `paymenttbl` / verifies AR when FIUU webhook confirms success.
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
| Acknowledgement receipt | `PSMS-AR-{ack_receipt_id}-{attempt}` |

Description: `PSMS CMS | {type} | {Student} | {Branch} | {Ref} | PHP {amount}`

## API (authenticated)

| Method | Path | Role |
|---|---|---|
| GET | `/api/sms/payments/fiuu/config` | Admin, Superadmin |
| POST | `/api/sms/payments/fiuu/create` | Admin, Superadmin |
| POST | `/api/sms/payments/fiuu/create-ar` | Admin, Superadmin |
| GET | `/api/sms/payments/fiuu/status/:orderid` | Admin, Superadmin |

### Create AR (`create-ar`)

Body mirrors Merchandise/Package AR create fields (`ar_type`, student/guardian, phone, branch, merchandise_items or package_id, tip, discount, issue_date, installment_option).

Flow:

1. Insert AR as **Unverified** with `payment_method = FIUU Online` (no attachment).
2. Insert `gateway_paymentstbl` with `target_type = ack_receipt`.
3. Return hosted pay URL + form fields (same shape as invoice create).
4. On FIUU success webhook: set AR **Verified**, `reference_number = tranID`; Merchandise also creates invoice + payment + stock release (same side effects as cash merch AR).

`downpayment_plus_phase1` package option is rejected for FIUU (use downpayment only or manual).

## Webhooks (no Firebase auth)

| Method | Path | Purpose |
|---|---|---|
| GET / HEAD | `/api/webhooks/fiuu/notify` | FIUU portal **Check** / health |
| POST | `/api/webhooks/fiuu/notify` | Payment IPN (ACK + `treq=1`) |
| GET / HEAD | `/api/webhooks/fiuu/callback` | FIUU portal **Check** / health |
| POST | `/api/webhooks/fiuu/callback` | Deferred status (ACK `CBTOKEN:MPSTATOK`) |
| GET / HEAD | `/api/webhooks/fiuu/return` | FIUU portal **Check** / health |
| POST | `/api/webhooks/fiuu/return` | Browser return → redirect to CMS |

Webhooks verify FIUU `skey` using `FIUU_SECRET_KEY` for real CMS order IDs (`PSMS-I-…`, `PSMS-AR-…`).

FIUU **Check** may POST dummy orderids (`DEMO894`, etc.) or GET the URL. Those pings return **200** and do not create payments.

## Files

- `config.js` — env + pay URL
- `orderId.js` — order id / description builders
- `signature.js` — vcode + skey
- `gatewayPaymentRepository.js` — `gateway_paymentstbl` CRUD
- `applyGatewayInvoicePayment.js` — mark invoice paid after success
- `createFiuuArPayment.js` — pending Merchandise/Package AR + gateway row
- `applyGatewayArPayment.js` — verify AR (+ merch invoice/stock) after success
- `fiuuPaymentService.js` — create + webhook orchestration
- `../routes/fiuuPayments.js` — HTTP routes

## Next phases

- Installment plan payments (`PSMS-INS-*`)
- Event AR FIUU
- Student self-pay portal
