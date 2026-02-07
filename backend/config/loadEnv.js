import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendDir = resolve(__dirname, '..');

// Load single .env (holds both development and production DB config).
// override: true so .env wins over NODE_ENV set by PM2/shell/start script (e.g. on Linode).
dotenv.config({ path: resolve(backendDir, '.env'), override: true });

const nodeEnv = process.env.NODE_ENV || 'development';
const suffix = nodeEnv.toUpperCase(); // DEVELOPMENT or PRODUCTION

// Map DB_*_DEVELOPMENT / DB_*_PRODUCTION to DB_* based on NODE_ENV (so you only change NODE_ENV to switch DB)
const dbKeys = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SSL'];
for (const key of dbKeys) {
  const modeValue = process.env[`${key}_${suffix}`];
  if (modeValue !== undefined && modeValue !== '') {
    process.env[key] = modeValue;
  }
}

console.log(`🔧 NODE_ENV=${nodeEnv} | DB: ${process.env.DB_NAME || '(not set)'}`);
