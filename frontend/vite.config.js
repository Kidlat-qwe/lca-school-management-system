import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Allow external connections (for Replit)
    port: parseInt(process.env.PORT) || 5173,
    strictPort: false, // Allow port fallback
    allowedHosts: [
      'lca-management-system.replit.app',
      '.replit.app',
      '.repl.co',
      'localhost',
      'cms.little-champion.com',
    ],
  },
  preview: {
    host: '0.0.0.0', // Allow external connections (for Replit)
    port: parseInt(process.env.PORT) || 5173,
    strictPort: false, // Allow port fallback
    allowedHosts: [
      'lca-management-system.replit.app',
      '.replit.app',
      '.repl.co',
      'localhost',
      'cms.little-champion.com',
    ],
  },
  build: {
    // Optimize build for Replit memory constraints
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'firebase-vendor': ['firebase'],
          'supabase-vendor': ['@supabase/supabase-js'],
          'pdf-vendor': ['@react-pdf/renderer'],
        },
      },
    },
  },
})
