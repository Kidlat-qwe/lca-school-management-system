# FIUU payment gateway integration

Backend module connecting PSMS invoice and acknowledgement-receipt payments to [FIUU](https://portal.fiuu.com) (Razer Merchant Services).

## Scope (v1)

- **Admin / Superadmin** invoice **full balance** via FIUU **QRPH**.
- **Admin / Superadmin** Merchandise / Package **AR Create → Step 2** (`POST /payments/fiuu/create-ar`).
- **Primary UX:** email a **Pay now** link that opens FIUU (API `/payments/fiuu/go/:token` auto-POSTs). Invoice stays **Unpaid** / AR stays **Unverified** until the FIUU webhook confirms success.
- On successful **full payment** webhook: auto-enroll student into class phases from invoice `CLASS_ID` / `PHASE_*` remarks (same as manual Record Payment). Installment profiles use the existing installment enrollment paths.
- **Optional:** staff can still **Open FIUU now** at the counter.
- Manual Cash / E-wallet recording unchanged.

## Setup

1. Run migration `136_create_gateway_paymentstbl.sql`.
2. Add env vars to backend `.env` (see `.env.example`).
3. Ensure `FIUU_NOTIFY_URL` is set (used to derive the public API base for email pay links), or set `PUBLIC_API_BASE_URL=https://api-cms.lca-app.com/api/sms`.
4. Register webhook URLs in FIUU Merchant Portal → Transactions → Settings:
   - Notify: `https://<api-host>/api/webhooks/fiuu/notify`
   - Callback: `https://<api-host>/api/webhooks/fiuu/callback`
   - Return: `https://<api-host>/api/webhooks/fiuu/return`
5. Enable **IPN** in FIUU portal.
6. Email (Brevo or SMTP) must be configured to send payment links.

Sandbox / demo testing: see `docs/FIUU_SANDBOX_ACCESS_GUIDE.md`.

## Order ID standard

| Type | Pattern |
|---|---|
| Invoice | `PSMS-I-{invoice_id}-{attempt}` |
| Acknowledgement receipt | `PSMS-AR-{ack_receipt_id}-{attempt}` |

## API (authenticated)

| Method | Path | Role |
|---|---|---|
| GET | `/api/sms/payments/fiuu/config` | Admin, Superadmin |
| POST | `/api/sms/payments/fiuu/create` | Admin, Superadmin |
| POST | `/api/sms/payments/fiuu/create-ar` | Admin, Superadmin |
| POST | `/api/sms/payments/fiuu/preview-email` | Admin, Superadmin |
| GET | `/api/sms/payments/fiuu/status/:orderid` | Admin, Superadmin |

Create / preview body extras:

- `send_email`, `recipient_email`
- `tip_amount`, `discount_amount` — invoice create: charge = (remaining − discount) + tip; webhook writes same to `paymenttbl`
- `pay_link_expires_on` (YYYY-MM-DD) — optional Advanced settings expiry; blank → email shows **N/A** and link does not auto-expire

Paid links are **always** disabled after FIUU webhook success (`/go/:token` shows already paid).
Any email pay link for an invoice that is already **Paid** (or AR no longer Unverified) is also blocked — including older pending tokens after manual payment.

## Advanced settings (staff UI)

Collapsible on `FiuuPayOnlinePanel`:

1. **Expiry Date** — when set, stored as `metadata.pay_link_expires_at` and shown in the email; when blank, email shows **N/A**
2. **Preview** — `POST /preview-email` returns HTML (no send, no gateway row)

Invoice **Pay via FIUU** also has Tip / Discount payment adjustments (same semantics as manual Record Payment). AR tip/discount remain on the create form above the FIUU panel.

## API (public, no Firebase)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/sms/payments/fiuu/go/:token` | **Email Pay now** — branded LCA page (CSP allows `img-src https:` for logo); auto-POSTs to FIUU when payable; paid/expired show school logo + status |
| GET | `/api/sms/payments/fiuu/public/:token` | JSON payload (optional CMS landing / diagnostics) |

`server.js` mounts `/payments/fiuu` **before** `/payments` so public `go`/`public` are not blocked by payments Firebase auth.

Optional CMS route `/pay/fiuu/:token` remains for diagnostics; **emails use the API `/go/:token` URL**.

## Webhooks (no Firebase auth)

Same as before: `/api/webhooks/fiuu/notify|callback|return`.

## Files

- `payLink.js` — token + public pay URL helpers
- `sendFiuuPaymentLinkEmail.js` — guardian payment-link email (branch header + payment summary + Pay button; invoice & AR)
- `createFiuuArPayment.js` / `applyGatewayArPayment.js` — AR create + verify
- `applyGatewayInvoicePayment.js` — invoice paid after success
- `fiuuPaymentService.js` — orchestration
- `../routes/fiuuPayments.js` — HTTP routes

## Next phases

- Installment plan payments (`PSMS-INS-*`)
- Event AR FIUU
- Richer student self-pay portal (history, multi-invoice)
