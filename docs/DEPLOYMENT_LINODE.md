# Deploy to Linode (Push & Pull Workflow)

Standard workflow for updating the live site. Use this every time you deploy.

---

## Phase 1: On your computer (push code)

1. Open the project in your editor.
2. Open Terminal and run:

```bash
git add .
git commit -m "Updated files for deployment"
git push origin main
```

Wait until it finishes (e.g. "100%" or "done"). Your code is now on GitHub.

---

## Phase 2: On the server (pull & deploy)

1. **SSH into the server**

```bash
ssh root@103.3.61.210
```

2. **Go to the project folder**

```bash
cd School_Management_System
```

*(Use your actual project folder name if different.)*

3. **Pull latest code**

```bash
git pull origin main
```

If you see **"local changes would be overwritten"** (e.g. you edited files on the server):

```bash
git stash
git pull origin main
```

4. **Install dependencies (if you added any)**

```bash
npm install
```

*(If backend and frontend are separate, run `npm install` in each: `cd backend && npm install && cd ../frontend && npm install`.)*

5. **Rebuild the frontend** (required for a Vite app)

From the project root, or from `frontend/` if that’s where the Vite app lives:

```bash
cd frontend
npm run build
cd ..
```

*(Adjust paths if your structure is different.)*

6. **Use production database on the server**

The backend on Linode must run with **NODE_ENV=production** so it uses **psms_production**, not psms_db.

- **Option A – in backend `.env` on the server:** set `NODE_ENV=production`.
- **Option B – start with production env:**  
  If you use PM2, start the backend with production mode, e.g.  
  `NODE_ENV=production node backend/server.js`  
  or use the npm script:  
  `cd backend && npm run start:prod`

Ensure **`backend/.env.production`** exists on the server (it is not in git) with production DB settings, including **`DB_NAME=psms_production`**.

7. **Restart the app**

```bash
pm2 restart all
```

*(Or restart only the backend process if you have a specific PM2 app name.)*

---

## Summary checklist

- [ ] Computer: `git add .` → `git commit -m "..."` → `git push origin main`
- [ ] Server: `ssh root@103.3.61.210`
- [ ] Server: `cd School_Management_System`
- [ ] Server: `git pull origin main` (and `git stash` if needed)
- [ ] Server: `npm install` (in project root and/or frontend/backend as needed)
- [ ] Server: `cd frontend && npm run build`
- [ ] Server: Backend runs with **NODE_ENV=production** and **backend/.env.production** has **psms_production**
- [ ] Server: `pm2 restart all`

After restart, check backend logs for: **`🔧 Env: production | DB: psms_production`**.
