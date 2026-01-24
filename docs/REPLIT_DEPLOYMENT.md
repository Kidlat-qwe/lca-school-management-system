# Replit Deployment Guide

This guide covers deploying both the backend and frontend separately to Replit.

## Overview

The system consists of two separate Replit projects:
1. **Backend API** - Node.js/Express server
2. **Frontend** - React/Vite application

## Quick Start

### Backend Deployment

1. **Create a new Replit project**
   - Language: Node.js
   - Import the `backend/` folder

2. **Set Environment Variables** (Replit Secrets)
   - Copy from `backend/.env.example`
   - Update with your actual values
   - **Important:** Set `CORS_ORIGIN` to your frontend Replit URL

3. **Upload Firebase Admin SDK**
   - Upload your Firebase Admin SDK JSON file to `config/` folder
   - Update `FIREBASE_ADMIN_SDK_PATH` in secrets

4. **Run**
   - Click "Run" button
   - Note your Replit URL: `https://your-backend-repl.id.repl.co`

### Frontend Deployment

1. **Create a new Replit project**
   - Language: Node.js
   - Import the `frontend/` folder

2. **Set Environment Variables** (Replit Secrets)
   - `VITE_API_BASE_URL=https://your-backend-repl.id.repl.co/api/sms`
   - Add Supabase keys if using Supabase features

3. **Run**
   - Click "Run" button
   - Note your Replit URL: `https://your-frontend-repl.id.repl.co`

4. **Update Backend CORS**
   - Go back to backend Replit
   - Update `CORS_ORIGIN` and `REPLIT_FRONTEND_URL` to your frontend URL

## Environment Variables Reference

### Backend Required Variables

```env
PORT=3000
NODE_ENV=production
HOST=0.0.0.0

# Database
DB_HOST=your-database-host
DB_PORT=5432
DB_NAME=psms_db
DB_USER=your-database-user
DB_PASSWORD=your-database-password
DB_SSL=true

# Firebase
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_ADMIN_SDK_PATH=./config/your-file.json
FIREBASE_API_KEY=your-api-key

# CORS (IMPORTANT: Set to frontend URL)
CORS_ORIGIN=https://your-frontend-repl.id.repl.co
REPLIT_FRONTEND_URL=https://your-frontend-repl.id.repl.co

# SMTP (Optional)
SMTP_HOST=your-smtp-host
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-user
SMTP_PASSWORD=your-password
SMTP_FROM=your-email
```

### Frontend Required Variables

```env
VITE_API_BASE_URL=https://your-backend-repl.id.repl.co/api/sms
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## Deployment Checklist

### Backend
- [ ] Project created in Replit
- [ ] Environment variables set in Secrets
- [ ] Firebase Admin SDK file uploaded
- [ ] Database connection tested
- [ ] Server starts successfully
- [ ] Health check endpoint works: `/health`
- [ ] CORS configured for frontend URL

### Frontend
- [ ] Project created in Replit
- [ ] Environment variables set in Secrets
- [ ] `VITE_API_BASE_URL` points to backend
- [ ] **Development mode:** Click "Run" - uses dev server (recommended)
- [ ] **Production build:** For promotion, uses increased memory (4GB)
- [ ] Can access frontend URL
- [ ] Can connect to backend API
- [ ] If build fails due to memory, use dev mode instead

## Testing the Deployment

1. **Backend Health Check**
   ```
   GET https://your-backend-repl.id.repl.co/health
   ```
   Should return: `{"success": true, "message": "Server is running", ...}`

2. **Frontend Connection**
   - Open frontend URL in browser
   - Check browser console for errors
   - Try logging in

3. **API Endpoints**
   - Test authentication: `POST /api/sms/auth/verify`
   - Test data fetching: `GET /api/sms/users` (with auth token)

## Common Issues

### CORS Errors

**Problem:** Frontend can't connect to backend

**Solution:**
1. Check `CORS_ORIGIN` in backend matches frontend URL exactly
2. Add `REPLIT_FRONTEND_URL` to backend secrets
3. Ensure URLs include `https://` protocol
4. No trailing slashes in URLs

### Database Connection Failed

**Problem:** Backend can't connect to database

**Solution:**
1. Verify `DB_SSL=true` for cloud databases
2. Check database allows connections from Replit
3. Verify credentials are correct
4. Test connection from database provider's console

### Environment Variables Not Working

**Problem:** Variables not being read

**Solution:**
1. **Backend:** Variables work directly from Replit Secrets
2. **Frontend:** Must have `VITE_` prefix
3. Restart server after changing variables
4. Check variable names match exactly

### Build Errors / Memory Issues

**Problem:** Frontend build fails with "JavaScript heap out of memory"

**Solution:**
1. **Use Development Mode (Recommended):**
   - Change `.replit` run command to: `npm run dev`
   - Development mode uses less memory and is faster
   - Perfect for Replit hosting

2. **If Production Build Required:**
   - Memory is already increased to 4GB in deploy command
   - Check Node.js version (should be 18+)
   - Try clearing `node_modules` and reinstalling
   - Consider reducing bundle size by removing unused dependencies

3. **Alternative:**
   - Build locally and commit `dist/` folder
   - Use a simple static file server in Replit

## URLs Structure

After deployment, you'll have:

- **Backend API:** `https://your-backend-repl.id.repl.co`
  - Health: `https://your-backend-repl.id.repl.co/health`
  - API Base: `https://your-backend-repl.id.repl.co/api/sms`

- **Frontend App:** `https://your-frontend-repl.id.repl.co`
  - Login: `https://your-frontend-repl.id.repl.co/login`
  - Dashboard: `https://your-frontend-repl.id.repl.co/superadmin`

## Security Notes

1. **Never commit `.env` files** - Use Replit Secrets
2. **Firebase Admin SDK** - Keep secure, don't expose
3. **Database Credentials** - Use strong passwords
4. **CORS** - Only allow your frontend URL
5. **HTTPS** - Replit provides HTTPS automatically

## Updating After Deployment

### Backend Updates
1. Make changes to code
2. Replit auto-reloads on save
3. Or click "Stop" then "Run" to restart

### Frontend Updates
1. Make changes to code
2. Rebuild: `npm run build`
3. Restart preview: `npm run preview`
4. Or use "Run" button to rebuild

## Monitoring

- **Backend Logs:** Check Replit console
- **Frontend Logs:** Check browser console
- **API Errors:** Check backend console
- **Database:** Monitor from database provider

## Support

For detailed setup instructions, see:
- `backend/REPLIT_SETUP.md` - Backend-specific guide
- `frontend/REPLIT_SETUP.md` - Frontend-specific guide

