import pkg from 'pg';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Env is loaded by loadEnv.js ( .env then .env.${NODE_ENV} ) before this module runs
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Pool } = pkg;

// Determine if SSL is required (Neon and other cloud databases require SSL)
// Auto-detect: if host contains 'neon', 'aws', or is not 'localhost', enable SSL
const dbHost = process.env.DB_HOST || 'localhost';
const isCloudDatabase = dbHost.includes('neon') || 
                        dbHost.includes('aws') || 
                        dbHost.includes('amazonaws') ||
                        dbHost !== 'localhost';
const useSSL = process.env.DB_SSL !== undefined 
  ? process.env.DB_SSL === 'true' 
  : isCloudDatabase;

const pool = new Pool({
  host: dbHost,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'psms_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
});

const attachClientErrorHandler = (client) => {
  client.on('error', (err) => {
    console.error('❌ Database client connection error (will be discarded from pool):', err.message);
  });
  return client;
};

// Neon pooler uses an empty search_path on some databases (e.g. freshly restored test_psms_db).
// Startup option search_path is blocked on pooler, so set it per acquired client instead.
async function acquireClient() {
  const client = attachClientErrorHandler(await pool.connect());
  await client.query('SET search_path TO public');
  return client;
}

// Log database connection info (without sensitive data)
console.log('📊 Database Configuration:', {
  host: dbHost,
  database: process.env.DB_NAME || 'psms_db',
  port: process.env.DB_PORT || 5432,
  ssl: useSSL,
  user: process.env.DB_USER || 'postgres',
});

// Test database connection
pool.on('connect', () => {
  console.log('✅ Database connected successfully');
});

pool.on('error', (err) => {
  // Log only — do not exit. Cloud DBs (e.g. Neon) may drop idle connections; the pool recreates them.
  console.error('❌ Unexpected error on idle pool client:', err.message);
});

const isRetriableConnectionError = (error) => {
  const msg = String(error?.message || '').toLowerCase();
  return (
    msg.includes('connection terminated') ||
    msg.includes('connection terminated unexpectedly') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('socket hang up')
  );
};

// Query helper function
export const query = async (text, params) => {
  const start = Date.now();
  let client;
  try {
    client = await acquireClient();
    const res = await client.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    if (client && isRetriableConnectionError(error)) {
      try {
        client.release(true);
      } catch {
        /* ignore release errors on dead client */
      }
      client = null;
      const retryClient = await acquireClient();
      try {
        const res = await retryClient.query(text, params);
        const duration = Date.now() - start;
        console.log('Executed query (retry)', { text, duration, rows: res.rowCount });
        return res;
      } finally {
        retryClient.release();
      }
    }
    console.error('Database query error:', error);
    throw error;
  } finally {
    if (client) client.release();
  }
};

// Get a client from the pool for transactions
export const getClient = acquireClient;

export default pool;

