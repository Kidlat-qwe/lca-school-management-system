# Email Setup Guide — SMTP & Brevo (PSMS)

Step-by-step instructions for configuring outbound email in the **Physical School Management System (PSMS)** backend.

> **Read this first.** Do not guess values. Follow every step in order, restart the API after editing `.env`, and run the test command at the end.

---

## Table of contents

1. [Which method should I use?](#1-which-method-should-i-use)
2. [Where to put settings](#2-where-to-put-settings)
3. [Brevo setup (recommended for production / Linode)](#3-brevo-setup-recommended-for-production--linode)
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
| **Production server (Linode / VPS)** | **Brevo** | Most VPS providers **block outbound SMTP ports 25, 465, and 587**. Brevo uses **HTTPS (port 443)**, which is not blocked. |
| **Local development (your laptop)** | **SMTP** (Gmail App Password or hosting email) or Brevo | SMTP works from home/office networks. Brevo also works locally. |
| **Production with unblocked SMTP** | SMTP (SpaceMail / cPanel / custom domain) | Only if port check passes (see [Test your configuration](#6-test-your-configuration)). |

**Rule of thumb**

- Linode / cloud VPS → **Brevo**
- Your PC → **SMTP** or **Brevo**

The backend supports **both**. You configure one (or both) in `backend/.env`. With default `EMAIL_PROVIDER=auto`, **Brevo wins if `BREVO_API_KEY` is set**; otherwise SMTP is used.

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

## 3. Brevo setup (recommended for production / Linode)

Transactional send API: [Send a transactional email](https://developers.brevo.com/docs/send-a-transactional-email).

### Step 3.1 — Verify the sender in Brevo

Brevo **rejects** mail if the **From** address is not a verified sender.

Preferred production sender:

- **From Name:** `Little Champions Academy Inc.`
- **From Email:** `no-reply@little-champion.com`

See [Create a new sender](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email). Authenticate `little-champion.com` in DNS (SPF/DKIM) when possible.

### Step 3.2 — Create an API key

1. In Brevo: **SMTP & API → API Keys**.
2. Create a key with transactional email permission.
3. Copy the key immediately. It starts with `xkeysib-` and is shown **only once**.

Do **not** put API keys in git or chat. Store them only in `backend/.env`.

### Step 3.3 — Add variables to `backend/.env`

Open `backend/.env` on the **server** (Linode), not only on your laptop.

Add or update:

```env
EMAIL_PROVIDER=brevo
BREVO_API_KEY=xkeysib-paste_your_full_api_key_here
BREVO_FROM_EMAIL=no-reply@little-champion.com
BREVO_FROM_NAME=Little Champions Academy Inc.
```

**Optional:** If you also have SMTP variables in `.env` for local use, `EMAIL_PROVIDER=brevo` forces Brevo so SMTP is ignored.

### Step 3.4 — Restart the API

Restart the Node backend so it reloads `.env`.

On startup you should see: `Brevo API key is valid (HTTPS — works when SMTP ports are blocked)`.

### Step 3.5 — Confirm it works

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

If you see **BLOCKED** for ports 465 and 587 on the server, **stop using SMTP on that server** and switch to [Brevo (Section 3)](#3-brevo-setup-recommended-for-production--linode).

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

- Active provider (`brevo` or `smtp`)
- SMTP port reachability (OPEN vs BLOCKED)
- Superadmin recipient list
- Whether the EOD template is enabled

### 6.2 — Send a test email

```bash
node scripts/diagnoseEodEmail.js --send-test you@example.com
```

Replace `you@example.com` with your real inbox.

### 6.3 — What success looks like

**Brevo:**

```
✅ Brevo API key is valid (HTTPS — works when SMTP ports are blocked)
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

- **Brevo:** Set `BREVO_API_KEY` and `BREVO_FROM_EMAIL`.
- **SMTP:** Set `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASSWORD`.
- Restart the API after saving.

---

### "Connection timeout" / SMTP ports BLOCKED

**Cause:** VPS provider (common on Linode) blocks outbound SMTP.

**Fix:** Use Brevo ([Section 3](#3-brevo-setup-recommended-for-production--linode)). Do not keep retrying SMTP on that server.

---

### Brevo API 401 / 403 / 400

**Causes & fixes:**

| Error | Fix |
|---|---|
| Invalid API key | Create a new key; paste full `xkeysib-...` value with no extra spaces |
| Sender not verified | Add `no-reply@little-champion.com` as an active sender in Brevo |
| 400 invalid sender | `BREVO_FROM_EMAIL` must match a verified sender exactly |

---

### "Invalid login credentials" (SMTP)

**Fix:**

- Gmail: use **App Password**, not normal password; confirm 2FA is on.
- Hosting: use full email as username; confirm mailbox password in webmail.
- Remove spaces from passwords in `.env`.

---

### Emails go to spam

**Fix:**

- Prefer Brevo **domain authentication** (DKIM + SPF via DNS).
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
- [ ] Brevo API keys are stored only in `.env` (never in git)
- [ ] Rotate keys if leaked or shared in chat by mistake
- [ ] Production uses Brevo or verified domain SMTP — not a personal Gmail
- [ ] Do not post API keys, App Passwords, or mailbox passwords in tickets/screenshots

---

## 9. Quick reference — all `.env` variables

| Variable | Required when | Example |
|---|---|---|
| `EMAIL_PROVIDER` | Optional | `auto` (default), `brevo`, or `smtp` |
| `BREVO_API_KEY` | Brevo | `xkeysib-xxxxx` |
| `BREVO_FROM_EMAIL` | Brevo | `no-reply@little-champion.com` |
| `BREVO_FROM_NAME` | Brevo | `Little Champions Academy Inc.` |
| `EMAIL_LOGO_URL` | Optional | `https://cms.little-champion.com/LCA%20Icon.png` |
| `SMTP_HOST` | SMTP | `smtp.gmail.com` or `mail.yourdomain.com` |
| `SMTP_PORT` | SMTP | `587` or `465` |
| `SMTP_SECURE` | SMTP | `false` for 587, `true` for 465 |
| `SMTP_USER` | SMTP | Full email address |
| `SMTP_PASSWORD` | SMTP | App password or mailbox password |
| `SMTP_FROM` | SMTP | Same as `SMTP_USER` (recommended) |
| `EOD_STAKEHOLDER_EMAILS` | Optional | `a@x.com,b@y.com` |

### Example — Production (Linode + Brevo)

```env
EMAIL_PROVIDER=brevo
BREVO_API_KEY=xkeysib-your_key_here
BREVO_FROM_EMAIL=no-reply@little-champion.com
BREVO_FROM_NAME=Little Champions Academy Inc.
EMAIL_LOGO_URL=https://cms.little-champion.com/LCA%20Icon.png
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
4. For Brevo issues, check **Transactional → Logs** in the Brevo dashboard for bounce/block reasons.

---

**Related file (legacy Gmail-focused notes):** `backend/docs/SMTP_SETUP_GUIDE.md`

**Implementation reference:** `backend/utils/emailTransport.js`
