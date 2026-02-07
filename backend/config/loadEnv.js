import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendDir = resolve(__dirname, '..');

// 1) Load base .env first (sets NODE_ENV and any shared vars)
dotenv.config({ path: resolve(backendDir, '.env') });

// 2) Load env file by NODE_ENV (mode-specific)
const nodeEnv = process.env.NODE_ENV || 'development';
const envFile = resolve(backendDir, `.env.${nodeEnv}`);
if (existsSync(envFile)) {
  dotenv.config({ path: envFile });
}

// 3) In development only: load .env again so local .env can override (e.g. use production DB from .env). In production, .env.production is final so deployed app always uses psms_production.
if (nodeEnv !== 'production') {
  dotenv.config({ path: resolve(backendDir, '.env') });
}

console.log(`🔧 Env: ${nodeEnv} | DB: ${process.env.DB_NAME || '(not set)'}`);
