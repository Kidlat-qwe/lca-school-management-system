# Frontend Coolify / Docker deploy

Serves the Vite React SPA with **nginx** so client routes (`/login`, etc.) work.
Linode keeps PM2 + `npm run build:prod`; these files do not change that path.

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage: `npm run build:prod` → nginx:alpine |
| `nginx.conf` | SPA `try_files` → `index.html`; caches `/assets/` |
| `nixpacks.toml` | Fallback if Coolify uses Nixpacks instead of Dockerfile |
| `.dockerignore` | Keeps image build context small |

## Coolify settings (required)

1. **Base Directory:** `/frontend`
2. **Build Pack:** `Dockerfile` (recommended — avoids Vite `allowedHosts` / `npm start` issues)
3. **Ports Exposes:** `80`
4. **Start Command:** leave empty (image `CMD` runs nginx)
5. **Domain:** `http://cms.lca-app.com` (Cloudflare Tunnel; open with `https://` in browser)

Build-time env (HTTPS URLs):

```env
VITE_API_BASE_URL=https://api-cms.lca-app.com/api/sms
```

Full guide: `docs/deployment/COOLIFY_DEPLOYMENT.md`.
