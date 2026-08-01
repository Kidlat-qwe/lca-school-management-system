import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendDir = resolve(__dirname, '..');
const envPath = resolve(backendDir, '.env');

/**
 * Detect Coolify only via its own env vars.
 * Do NOT use /.dockerenv or SOURCE_COMMIT — those can appear on other hosts
 * and would change Linode/PM2 behavior (.env must keep winning there).
 */
const isCoolify = Boolean(
  process.env.COOLIFY ||
    process.env.COOLIFY_RESOURCE_UUID ||
    process.env.COOLIFY_CONTAINER_NAME ||
    process.env.COOLIFY_FQDN ||
    process.env.COOLIFY_URL
);

const cliProduction = process.argv.includes('--production');
const cliDevelopment = process.argv.includes('--development');

const readNodeEnvFromFile = () => {
  if (!existsSync(envPath)) return null;
  try {
    const content = readFileSync(envPath, 'utf8');
    const match = content.match(/^\s*NODE_ENV\s*=\s*(.+?)\s*$/m);
    if (!match) return null;
    const val = match[1].trim().replace(/^["']|["']$/g, '');
    if (val === 'production' || val === 'development') return val;
  } catch (_) {
    /* ignore */
  }
  return null;
};

// Resolve NODE_ENV:
// 1) CLI --production / --development
// 2) Coolify: process.env.NODE_ENV from Coolify UI
// 3) Linode/local (unchanged): NODE_ENV from .env file (beats PM2/shell)
// 4) process.env fallback, else development
let nodeEnv = 'development';
let nodeEnvSource = 'default';

if (cliProduction && cliDevelopment) {
  console.warn('⚠️ Both --production and --development passed; using --production.');
  nodeEnv = 'production';
  nodeEnvSource = 'CLI override';
} else if (cliProduction) {
  nodeEnv = 'production';
  nodeEnvSource = 'CLI override';
} else if (cliDevelopment) {
  nodeEnv = 'development';
  nodeEnvSource = 'CLI override';
} else if (
  isCoolify &&
  (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'development')
) {
  nodeEnv = process.env.NODE_ENV;
  nodeEnvSource = 'process.env (Coolify)';
} else {
  const fromFile = readNodeEnvFromFile();
  if (fromFile) {
    nodeEnv = fromFile;
    nodeEnvSource = 'from .env file';
  } else if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'development') {
    nodeEnv = process.env.NODE_ENV;
    nodeEnvSource = 'process.env';
  }
}

// Linode/local: .env wins over shell/PM2 (override: true) — same as before.
// Coolify: UI-injected process.env wins over any generated/mounted .env.
dotenv.config({ path: envPath, override: !isCoolify });

process.env.NODE_ENV = nodeEnv;

const suffix = nodeEnv.toUpperCase();
const dbKeys = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SSL'];
for (const key of dbKeys) {
  const modeValue = process.env[`${key}_${suffix}`];
  if (modeValue !== undefined && modeValue !== '') {
    process.env[key] = modeValue;
  }
}

console.log(
  `🔧 NODE_ENV=${nodeEnv} (${nodeEnvSource}) | DB: ${process.env.DB_NAME || '(not set)'}` +
    (isCoolify ? ' | runtime=coolify' : '')
);
