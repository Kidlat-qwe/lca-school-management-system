# Deployment Documentation

Guides for deploying the Physical School Management System (PSMS).

| Document | Description |
|---|---|
| `COOLIFY_DEPLOYMENT.md` | Step-by-step deployment of the backend API and frontend SPA on Coolify |

Frontend Coolify image: `frontend/Dockerfile` + `frontend/nginx.conf` (see `frontend/COOLIFY_DOCKER.md`).


## Overview

PSMS deploys as two applications from one repository:

- **Backend API** (`backend/`) — Node.js/Express, Nixpacks, port `3000`.
- **Frontend SPA** (`frontend/`) — Vite/React static build, served with SPA fallback.

The PostgreSQL database is external (Neon) and is not deployed by these guides.

## Key gotcha

`backend/config/loadEnv.js` reads `NODE_ENV` from a physical `.env` file. On
Coolify (no `.env` file), start the backend with `node server.js --production`
so it selects the `DB_*_PRODUCTION` variables. See `COOLIFY_DEPLOYMENT.md` for details.
