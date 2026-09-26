/**
 * Public (unauthenticated) email brand assets.
 * Brevo transactional email does not support CID inline images — use absolute HTTPS <img src>.
 */
import express from 'express';
import { existsSync } from 'fs';
import { resolve as pathResolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __dirname = dirname(fileURLToPath(import.meta.url));

const ASSET_MAP = {
  'welcome-email.jpg': 'lca-welcome-email-page.jpg',
  'welcome-letterhead.jpg': 'lca-welcome-email-header.jpg',
  'welcome-letterhead-full.jpg': 'lca-welcome-email-bg.jpg',
  'welcome-header.jpg': 'lca-welcome-email-header.jpg',
};

function resolveAssetPath(fileName) {
  const candidates = [
    pathResolve(__dirname, '../assets', fileName),
    pathResolve(process.cwd(), 'assets', fileName),
    pathResolve(process.cwd(), '../frontend/public', fileName),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

/**
 * GET /api/sms/public/email-assets/:name
 * Serves welcome letterhead images for transactional email <img src>.
 */
router.get('/email-assets/:name', (req, res) => {
  const key = String(req.params.name || '').trim().toLowerCase();
  const mapped = ASSET_MAP[key];
  if (!mapped) {
    return res.status(404).json({ success: false, message: 'Asset not found' });
  }
  const filePath = resolveAssetPath(mapped);
  if (!filePath) {
    return res.status(404).json({ success: false, message: 'Asset file missing on server' });
  }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Type', 'image/jpeg');
  // Allow Gmail / email clients (cross-origin) to load this asset
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  return res.sendFile(filePath);
});

export default router;
