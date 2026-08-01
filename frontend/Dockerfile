# Coolify / production frontend: build Vite SPA, serve with nginx (SPA fallback).
# In Coolify: Base Directory=/frontend, Build Pack=Dockerfile, Port=80.
# Domain in Coolify (Cloudflare Tunnel): http://cms.lca-app.com
# Open in browser: https://cms.lca-app.com

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Optional build-time API URL (Coolify can pass as build ARG / env)
ARG VITE_API_BASE_URL=https://api-cms.lca-app.com/api/sms
ARG VITE_SUPABASE_URL=
ARG VITE_SUPABASE_ANON_KEY=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    NODE_OPTIONS=--max-old-space-size=4096

RUN npm run build:prod

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
