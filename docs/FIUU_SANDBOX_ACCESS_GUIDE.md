# FIUU Sandbox Access Guide

Physical School Management System (PSMS) — CMS payment integration

| Field | Value |
| --- | --- |
| Document title | FIUU Sandbox Access Guide |
| System | Physical School Management System (PSMS / CMS) |
| Audience | Operations, Admin, Developers |
| Date | 13 August 2026 |
| Related merchant | LITTLE CHAMPIONS ACADEMY INC. |
| Production Merchant ID | littlechampion1 |
| Production portal | https://portal.fiuu.com |
| Sandbox portal (typical) | https://sandbox.merchant.razer.com/ |

How to open this file in Microsoft Word

1. Open Microsoft Word.
2. Choose File, then Open.
3. Select this Markdown file, or open `FIUU_SANDBOX_ACCESS_GUIDE.html` (recommended for Word).
4. Choose File, then Save As, then Word Document (*.docx).

If Word does not open `.md` directly, open the `.html` companion file first, then Save As `.docx`.

---

## 1. Purpose

This guide explains how to get **FIUU sandbox / demo** access so CMS can test **Pay via FIUU (QRPH)** without charging real money.

Current FIUU portal setup uses the **Coolify development** site, not Linode production. Do **not** remove that portal setup. Sandbox is a **separate** FIUU test account.

---

## 2. CMS environments (important)

| Environment | Host | Deployed from | Role |
| --- | --- | --- | --- |
| Development | `cms.lca-app.com` (frontend), `api-cms.lca-app.com` (API) | Coolify | Current FIUU webhook testing |
| Production | `cms.little-champion.com` (frontend + API) | Linode | Live school CMS — not the URLs currently in FIUU |

Coolify `*.lca-app.com` is **not** production. Linode `cms.little-champion.com` is production.

### Development webhook URLs (Coolify) — currently registered in FIUU portal

- Notify: https://api-cms.lca-app.com/api/webhooks/fiuu/notify
- Callback: https://api-cms.lca-app.com/api/webhooks/fiuu/callback
- Return: https://api-cms.lca-app.com/api/webhooks/fiuu/return
- Frontend return: https://cms.lca-app.com

### Production webhook URLs (Linode) — register later before go-live

Prefer `/api/sms/webhooks/fiuu/` on Linode (nginx typically proxies `/api/sms` to the Node API):

- Notify: https://cms.little-champion.com/api/sms/webhooks/fiuu/notify
- Callback: https://cms.little-champion.com/api/sms/webhooks/fiuu/callback
- Return: https://cms.little-champion.com/api/sms/webhooks/fiuu/return
- Frontend return: https://cms.little-champion.com

Also register domain `cms.little-champion.com` in FIUU portal before live payments.

---

## 3. Do not remove current FIUU portal setup

Keep everything already configured on https://portal.fiuu.com :

- Domain registration for `api-cms.lca-app.com` (Return, Notify, Callback, Cancel)
- Return URL, Notification URL, Callback URL (Coolify development)
- Instant Payment Notification (IPN) enabled on Notify and Callback
- Enable Verify Payment = ON
- Use extended format for Verify Payment = OFF
- Production Verify Key and Secret Key

Those settings support **Coolify development** testing now. Later, add Linode production URLs and domain. Do not delete the Coolify entries until Linode FIUU URLs are verified.

---

## 4. FIUU sandbox versus live keys

| Item | FIUU live merchant (portal.fiuu.com) | FIUU sandbox / demo |
| --- | --- | --- |
| Portal | https://portal.fiuu.com | https://sandbox.merchant.razer.com/ (or URL FIUU emails) |
| Merchant ID | littlechampion1 | Separate sandbox or `_Dev` Merchant ID |
| Keys | Production Verify Key and Secret Key | Sandbox Verify Key and Secret Key |
| Payment page | https://pay.fiuu.com | https://sandbox-payment.fiuu.com |
| CMS setting | FIUU_SANDBOX=false | FIUU_SANDBOX=true |
| Money | Real charge | Demo / dummy (no live GCash charge) |
| Extra requirement | Domain + IPN | IP whitelist in sandbox portal |

Important

- `FIUU_SANDBOX=true` only changes the payment URL.
- It does **not** turn Merchant ID `littlechampion1` into demo.
- Opening https://sandbox-payment.fiuu.com in a browser shows no login UI. That host is a payment API, not a portal.

---

## 5. What “sandbox access” means

FIUU must issue a **sandbox / developer account**. Typical details:

