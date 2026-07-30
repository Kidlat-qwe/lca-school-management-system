# Deploying PSMS on Coolify

Step-by-step guide to deploy the **Physical School Management System (PSMS)** on
[Coolify](https://coolify.io). PSMS is split into two deployable applications that
are created as **separate Coolify resources** from the same Git repository:

| Application | Path in repo | Type | Example domain |
|---|---|---|---|
| Backend API | `backend/` | Node.js (Nixpacks) | `api-cms.lca-app.com` |
| Frontend SPA | `frontend/` | Static site (Nixpacks) | `cms.lca-app.com` |

The PostgreSQL database is **external (Neon)** and is not deployed on Coolify.

---

## 1. Prerequisites

Before starting, make sure you have:

- A running Coolify instance (self-hosted server or Coolify Cloud) with a public IP.
- A Coolify **Source** connected to this Git repository (GitHub App or deploy key).
- DNS control for your domain so you can point subdomains to the Coolify server.
- The following external credentials ready:
  - Neon PostgreSQL connection details (production database).
  - Firebase Admin SDK service account (JSON downloaded from Firebase Console).
  - AWS S3 access key/secret and bucket name.
  - SendGrid API key (or SMTP credentials).
  - Semaphore SMS API key.
  - RHET Inventory integration key (see `PSMS_API_INTEGRATION.md`), if the
    inventory integration is enabled.

---

## 2. DNS setup

Create two `A` records pointing to your Coolify server public IP:

  ```text
  api-cms.lca-app.com   →  <coolify-server-ip>
  cms.lca-app.com       →  <coolify-server-ip>
  ```

The frontend auto-detects `*.lca-app.com` and calls `https://api-cms.lca-app.com/api/sms`
(see `frontend/src/config/api.js`), so using these hostnames avoids extra configuration.

---

## 3. Create a Coolify project

1. In Coolify, open **Projects → + Add**.
2. Name it `PSMS` and select an environment (e.g. `production`).
3. You will add **two resources** to this project in the next sections.

---

## 4. Deploy the backend API

### 4.1 Create the resource

1. Inside the `PSMS` project, click **+ New Resource → Application**.
2. Choose the connected Git **Source** and select this repository and branch (`main`).
3. Build Pack: **Nixpacks**.
4. Set **Base Directory** to `/backend` so Coolify builds only the backend.
5. Coolify auto-detects Node.js. Confirm/adjust the commands:

  ```text
  Install Command:  npm install
  Start Command:    node server.js --production
  ```

> Important: `backend/config/loadEnv.js` reads `NODE_ENV` from a physical `.env`
> file. On Coolify there is no such file, so it would default to `development`.
> The `--production` flag in the start command forces production mode and makes
> the app read the `DB_*_PRODUCTION` variables. Do not omit it.

### 4.2 Configure the port

- Set **Ports Exposes** to `3000` (the backend listens on `process.env.PORT || 3000`
  and binds to `0.0.0.0`).

### 4.3 Set the domain

- Under **Domains**, set `https://api-cms.lca-app.com`.
- Coolify provisions a Let's Encrypt certificate automatically.

### 4.4 Environment variables

Open the backend resource **Environment Variables** tab and add the following.
These mirror `backend/.env` and use the `_PRODUCTION` suffix so they are selected
when the app starts with `--production`.

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

  # CORS (comma-separated) — must include the frontend origin
  CORS_ORIGIN=https://cms.lca-app.com

  # Firebase Admin — recommended on Coolify: BASE64 (avoids newline mangling)
  FIREBASE_PROJECT_ID=psms-b9ca7
  FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@psms-b9ca7.iam.gserviceaccount.com
  FIREBASE_PRIVATE_KEY_BASE64=<base64-encoded-private-key>
  FIREBASE_API_KEY=your-firebase-web-api-key

  # AWS S3 (image uploads)
  AWS_REGION=ap-southeast-1
  AWS_ACCESS_KEY_ID=your-access-key
  AWS_SECRET_ACCESS_KEY=your-secret-key
  AWS_S3_BUCKET_NAME=your-bucket

  # Email
  EMAIL_PROVIDER=auto
  SENDGRID_API_KEY=your-sendgrid-key
  SENDGRID_FROM_EMAIL=lca@little-champion.com

  # SMS (Semaphore, Philippines)
  SMS_NOTIFICATIONS_ENABLED=true
  SEMAPHORE_API_KEY=your-semaphore-key
  SEMAPHORE_SENDER_NAME=LCAcademy
  SEMAPHORE_API_URL=https://api.semaphore.co/api/v4/messages

  # RHET Inventory integration (optional — see PSMS_API_INTEGRATION.md)
  INVENTORY_API_URL=https://your-inventory-domain.com/api/v1/integrations
  INVENTORY_INTEGRATION_KEY=your-long-random-shared-secret
  INVENTORY_WEBHOOK_URL=https://api-cms.lca-app.com/api/webhooks/inventory
  ```

#### Generating `FIREBASE_PRIVATE_KEY_BASE64`

From the downloaded service-account JSON, base64-encode the `private_key` value:

  ```bash
  node -e "console.log(Buffer.from(require('./service-account.json').private_key).toString('base64'))"
  ```

Paste the output as `FIREBASE_PRIVATE_KEY_BASE64`. If you prefer the raw key, use
`FIREBASE_PRIVATE_KEY` with Coolify's **Is Multiline** enabled and real line breaks.

### 4.5 Deploy

- Click **Deploy**. Watch the logs for:

  ```text
  ✅ Database connected successfully
  ✅ Firebase Admin initialized successfully
  🚀 Server is running on 0.0.0.0:3000
  ```

- Verify the health endpoint:

  ```bash
  curl https://api-cms.lca-app.com/health
  ```

---

## 5. Deploy the frontend SPA

The frontend is a **Vite static SPA**. It must be served by a web server (nginx),
not by `npm run build` / `npm start`. Repo files:

- `frontend/Dockerfile` + `frontend/nginx.conf` — **recommended** (SPA fallback built in)
- `frontend/nixpacks.toml` — optional if you keep Nixpacks + static mode

### 5.1 Recommended: Dockerfile (fixes root `(index):1` 404)

1. In the same `PSMS` project, open the frontend application (or **+ New Resource → Application**).
2. Select the same Git **Source**, repository, and branch (`main`).
3. Set **Base Directory** to `/frontend`.
4. Set **Build Pack** to **Dockerfile** (Coolify will use `frontend/Dockerfile`).
5. Set **Ports Exposes** to `80`.
6. Clear any custom **Start Command** (the image runs nginx).
7. Under **Domains**, set `https://cms.lca-app.com` (HTTPS, not HTTP).
8. Optional build-time env (Coolify → Environment Variables; mark as available at build if needed):

  ```env
  VITE_API_BASE_URL=https://api-cms.lca-app.com/api/sms
  VITE_SUPABASE_URL=https://your-project.supabase.co
  VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
  ```

9. Click **Save** → **Redeploy**.

After deploy, `https://cms.lca-app.com/` and `/login` must load the React app.

### 5.2 Alternative: Nixpacks static site

Only use this if you prefer Nixpacks instead of Dockerfile:

1. Build Pack: **Nixpacks**, Base Directory: `/frontend`.
2. Check **Is it a static site?** (required — Coolify then serves with nginx).
3. Check **Is it a SPA?** if shown (fallback to `index.html`).
4. Settings:

  ```text
  Install Command:   npm ci
  Build Command:     npm run build:prod
  Start Command:     (leave empty)
  Publish Directory: dist
  ```

5. Domain: `https://cms.lca-app.com`. Redeploy.

> Do **not** put `npm run build:prod` in **Start Command**. That builds once and
> exits; Coolify then has nothing to serve → `(index):1` / `/login` **404**.

### 5.3 Deploy

- Click **Deploy**. After the build finishes, open `https://cms.lca-app.com` and
  confirm the login page loads and network calls hit `api-cms.lca-app.com`.

> `VITE_API_BASE_URL` is optional on `*.lca-app.com` because the app auto-detects
> the API host, but setting it explicitly is recommended and required for any
> other domain.
---

## 6. Database migrations

The production database is external (Neon). Run pending SQL migrations from
`backend/migrations/` against the production database. Options:

- Run them from a local machine that has the production `.env`:

  ```bash
  cd backend
  node -e "import('./config/loadEnv.js').then(async () => { const { readFileSync } = await import('fs'); const { query } = await import('./config/database.js'); const sql = readFileSync('./migrations/124_add_inventory_fields_to_merchandiserequestlogtbl.sql','utf8'); await query(sql); console.log('done'); process.exit(0); });" -- --production
  ```

- Or apply the `.sql` file directly with `psql` against the Neon connection string.

Always review `backend/migrations/README.md` and apply migrations in numeric order.

---

## 7. Post-deploy verification checklist

- [ ] `GET https://api-cms.lca-app.com/health` returns `success: true`.
- [ ] Frontend loads at `https://cms.lca-app.com` with no mixed-content errors.
- [ ] Login works (Firebase Admin initialized on the backend).
- [ ] An authenticated API call succeeds (no CORS error in the browser console).
- [ ] Image upload works (AWS S3 credentials valid).
- [ ] A test email/SMS is delivered.
- [ ] Merchandise stock request reaches RHET Inventory (if integration enabled).

---

## 8. Redeploys and rollbacks

- **Redeploy:** push to the deployed branch; enable **Auto Deploy** on each
  resource for push-to-deploy, or click **Deploy** manually.
- **Rollback:** use Coolify's **Deployments** history to redeploy a previous build.
- Frontend env changes require a **rebuild** (Vite variables are compiled in).

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| App connects to the wrong database | `--production` flag missing | Set start command to `node server.js --production` |
| `Missing required Firebase environment variables` | Private key not set/decoded | Use `FIREBASE_PRIVATE_KEY_BASE64`, or `FIREBASE_PRIVATE_KEY` with **Is Multiline** |
| `FIREBASE_PRIVATE_KEY does not look like a PEM key` | Newlines mangled by Coolify | Prefer the BASE64 variable |
| CORS errors in browser | Frontend origin not allowed | Add the frontend URL to `CORS_ORIGIN` |
| Mixed-content blocked | API served over HTTP | Ensure both apps use HTTPS domains in Coolify |
| `(index):1` or `/` **404** on cms.lca-app.com | Frontend not static / Start Command runs build | Switch to **Dockerfile** (section 5.1) or enable **Is it a static site?**, empty Start Command, Publish `dist` |
| 404 on page refresh (`/login`) | No SPA fallback | Use Dockerfile+nginx, or enable SPA + static site |
| `favicon.ico` 404 only | Missing file (pre-fix) | Ensure `frontend/public/favicon.ico` is deployed; ignore if site otherwise works |
| Frontend calls wrong API URL | Stale build-time env | Set `VITE_API_BASE_URL` and redeploy the frontend |

---

## 10. Reference

- API integration: `PSMS_API_INTEGRATION.md` (repository root)
- Backend overview: `backend/README.md`
- Migrations: `backend/migrations/README.md`
- Env loading logic: `backend/config/loadEnv.js`
- API host detection: `frontend/src/config/api.js`
