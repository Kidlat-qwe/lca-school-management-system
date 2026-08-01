# Deploying PSMS on Coolify

Step-by-step guide to deploy the **Physical School Management System (PSMS)** on
the RHET/LCA Coolify host (via **Cloudflare Tunnel**). Aligns with the internal
*Coolify New App Deployment Quick Guide*.

PSMS is split into **two Coolify Application resources** from the same Git repo:

| Application | Path in repo | Type | Coolify Domain (enter as) | Open in browser |
|---|---|---|---|---|
| Backend API | `backend/` | Node.js (Nixpacks) | `http://api-cms.lca-app.com` | `https://api-cms.lca-app.com` |
| Frontend SPA | `frontend/` | Static / Nixpacks | `http://cms.lca-app.com` | `https://cms.lca-app.com` |

The PostgreSQL database is **external (Neon)** and is not deployed on Coolify.

---

## Important rules (LCA Coolify + Cloudflare Tunnel)

1. **Do not use** the generated `sslip.io` link. It points at the public IP and may
   open the Globe router page. Always use an `lca-app.com` subdomain.
2. In Coolify **Domains**, enter **`http://`** (not `https://`):

   ```text
   http://api-cms.lca-app.com
   http://cms.lca-app.com
   ```

3. In the browser, always open **`https://`**. Cloudflare terminates HTTPS;
   Coolify receives traffic through the tunnel on HTTP port 80.
4. After changing domain or environment variables, **Redeploy**.

---

## 1. Prerequisites

- App repository on GitHub/GitLab and the correct branch (usually `main`).
- Coolify project/environment ready; Git source connected.
- Chosen subdomains: `api-cms.lca-app.com` (API), `cms.lca-app.com` (SPA).
- Credentials ready:
  - Neon PostgreSQL (`DB_*_PRODUCTION`)
  - Firebase Admin (prefer `FIREBASE_PRIVATE_KEY_BASE64`)
  - AWS S3, SendGrid, Semaphore SMS
  - RHET Inventory key (optional — see `PSMS_API_INTEGRATION.md`)

DNS / tunnel for `*.lca-app.com` is managed by IT (Cloudflare Tunnel). Escalate
to IT if the app is **Running** but still unreachable after domain, port, and
env are correct.

---

## 2. Create / open the Coolify project

1. Coolify → **Projects** → select environment.
2. You will add **two** resources (backend + frontend) from the same repository.

---

## 3. Deploy the backend API

### 3.1 Create the resource

1. **New Resource → Application → Git Repository**.
2. Paste the repository URL; select the correct branch.
3. Build method: **Nixpacks** (no production Dockerfile in this repo).
4. **Base Directory:** `/backend`.
5. Confirm commands (`backend/nixpacks.toml` defaults):

  ```text
  Install Command:  npm install
  Start Command:    node server.js --production
  ```

> **Required:** start must include `--production`. If logs show
> `NODE_ENV=development ... | DB: psms_db`, the API is on the wrong database.
> Do not use bare `node server.js` or `npm start`.

### 3.2 Network — port

- **Ports Exposes:** `3000` (app listens on `process.env.PORT || 3000`, host `0.0.0.0`).

### 3.3 Domain

- **General → Domains:** `http://api-cms.lca-app.com`  
  (use `http://` in Coolify; open with `https://` in the browser)

### 3.4 Environment variables

  ```env
  # Runtime
  NODE_ENV=production
  PORT=3000

  # Database (Neon, production)
  DB_HOST_PRODUCTION=your-neon-host.aws.neon.tech
  DB_PORT_PRODUCTION=5432
  DB_NAME_PRODUCTION=psms_production
  DB_USER_PRODUCTION=neondb_owner
  DB_PASSWORD_PRODUCTION=your-db-password
  DB_SSL_PRODUCTION=true

  # CORS — external HTTPS origin of the SPA
  CORS_ORIGIN=https://cms.lca-app.com

  # Firebase Admin — BASE64 recommended on Coolify
  FIREBASE_PROJECT_ID=psms-b9ca7
  FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@psms-b9ca7.iam.gserviceaccount.com
  FIREBASE_PRIVATE_KEY_BASE64=<base64-encoded-private-key>
  FIREBASE_API_KEY=your-firebase-web-api-key

  # AWS S3
  AWS_REGION=ap-southeast-1
  AWS_ACCESS_KEY_ID=your-access-key
  AWS_SECRET_ACCESS_KEY=your-secret-key
  AWS_S3_BUCKET_NAME=your-bucket

  # Email
  EMAIL_PROVIDER=auto
  SENDGRID_API_KEY=your-sendgrid-key
  SENDGRID_FROM_EMAIL=lca@little-champion.com

  # SMS
  SMS_NOTIFICATIONS_ENABLED=true
  SEMAPHORE_API_KEY=your-semaphore-key
  SEMAPHORE_SENDER_NAME=LCAcademy
  SEMAPHORE_API_URL=https://api.semaphore.co/api/v4/messages

  # RHET Inventory (optional)
  INVENTORY_API_URL=https://your-inventory-domain.com/api/v1/integrations
  INVENTORY_INTEGRATION_KEY=your-long-random-shared-secret
  INVENTORY_WEBHOOK_URL=https://api-cms.lca-app.com/api/webhooks/inventory
  ```