- Sandbox merchant portal login (often https://sandbox.merchant.razer.com/ )
- Sandbox Merchant ID (often ends with `_Dev`)
- Login email and password
- Sandbox Verify Key and Secret Key
- Demo bank or test channels (QRPH if available)
- Ability to whitelist office or server IP for demo bank

You cannot self-register production `littlechampion1` on the sandbox portal.

Reference: FIUU cheatsheet Tips #10 (sandbox IP whitelist / demo bank)  
https://github.com/FiuuPayment/Cheatsheet-BestPractices-Fiuu_API/blob/main/README.md

---

## 6. Step-by-step process

### Step 1 — Email FIUU Support

Send email to: support@fiuu.com

Subject: Sandbox / developer account request – Merchant ID littlechampion1

Copy the message body below. It correctly labels Coolify as development, not production.

```
Hello FIUU Support,

Merchant ID: littlechampion1
Company: LITTLE CHAMPIONS ACADEMY INC.
Contact: Carla Gabriel (carla@rhet-corp.com)

We need a sandbox / developer (_Dev) account to test Hosted Payment Page + QRPH without live charges.

Please note our CMS hosts:

1) Development (Coolify) — currently configured in FIUU portal for webhook testing:
- https://api-cms.lca-app.com/api/webhooks/fiuu/notify
- https://api-cms.lca-app.com/api/webhooks/fiuu/callback
- https://api-cms.lca-app.com/api/webhooks/fiuu/return
Frontend: https://cms.lca-app.com

2) Production (Linode) — live school CMS, not yet used for FIUU webhooks:
- https://cms.little-champion.com/api/sms/webhooks/fiuu/notify
- https://cms.little-champion.com/api/sms/webhooks/fiuu/callback
- https://cms.little-champion.com/api/sms/webhooks/fiuu/return
Frontend: https://cms.little-champion.com

We have completed portal setup (domain, Return/Notify/Callback URLs, IPN) for the Coolify DEVELOPMENT API host api-cms.lca-app.com. That is not our Linode production site.

Please provide:
1. Sandbox merchant portal login URL (for example https://sandbox.merchant.razer.com/)
2. Sandbox Merchant ID
3. Sandbox login email and password (or reset instructions)
4. Sandbox Verify Key and Secret Key
5. QRPH (or demo channels) enabled on sandbox
6. IP whitelist instructions for demo bank testing

Thank you.
```

---

### Step 2 — Wait for FIUU reply

FIUU should send:

- Sandbox portal URL
- Sandbox or `_Dev` Merchant ID
- Login credentials
- Or instructions to view keys after login

If they send a portal link but no keys: log in, then open Home or Transactions > Settings > Integration, and reveal Verify Key and Secret Key.

---

### Step 3 — Log in to the sandbox portal

1. Open the URL FIUU provided, or try https://sandbox.merchant.razer.com/
2. Sign in with sandbox Merchant ID, email, and password.
3. Confirm this is **not** https://portal.fiuu.com (that site is the live merchant portal).

---

### Step 4 — Configure sandbox portal only (Coolify development URLs)

Do this in the **sandbox** portal. Do not remove Coolify URLs from https://portal.fiuu.com .

A. Merchant Profile > Profile Settings

1. Register domain `api-cms.lca-app.com` if sandbox requires it.
2. Whitelist your public IP (office PC, and optionally the Coolify/server IP). This is required for demo bank testing.

To find your public IP, open https://api.ipify.org from the same computer that will open the payment page.

B. Transactions > Settings > Integration

Set these **development** URLs:

- Return: `https://api-cms.lca-app.com/api/webhooks/fiuu/return`
- Notification: `https://api-cms.lca-app.com/api/webhooks/fiuu/notify`
- Callback: `https://api-cms.lca-app.com/api/webhooks/fiuu/callback`

Then:

1. Turn IPN ON for Notification URL.
2. Turn IPN ON for Callback URL.
3. Leave Return IPN OFF (optional for CMS).
4. Click Check on each URL. Expected result: Status 200.

---

### Step 5 — Point Coolify CMS backend to sandbox keys

Update Coolify **backend** environment variables (not frontend only), then redeploy the backend app.

```
FIUU_SANDBOX=true
FIUU_MERCHANT_ID=<sandbox or xxx_Dev>
FIUU_VERIFY_KEY=<sandbox verify key>
FIUU_SECRET_KEY=<sandbox secret key>
FIUU_CURRENCY=PHP
FIUU_DEFAULT_CHANNEL=QRPH
FIUU_NOTIFY_URL=https://api-cms.lca-app.com/api/webhooks/fiuu/notify
FIUU_CALLBACK_URL=https://api-cms.lca-app.com/api/webhooks/fiuu/callback
FIUU_RETURN_URL=https://api-cms.lca-app.com/api/webhooks/fiuu/return
FIUU_FRONTEND_RETURN_URL=https://cms.lca-app.com
```

Restart / redeploy the Coolify backend after saving.

---

### Step 6 — Test from Coolify CMS

Do not type https://sandbox-payment.fiuu.com in the browser address bar.

1. Log in to https://cms.lca-app.com as Admin or Superadmin.
2. Open an unpaid invoice.
3. Record Payment > Pay via FIUU > Open FIUU QR payment.
4. Complete demo / sandbox payment (demo bank credentials from FIUU, if shown).
5. Confirm sandbox portal Transactions shows the order (example: `PSMS-I-{invoice_id}-{attempt}`).
6. Confirm CMS invoice becomes Paid / Approved automatically.

---

### Step 7 — After demo passes (Linode production later)

Coolify stays development. For live school payments, configure **Linode**:

1. Register domain `cms.little-champion.com` in FIUU portal (Return / Notify / Callback types).
2. Set Linode backend `.env`:

```
FIUU_SANDBOX=false
FIUU_MERCHANT_ID=littlechampion1
FIUU_VERIFY_KEY=<production verify key>
FIUU_SECRET_KEY=<production secret key>
FIUU_NOTIFY_URL=https://cms.little-champion.com/api/sms/webhooks/fiuu/notify
FIUU_CALLBACK_URL=https://cms.little-champion.com/api/sms/webhooks/fiuu/callback
FIUU_RETURN_URL=https://cms.little-champion.com/api/sms/webhooks/fiuu/return
FIUU_FRONTEND_RETURN_URL=https://cms.little-champion.com
```

3. Confirm nginx on Linode forwards `/api/sms` (and if needed `/api/webhooks`) to the Node API.
4. Redeploy / restart Linode backend.
5. Click Check on the Linode webhook URLs in FIUU portal.
6. Run a small live test from https://cms.little-champion.com .

Do not point Coolify `lca-app.com` webhooks at Linode, or Linode webhooks at Coolify.

---

## 7. Until sandbox access arrives

| Option | Description | Real money? |
| --- | --- | --- |
| Wait for FIUU sandbox | True demo testing on Coolify | No |
| Temporary live test on Coolify | Set FIUU_SANDBOX=false, production keys, small invoice on cms.lca-app.com | Yes (test data / test invoice only) |

---

## 8. Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| HTTP 401 on sandbox-payment.fiuu.com | Production keys used with sandbox URL | Use sandbox / `_Dev` keys, or set FIUU_SANDBOX=false for live |
| Blank page or Not Found on sandbox-payment.fiuu.com | Opened payment API URL in browser | Use CMS Pay via FIUU button, or log in to sandbox **portal** |
| FIUU Check failed / Route not found | Backend not deployed, or GET-only check before health route | Redeploy Coolify backend; GET notify should return “FIUU webhook endpoint OK” |
| Check dummy order DEMO516 | FIUU URL Check ping | Normal; does not create a CMS payment |
| Demo bank still blocked after sandbox login | IP not whitelisted | Add office/public IP in sandbox Profile Settings |
| Linode pay works but webhook never hits CMS | nginx only proxies `/api/sms` | Use `/api/sms/webhooks/fiuu/...` URLs on Linode |

---

## 9. Webhook URL quick reference

Development (Coolify):

- Notify: https://api-cms.lca-app.com/api/webhooks/fiuu/notify
- Callback: https://api-cms.lca-app.com/api/webhooks/fiuu/callback
- Return: https://api-cms.lca-app.com/api/webhooks/fiuu/return

Production (Linode):

- Notify: https://cms.little-champion.com/api/sms/webhooks/fiuu/notify
- Callback: https://cms.little-champion.com/api/sms/webhooks/fiuu/callback
- Return: https://cms.little-champion.com/api/sms/webhooks/fiuu/return

---

## 10. References

- FIUU production portal: https://portal.fiuu.com
- FIUU sandbox portal (typical): https://sandbox.merchant.razer.com/
- FIUU cheatsheet (Tips #10 sandbox IP whitelist): https://github.com/FiuuPayment/Cheatsheet-BestPractices-Fiuu_API/blob/main/README.md
- FIUU sandbox account: https://docs.fiuu.dev/reference/simulation-sandbox-account
- FIUU developer / `_Dev` account: https://docs.fiuu.dev/reference/user-acceptance-test-developer-account
- PSMS FIUU module: `backend/services/fiuu/README.md`
- Coolify deploy: `docs/deployment/COOLIFY_DEPLOYMENT.md`

---

## 11. Document control

| Version | Date | Notes |
| --- | --- | --- |
| 1.0 | 13 August 2026 | Initial sandbox access process for PSMS CMS |
| 1.1 | 13 August 2026 | Coolify = development; Linode cms.little-champion.com = production |
