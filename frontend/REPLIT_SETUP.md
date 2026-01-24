# Replit Setup Guide for Frontend

This guide will help you deploy the frontend to Replit.

## Prerequisites

1. A Replit account
2. Backend API deployed and accessible
3. Supabase project (if using Supabase features)

## Setup Steps

### 1. Import to Replit

1. Create a new Replit project
2. Import this frontend folder as the root
3. Replit will automatically detect Node.js/Vite

### 2. Configure Environment Variables

1. Click on the "Secrets" tab (lock icon) in Replit
2. Add the following environment variables:

```
VITE_API_BASE_URL=https://your-backend-repl.id.repl.co/api/sms
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

**Important:** Replace `your-backend-repl.id.repl.co` with your actual backend Replit URL.

### 3. Install Dependencies

Replit will automatically run `npm install` when you open the project.

### 4. Build and Run

**Option 1: Development Mode (Recommended for Replit)**
- Click the "Run" button in Replit
- Uses Vite dev server (faster, less memory)
- Your app will be available at: `https://your-repl-name.id.repl.co`

**Option 2: Production Build**
- For production deployment, Replit will automatically:
  - Install dependencies
  - Build the production bundle (with increased memory)
  - Start the preview server
- Your app will be available at: `https://your-repl-name.id.repl.co`

**Note:** If you encounter memory errors during build, use development mode instead.

### 5. Verify Connection

1. Open your frontend URL
2. Check browser console for any API connection errors
3. Try logging in to verify backend connectivity

## Development vs Production

### Development Mode (Default in Replit)

The default run command uses development mode which:
- Uses less memory
- Has hot module replacement
- Faster startup
```bash
npm run dev
# or
npm start
```

### Production Mode

To build and serve production build (requires more memory):
```bash
NODE_OPTIONS='--max-old-space-size=4096' npm run build && npm run serve
```

**Note:** Production builds may fail on Replit due to memory constraints. Development mode is recommended.

## Configuration

### API Base URL

The frontend connects to the backend using `VITE_API_BASE_URL`. Make sure this matches your backend Replit URL.

### CORS

Ensure your backend has CORS configured to allow requests from your frontend Replit URL.

## Troubleshooting

### Build Errors

- Check that all dependencies are installed
- Verify Node.js version compatibility
- Check for TypeScript/ESLint errors

### API Connection Issues

- Verify `VITE_API_BASE_URL` is correct
- Check backend CORS configuration
- Ensure backend is running and accessible

### Environment Variables Not Working

- Remember: Vite requires `VITE_` prefix for environment variables
- Restart the dev server after changing environment variables
- Check that variables are set in Replit Secrets

## Notes

- The preview server binds to `0.0.0.0` to accept external connections
- Production builds are optimized and minified
- Source maps are included for debugging

