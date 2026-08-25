# FIUU payment gateway integration

Backend module connecting PSMS invoice and acknowledgement-receipt payments to [FIUU](https://portal.fiuu.com) (Razer Merchant Services).

## Scope (v1 + auto-debit consent)

- **Admin / Superadmin** invoice balance via FIUU **QRPH** / Card (HPP).
- **Admin / Superadmin** Merchandise / Package **AR Create → Step 2**.
- **Primary UX:** email **Pay now** → `/payments/fiuu/go/:token` → FIUU. Bill stays unpaid until webhook.
- **Installment auto-debit / save card:** on **FIUU Card page only** (not CMS `/go` T&Cs).
  - Installment create uses `CREDIT` + `token_status=0` (FIUU save-card toggle off by default).
  - Token in webhook `extraP` → store token + activate class-scoped consent.
  - MIT auto-charge later still needs FIUU Recurring API.

## Setup

1. Run migrations `136_create_gateway_paymentstbl.sql`, `142_create_fiuu_payment_tokenstbl.sql`, `143_create_fiuu_autodebit_consentstbl.sql`.
2. Env vars — see `.env.example` (`FIUU_*`, `EMAIL_LOGO_URL`, etc.).
3. Webhooks: notify / callback / return as before.
4. Enable **Tokenization** on the MID; Recurring/MIT later for auto-charge.

## Order ID / CustID

| Type | Pattern |
|---|---|
| Invoice | `PSMS-I-{invoice_id}-{attempt}` |
| AR | `PSMS-AR-{ack_receipt_id}-{attempt}` |
| CustID | `PSMS-S-{student_id}` |

## Auto-debit rules

| Rule | Detail |
|---|---|
| Optional | FIUU Card save-card toggle (`token_status=0` = off by default) |
| Scope | One installment profile / class |
| Opt-in signal | Token returned from FIUU after Card pay |
| Paid link | `/go` shows already paid (no re-charge) |
| Channel | Installment uses `CREDIT` (Card only) |

## API (authenticated)

| Method | Path | Role |
|---|---|---|
| GET | `/payments/fiuu/config` | Admin, Superadmin (+ `autodebitTerms`) |
| GET | `/payments/fiuu/autodebit-context/:invoiceId` | Admin, Superadmin |
| POST | `/payments/fiuu/create` | + `autodebit_opt_in`, terms flags |
| POST | `/payments/fiuu/create-ar` | same |
| GET | `/payments/fiuu/tokens/:studentId` | Admin, Superadmin |
| GET | `/payments/fiuu/autodebit-consents/:studentId` | Admin, Superadmin |
| POST | `/payments/fiuu/autodebit-consents/:consentId/disable` | Admin, Superadmin |
| GET | `/payments/fiuu/status/:orderid` | Admin, Superadmin |

## API (public)

| Method | Path | Purpose |
|---|---|---|
| GET | `/payments/fiuu/go/:token` | Consent gate (if offered) then auto-POST |
| POST | `/payments/fiuu/go/:token/consent` | Parent accept/decline → redirect to `/go` |
| GET | `/payments/fiuu/public/:token` | JSON diagnostics |

## Files

- `fiuuAutodebitConsent.js` — terms, resolve context, upsert/disable consent
- `fiuuTokenService.js` — token store + bind to consent
- `fiuuPaymentService.js` / `createFiuuArPayment.js` / `payLink.js`
- `../migrations/143_create_fiuu_autodebit_consentstbl.sql`

## Next (MIT)

- Charge saved token when installment invoice is generated for an **active** consent on that profile only.
- Needs FIUU Recurring/MIT API sample + docs.