#### Generating `FIREBASE_PRIVATE_KEY_BASE64`

Encode **only** the `private_key` string from the service-account JSON (not the whole file):

  ```bash
  node -e "console.log(Buffer.from(require('./service-account.json').private_key).toString('base64'))"
  ```

### 3.5 Save and deploy

- **Save**, then **Deploy** / **Redeploy**. Wait until **Running** / **Healthy**.
- Expected logs:

  ```text
  🔧 NODE_ENV=production ... | DB: psms_production
  ✅ Firebase Admin initialized successfully
  🚀 Server is running on 0.0.0.0:3000
  ```

- Verify externally:

  ```bash
  curl https://api-cms.lca-app.com/health
  ```

---

## 4. Deploy the frontend SPA

### 4.1 Create the resource

1. **New Resource → Application** — same repo and branch.
2. Build method: **Nixpacks**.
3. **Base Directory:** `/frontend`.
4. Prefer **static** publish of the Vite build:

  ```text
  Install Command:   npm install
  Build Command:     npm run build
  Publish Directory: dist
  ```

5. Enable **SPA** fallback to `index.html` (client-side routing).

> If you see `Blocked request. This host ("cms.lca-app.com") is not allowed`,
> Coolify is running Vite instead of static `dist`. Switch to Publish Directory
> `dist`, or Build `npm run build` + Start
> `npx vite preview --host 0.0.0.0 --strictPort` (`frontend/nixpacks.toml`).
> Do **not** use `npm start` on Coolify (`npm start` stays `npm run dev` for Linode).

### 4.2 Domain

- **Domains:** `http://cms.lca-app.com`  
  Browser: `https://cms.lca-app.com`

### 4.3 Environment variables (build-time)

Use **external HTTPS** URLs (Cloudflare-facing), not `http://`:

  ```env
  VITE_API_BASE_URL=https://api-cms.lca-app.com/api/sms
  VITE_SUPABASE_URL=https://your-project.supabase.co
  VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
  ```

Plus any `VITE_FIREBASE_*` the SPA needs. Change env → **Redeploy** (Vite bakes
values at build time).

### 4.4 Save and deploy

- Open `https://cms.lca-app.com` (not sslip.io). Confirm API calls go to
  `https://api-cms.lca-app.com`.

---

## 5. Database migrations

Apply `backend/migrations/*.sql` to Neon in numeric order (not run by Coolify).
See `backend/migrations/README.md`.

---

## 6. Final checklist (LCA guide + PSMS)

- [ ] Repository and branch are correct.
- [ ] Build method is **Nixpacks**; base dirs `/backend` and `/frontend`.
- [ ] Backend start: `node server.js --production`; port **3000**.
- [ ] Coolify Domains use **`http://`** (`api-cms` + `cms`).
- [ ] Browser opens **`https://`** only — no `sslip.io`.
- [ ] Redeployed after domain/env changes.
- [ ] Backend logs: `NODE_ENV=production`, `DB: psms_production`, Firebase OK.
- [ ] `GET https://api-cms.lca-app.com/health` succeeds.
- [ ] Login works; no CORS / mixed-content errors.
- [ ] Image upload / email / SMS / inventory as needed.

Escalate to IT if the app is Running but still cannot open after domain, port,
and environment variables are confirmed.

---

## 7. Redeploys and rollbacks

- Push to the watched branch or click **Deploy**.
- Rollback via Coolify **Deployments** history.
- Frontend env changes require a **rebuild**.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Globe router / wrong page | Using `sslip.io` or public IP | Use `https://*.lca-app.com` only |
| Redirect / wrong URL | Domain entered as `https://` in Coolify | Set Domain to `http://subdomain.lca-app.com`, redeploy |
| Logs show `NODE_ENV=development` / `DB: psms_db` | Missing `--production` | Start: `node server.js --production` |
| `FIREBASE_PRIVATE_KEY does not look like a PEM key` | Mangling / wrong BASE64 | BASE64 of **only** `private_key` from service-account JSON |
| `Blocked request... cms.lca-app.com` | Vite instead of static `dist` | Publish Directory `dist`, or nixpacks preview start |
| CORS errors | Wrong origin | `CORS_ORIGIN=https://cms.lca-app.com` |
| Frontend calls wrong API | Stale Vite env | Set `VITE_API_BASE_URL=https://api-cms.lca-app.com/api/sms`, redeploy |
| Running but unreachable | Tunnel / DNS | Escalate to IT (domain, port, env already confirmed) |

---

## 9. Reference

- Internal: *Coolify New App Deployment Quick Guide* (Cloudflare Tunnel)
- API integration: `PSMS_API_INTEGRATION.md`
- Backend: `backend/README.md`
- Env loading: `backend/config/loadEnv.js`
- API host detection: `frontend/src/config/api.js`
