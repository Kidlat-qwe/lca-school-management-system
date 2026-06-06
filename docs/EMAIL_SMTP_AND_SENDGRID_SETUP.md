# Email Setup Guide — SMTP & SendGrid (PSMS)

Step-by-step instructions for configuring outbound email in the **Physical School Management System (PSMS)** backend.

> **Read this first.** Do not guess values. Follow every step in order, restart the API after editing `.env`, and run the test command at the end.

---

## Table of contents

1. [Which method should I use?](#1-which-method-should-i-use)
2. [Where to put settings](#2-where-to-put-settings)
3. [SendGrid setup (recommended for production / Linode)](#3-sendgrid-setup-recommended-for-production--linode)
4. [SMTP setup (local dev or servers that allow SMTP ports)](#4-smtp-setup-local-dev-or-servers-that-allow-smtp-ports)
5. [Optional: EOD email recipients](#5-optional-eod-email-recipients)
6. [Test your configuration](#6-test-your-configuration)
7. [Troubleshooting](#7-troubleshooting)
8. [Security checklist](#8-security-checklist)
9. [Quick reference — all `.env` variables](#9-quick-reference--all-env-variables)

---

## 1. Which method should I use?

| Environment | Recommended method | Why |
|---|---|---|
| **Production server (Linode / VPS)** | **SendGrid** | Most VPS providers **block outbound SMTP ports 25, 465, and 587**. SendGrid uses **HTTPS (port 443)**, which is not blocked. |
| **Local development (your laptop)** | **SMTP** (Gmail App Password or hosting email) | Easier to set up; SMTP works from home/office networks. |
| **Production with unblocked SMTP** | SMTP (SpaceMail / cPanel / custom domain) | Only if port check passes (see [Test your configuration](#6-test-your-configuration)). |

**Rule of thumb**

- Linode / cloud VPS → **SendGrid**
- Your PC → **SMTP** (Gmail or `mail.yourdomain.com`)

The backend supports **both**. You configure one (or both) in `backend/.env`. With default `EMAIL_PROVIDER=auto`, **SendGrid wins if `SENDGRID_API_KEY` is set**; otherwise SMTP is used.

---

## 2. Where to put settings

All email settings go in:

```
backend/.env
```

**After any change to `.env`:**

1. Save the file.
2. **Restart the backend API** (stop the process, start it again).
3. Run the test command in [Section 6](#6-test-your-configuration).

**Never:**

- Commit `.env` to Git.
- Paste API keys or passwords in Slack/email without a secure channel.
- Share screenshots of `.env` in group chats.

---

## 3. SendGrid setup (recommended for production / Linode)

### Step 3.1 — Create a SendGrid account

1. Go to [https://sendgrid.com](https://sendgrid.com).
2. Sign up (free tier is enough to start).
3. Complete email verification SendGrid sends you.
4. Complete any account setup wizard (company name, etc.).

### Step 3.2 — Verify your sender address

SendGrid will **reject** mail if the **From** address is not verified.

**Option A — Single Sender Verification (fastest, good for testing)**

1. In SendGrid: **Settings → Sender Authentication → Single Sender Verification**.
2. Click **Create New Sender**.
3. Fill in:
   - **From Name:** `Little Champions Academy` (or your school name)
   - **From Email Address:** the address you want emails to come from (e.g. `lca@little-champion.com` or `noreply@yourdomain.com`)
   - Reply-to, address, etc. as required
4. Submit and **open the verification email** SendGrid sends to that address.
5. Click the verify link. Status must show **Verified**.

**Option B — Domain Authentication (best for production)**

1. **Settings → Sender Authentication → Authenticate Your Domain**.
2. Choose your DNS host and follow SendGrid’s DNS record instructions (CNAME records for DKIM).
3. Wait until SendGrid shows the domain as **Verified**.
4. You can then send from any address `@yourdomain.com` (e.g. `noreply@yourdomain.com`).

> Use **Option B** on production if you control DNS. It improves deliverability and reduces spam folder issues.

### Step 3.3 — Create an API key

1. **Settings → API Keys → Create API Key**.
2. Name: e.g. `PSMS Production`.
3. Permissions: **Restricted Access** → enable **Mail Send** → **Full Access** (or at minimum Mail Send).
4. Click **Create & View**.
5. **Copy the key immediately.** It starts with `SG.` and is shown **only once**.

### Step 3.4 — Add variables to `backend/.env`

Open `backend/.env` on the **server** (Linode), not only on your laptop.

Add or update:

```env
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=SG.paste_your_full_api_key_here
SENDGRID_FROM_EMAIL=lca@little-champion.com
```

Replace:

- `SG.paste_your_full_api_key_here` → your real API key from Step 3.3.
- `lca@little-champion.com` → the **exact verified** sender from Step 3.2.

**Optional:** If you also have SMTP variables in `.env` for local use, `EMAIL_PROVIDER=sendgrid` forces SendGrid on the server so SMTP is ignored.

### Step 3.5 — Restart the API

Restart the Node backend so it reloads `.env`.

On startup you should see SendGrid-related success in logs when email is verified (see Section 6).

### Step 3.6 — Confirm it works

From the `backend/` folder:

```bash
node scripts/diagnoseEodEmail.js --send-test your.email@example.com
```

Check that inbox (and spam). You should receive: **"[PSMS] EOD email test"**.

---

## 4. SMTP setup (local dev or servers that allow SMTP ports)

Use SMTP when you are **not** on a VPS that blocks mail ports, or for **local development**.

Required variables:

```env
SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```

Optional:

```env
EMAIL_PROVIDER=smtp
SMTP_TLS_REJECT_UNAUTHORIZED=false
```

Only set `SMTP_TLS_REJECT_UNAUTHORIZED=false` if your host uses a self-signed certificate (rare; last resort).

---

### Option A — Gmail (common for local dev)

#### Step 4A.1 — Enable 2-Step Verification

1. [Google Account → Security](https://myaccount.google.com/security)
2. Turn on **2-Step Verification** and complete setup.

#### Step 4A.2 — Create an App Password

1. Still under **Security**, open **App passwords** (visible only after 2FA is on).
2. App: **Mail**, Device: **Other** → name it `PSMS Local`.
3. Click **Generate**.
4. Copy the 16-character password (remove spaces when pasting into `.env`).

#### Step 4A.3 — Configure `backend/.env`

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your.email@gmail.com
SMTP_PASSWORD=your16charapppassword
SMTP_FROM=your.email@gmail.com
```

**Important:** Use the **App Password**, not your normal Gmail password. `SMTP_FROM` must match `SMTP_USER`.

---

### Option B — Outlook / Microsoft 365

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your.email@outlook.com
SMTP_PASSWORD=your_password_or_app_password
SMTP_FROM=your.email@outlook.com
```

For work/school Microsoft accounts, your IT admin may require an app password or SMTP AUTH to be enabled.

---

### Option C — Hosting email (SpaceMail, cPanel, Plesk, etc.)

1. Log in to your hosting control panel.
2. Open **Email Accounts** → **Connect Devices** / **Email Client Configuration**.
3. Note:
   - **Outgoing server (SMTP host)** — often `mail.yourdomain.com`
   - **Port** — usually `587` (TLS) or `465` (SSL)
   - **Username** — full email address
   - **Password** — mailbox password

**Port 587 (TLS — try this first):**

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=mail.yourdomain.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@yourdomain.com
SMTP_PASSWORD=your_mailbox_password
SMTP_FROM=noreply@yourdomain.com
```

**Port 465 (SSL):**

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=mail.yourdomain.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=noreply@yourdomain.com
SMTP_PASSWORD=your_mailbox_password
SMTP_FROM=noreply@yourdomain.com
```

### Step 4D — Restart and test

1. Save `backend/.env`.
2. Restart the backend.
3. Run:

```bash
node scripts/diagnoseEodEmail.js --send-test your.email@example.com
```

If you see **BLOCKED** for ports 465 and 587 on the server, **stop using SMTP on that server** and switch to [SendGrid (Section 3)](#3-sendgrid-setup-recommended-for-production--linode).

---

## 5. Optional: EOD email recipients

End-of-day (EOD) summary emails go to:

1. **Superadmin** users with an email in **Personnel** (`userstbl.email`), and/or
2. Extra addresses in `.env`:

```env
EOD_STAKEHOLDER_EMAILS=owner@example.com,finance@example.com
```

Comma-separated, no spaces required (spaces are trimmed).

Also ensure in the app: **Superadmin → Settings → Templates** → **EOD summary template** is **enabled**.

---

## 6. Test your configuration

All commands run from the **`backend/`** directory.

### 6.1 — Full diagnostic (no email sent)

```bash
node scripts/diagnoseEodEmail.js
```

This prints:

- Active provider (`sendgrid` or `smtp`)
- SMTP port reachability (OPEN vs BLOCKED)
- Superadmin recipient list
- Whether the EOD template is enabled

### 6.2 — Send a test email

```bash
node scripts/diagnoseEodEmail.js --send-test you@example.com
```

Replace `you@example.com` with your real inbox.

### 6.3 — What success looks like

**SendGrid:**

```
✅ SendGrid API key is valid (HTTPS — works when SMTP ports are blocked)
✅ Email transport verify OK
✅ Test email sent
```

**SMTP:**

```
✅ SMTP server is ready to send emails
✅ Email transport verify OK
✅ Test email sent
```

### 6.4 — What the system sends email for

Once configured, the backend can send:

- Payment / invoice confirmation (with PDF)
- Overdue payment reminders
- Monthly installment invoice notices
- Class suspension notices
- End-of-day (EOD) sales summaries
- Other system notifications (cash deposit, etc.)

Templates can be toggled under **Superadmin → Settings → Templates**.

---

## 7. Troubleshooting

### "Email is not configured"

**Cause:** Missing or incomplete `.env` values.

**Fix:**

- **SendGrid:** Set `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL`.
- **SMTP:** Set `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASSWORD`.
- Restart the API after saving.

---

### "Connection timeout" / SMTP ports BLOCKED

**Cause:** VPS provider (common on Linode) blocks outbound SMTP.

**Fix:** Use SendGrid ([Section 3](#3-sendgrid-setup-recommended-for-production--linode)). Do not keep retrying SMTP on that server.

---

### SendGrid API 403 / 401

**Causes & fixes:**

| Error | Fix |
|---|---|
| Invalid API key | Create a new key; paste full `SG....` value with no extra spaces |
| Key missing Mail Send permission | Recreate key with **Mail Send** access |
| From address not verified | Complete Single Sender or Domain Authentication in SendGrid |

---

### "Invalid login credentials" (SMTP)

**Fix:**

- Gmail: use **App Password**, not normal password; confirm 2FA is on.
- Hosting: use full email as username; confirm mailbox password in webmail.
- Remove spaces from passwords in `.env`.

---

### Emails go to spam

**Fix:**

- Prefer SendGrid **Domain Authentication** (DKIM + SPF via DNS).
- Use a professional `@yourdomain.com` sender, not a personal Gmail, for production.
- Ask recipients to mark as "Not spam" once.

---

### EOD emails not received but test email works

**Checklist:**

1. Run `node scripts/diagnoseEodEmail.js` — are **Resolved stakeholder recipients** empty?
2. Add emails to Superadmin users in **Personnel**, or set `EOD_STAKEHOLDER_EMAILS`.
3. Enable **template_eod_summary** in **Settings → Templates**.
4. Check server logs for `[EOD email]` lines after submitting EOD.

---

### `SMTP_FROM` does not match `SMTP_USER` warning

The backend **uses `SMTP_USER` as the From address** when they differ. Set both to the same email to avoid confusion.

---

## 8. Security checklist

- [ ] `.env` is listed in `.gitignore` and never committed
- [ ] SendGrid API keys are **restricted** (Mail Send only)
- [ ] Rotate keys if leaked or shared in chat by mistake
- [ ] Production uses SendGrid or verified domain SMTP — not a personal Gmail
- [ ] Do not post API keys, App Passwords, or mailbox passwords in tickets/screenshots

---

## 9. Quick reference — all `.env` variables

| Variable | Required when | Example |
|---|---|---|
| `EMAIL_PROVIDER` | Optional | `auto` (default), `sendgrid`, or `smtp` |
| `SENDGRID_API_KEY` | SendGrid | `SG.xxxxx` |
| `SENDGRID_FROM_EMAIL` | SendGrid | `lca@little-champion.com` |
| `SMTP_HOST` | SMTP | `smtp.gmail.com` or `mail.yourdomain.com` |
| `SMTP_PORT` | SMTP | `587` or `465` |
| `SMTP_SECURE` | SMTP | `false` for 587, `true` for 465 |
| `SMTP_USER` | SMTP | Full email address |
| `SMTP_PASSWORD` | SMTP | App password or mailbox password |
| `SMTP_FROM` | SMTP | Same as `SMTP_USER` (recommended) |
| `EOD_STAKEHOLDER_EMAILS` | Optional | `a@x.com,b@y.com` |

### Example — Production (Linode + SendGrid)

```env
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=SG.your_key_here
SENDGRID_FROM_EMAIL=lca@little-champion.com
EOD_STAKEHOLDER_EMAILS=owner@little-champion.com
```

### Example — Local development (Gmail SMTP)

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=dev@gmail.com
SMTP_PASSWORD=abcdefghijklmnop
SMTP_FROM=dev@gmail.com
```

---

## Still stuck?

1. Run `node scripts/diagnoseEodEmail.js` and copy the **full terminal output** (redact API keys).
2. Confirm you restarted the API **after** editing `.env`.
3. Confirm the test message is not in **Spam/Junk**.
4. For SendGrid issues, check **Activity → Email Activity** in the SendGrid dashboard for bounce/block reasons.

---

**Related file (legacy Gmail-focused notes):** `backend/docs/SMTP_SETUP_GUIDE.md`

**Implementation reference:** `backend/utils/emailTransport.js`
