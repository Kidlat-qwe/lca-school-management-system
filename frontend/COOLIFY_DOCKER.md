# Frontend Coolify / Docker deploy

Serves the Vite React SPA with **nginx** so client routes (`/login`, etc.) work.

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage: `npm run build:prod` → nginx:alpine |
| `nginx.conf` | SPA `try_files` → `index.html`; caches `/assets/` |
| `nixpacks.toml` | Optional if Coolify uses Nixpacks + static site |
| `.dockerignore` | Keeps image build context small |

## Coolify settings (required)

1. **Base Directory:** `/frontend`
2. **Build Pack:** `Dockerfile` (recommended)
3. **Ports Exposes:** `80`
4. **Start Command:** empty
5. **Domain:** `https://cms.lca-app.com`

If you keep Nixpacks instead: enable **Is it a static site?**, Build = `npm run build:prod`, Publish = `dist`, Start empty, enable SPA.

Full guide: `docs/deployment/COOLIFY_DEPLOYMENT.md`.

## Linode

This Docker setup is for Coolify. Linode can keep the existing PM2 + `npm run build:prod` flow; these files do not change that path.
