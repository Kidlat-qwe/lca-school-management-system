# FIUU payment gateway integration

Backend module connecting PSMS invoice and acknowledgement-receipt payments to [FIUU](https://portal.fiuu.com) (Razer Merchant Services).

## Scope

- **Admin / Superadmin** invoice balance via FIUU **QRPH** / Card (HPP).
- **Admin / Superadmin** Merchandise / Package **AR Create → Step 2**.
- **Primary UX:** email **Pay now** → `/payments/fiuu/go/:token` → FIUU. Bill stays unpaid until webhook.
- **Installment AutoPay (LCA AutoPay):**
  - Client opts in on `/go` (Terms modal; toggle defaults OFF).
  - **SMS or email OTP** verifies authorization before AutoPay is enabled (`FIUU_AUTOPAY_OTP_ENABLED`, default on).
    - SMS: parent **enters mobile** → OTP → enter code on `/go`.
    - Email: parent **enters email** → **click Verify** in email (no code on page).
  - Consent + token bound to **one** installment profile / class.
  - When `FIUU_AUTOPAY_MIT_ENABLED=true`, the installment invoice scheduler charges the saved token via FIUU Recurring API (MIT) after generating each due invoice for that profile.
  - MIT failure → CMS emails a normal Pay now link as fallback.

## Setup

1. Run migrations `136_create_gateway_paymentstbl.sql`, `142_create_fiuu_payment_tokenstbl.sql`, `143_create_fiuu_autodebit_consentstbl.sql`.
2. Env vars — see `.env.example` (`FIUU_*`, `EMAIL_LOGO_URL`, etc.).
3. Webhooks: notify / callback / return as before (MIT results use the same CallbackURL).
4. Enable **Tokenization** + **Recurring** on the MID (FIUU support).
5. Set `FIUU_AUTOPAY_MIT_ENABLED=true` only after Dev UAT of token save + MIT charge.

## Order ID / CustID

| Type | Pattern |
|---|---|
| Invoice (HPP + MIT) | `PSMS-I-{invoice_id}-{attempt}` |
| AR | `PSMS-AR-{ack_receipt_id}-{attempt}` |
| CustID | `PSMS-S-{student_id}` |

## AutoPay / MIT rules

| Rule | Detail |
|---|---|
| Feature flag | `FIUU_AUTOPAY_MIT_ENABLED` (default `false`) |
| Optional | Default is pay-this-invoice-only |
| Scope | One installment profile / class |
| Dual consent | Client accepts Terms on pay link |
| Channel | Opt-in prefers `CREDIT` for tokenization |
| Charge trigger | After `processDueInstallmentInvoices` / catch-up generate |
| API | Recurring v7 RecordType `T` → `FIUU_RECURRING_URL` |
| Checksum | `md5(RecordType+MerchantID+SubMerchant+Token+OrderID+Currency+Amount+Verifykey)` |
| Result | Async notify/callback → existing invoice apply path |
| Failure | Create + email HPP pay link |

## Env (MIT)

| Variable | Purpose |
|---|---|
| `FIUU_AUTOPAY_MIT_ENABLED` | `true` to charge on invoice generation |
| `FIUU_AUTOPAY_OTP_ENABLED` | `false` to skip SMS/email OTP on AutoPay enrollment (default on) |
| `FIUU_RECURRING_URL` | Optional override of Recurring `input_v7.php` |
| `FIUU_SUB_MERCHANT_ID` | Optional; usually empty |
| `FIUU_SANDBOX` | Selects sandbox recurring URL when override unset |

## API (authenticated)

| Method | Path | Role |
|---|---|---|
| GET | `/payments/fiuu/config` | Admin, Superadmin (+ `autodebitTerms`) |
| GET | `/payments/fiuu/autodebit-context/:invoiceId` | Admin, Superadmin |
| POST | `/payments/fiuu/create` | Invoice HPP |
| POST | `/payments/fiuu/create-ar` | AR HPP |
| GET | `/payments/fiuu/tokens/:studentId` | Admin, Superadmin |
| GET | `/payments/fiuu/autodebit-consents/:studentId` | Admin, Superadmin |
| POST | `/payments/fiuu/autodebit-consents/:consentId/disable` | Admin, Superadmin |
| GET | `/payments/fiuu/status/:orderid` | Admin, Superadmin |

## API (public)

| Method | Path | Purpose |
|---|---|---|
| GET | `/payments/fiuu/go/:token` | Consent gate (if offered) then auto-POST |
| POST | `/payments/fiuu/go/:token/consent` | Parent accept/decline → redirect to `/go` |
| POST | `/payments/fiuu/go/:token/autopay-otp` | Start AutoPay SMS/email verification |
| GET | `/payments/fiuu/go/:token/autopay-otp` | Verification page |
| POST | `/payments/fiuu/go/:token/autopay-otp/send` | Send SMS OTP (`mobile`) or email link (`email`) |
| POST | `/payments/fiuu/go/:token/autopay-otp/verify` | Verify SMS code → enable AutoPay → `/go` |
| GET | `/payments/fiuu/go/:token/autopay-otp/confirm-email` | Email link click → enable AutoPay → `/go` |
| POST | `/payments/fiuu/go/:token/autopay-otp/cancel` | Cancel AutoPay → pay invoice only |
| GET | `/payments/fiuu/public/:token` | JSON diagnostics |

## Files

- `fiuuAutopayOtpService.js` — SMS/email OTP before AutoPay enrollment on `/go`
- `fiuuAutodebitConsent.js` — terms, resolve context, upsert/disable consent
- `fiuuTokenService.js` — token store + bind to consent
- `fiuuRecurringCharge.js` — MIT charge after installment invoice generation
- `fiuuPaymentService.js` / `createFiuuArPayment.js` / `payLink.js`
- `../migrations/143_create_fiuu_autodebit_consentstbl.sql`

## Dev UAT checklist (MIT)

1. Parent pays installment via `/go` with AutoPay ON + Card save → token in `fiuu_payment_tokenstbl`, consent `active`.
2. Set `FIUU_AUTOPAY_MIT_ENABLED=true` and redeploy backend.
3. Advance/generate next installment invoice (scheduler or admin trigger).
4. Expect `gateway_paymentstbl` row with `metadata.mit=true`, Recurring API `accepted`, then webhook marks invoice Paid.
5. If Recurring rejects / no token → Pay now email fallback.
