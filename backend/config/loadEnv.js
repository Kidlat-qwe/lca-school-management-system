import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendDir = resolve(__dirname, '..');

// 1) Load base .env first (sets NODE_ENV and any shared vars)
dotenv.config({ path: resolve(backendDir, '.env') });

// 2) Load env file by NODE_ENV so DB/Firebase/AWS etc. match development or production
const nodeEnv = process.env.NODE_ENV || 'development';
const envFile = resolve(backendDir, `.env.${nodeEnv}`);
if (existsSync(envFile)) {
  dotenv.config({ path: envFile });
}
// If .env.development or .env.production is missing, process.env still has .env values
