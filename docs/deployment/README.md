# Deployment Documentation

Guides for deploying the Physical School Management System (PSMS).

| Document | Description |
|---|---|
| `COOLIFY_DEPLOYMENT.md` | Step-by-step deployment of the backend API and frontend SPA on Coolify |

## Overview

PSMS deploys as two applications from one repository on RHET/LCA Coolify
(**Cloudflare Tunnel** — see internal *Coolify New App Deployment Quick Guide*):

- **Backend API** (`backend/`) — Node.js/Express, Nixpacks, port `3000`.
- **Frontend SPA** (`frontend/`) — Vite/React static build (`dist`), SPA fallback.

Coolify Domains use `http://*.lca-app.com`; open apps with `https://` in the browser.
Never use `sslip.io`. PostgreSQL is external (Neon).

## Key gotchas

1. Backend start on Coolify: `node server.js --production` (`backend/nixpacks.toml`).
2. Prefer `FIREBASE_PRIVATE_KEY_BASE64` (PEM `private_key` only).
3. Frontend: publish `dist` as static SPA; Domain `http://cms.lca-app.com` in Coolify.
4. Linode (`cms.little-champion.com`) is unchanged — Coolify logic only when `COOLIFY*` is set.

See `COOLIFY_DEPLOYMENT.md` for the full checklist.
