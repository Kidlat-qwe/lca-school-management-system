import pkg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Production (e.g. Linode): use .env on server. Development: use .env.development locally.
const envFile = process.env.NODE_ENV === 'production'
  ? resolve(__dirname, '../.env')
  : resolve(__dirname, '../.env.development');
dotenv.config({ path: envFile });

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
  connectionTimeoutMillis: 2000,
});

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
  console.error('❌ Unexpected error on idle client', err);
  process.exit(-1);
});

// Query helper function
export const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

// Get a client from the pool for transactions
export const getClient = async () => {
  const client = await pool.connect();
  return client;
};

export default pool;

