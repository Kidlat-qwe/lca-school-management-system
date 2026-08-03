import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve('backend/.env');
if (!existsSync(envPath)) {
  console.error('backend/.env not found');
  process.exit(1);
}

const text = readFileSync(envPath, 'utf8');

const get = (key) => {
  const match = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!match) return null;
  let value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
};

const projectIdEnv = get('FIREBASE_PROJECT_ID');
const apiKey = get('FIREBASE_API_KEY');
const adminPath = get('FIREBASE_ADMIN_SDK_PATH');

let projectId = projectIdEnv;
let clientEmail = get('FIREBASE_CLIENT_EMAIL');
let privateKey = get('FIREBASE_PRIVATE_KEY');

if (adminPath) {
  const candidates = [
    resolve(adminPath),
    resolve('backend', adminPath),
    resolve('backend', adminPath.replace(/^\.\//, '')),
    resolve('backend/config', adminPath.split(/[\\/]/).pop()),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const json = JSON.parse(readFileSync(candidate, 'utf8'));
    projectId = projectId || json.project_id || null;
    clientEmail = clientEmail || json.client_email || null;
    privateKey = privateKey || json.private_key || null;
    console.error(`Loaded Admin SDK JSON: ${candidate}`);
    break;
  }
}

if (privateKey) {
  privateKey = privateKey.replace(/\\n/g, '\n');
}

console.log('=== Paste into Coolify backend Environment Variables ===\n');
console.log(`FIREBASE_PROJECT_ID=${projectId || ''}`);
console.log(`FIREBASE_CLIENT_EMAIL=${clientEmail || ''}`);
if (apiKey) console.log(`FIREBASE_API_KEY=${apiKey}`);

if (!privateKey || !privateKey.includes('BEGIN PRIVATE KEY')) {
  console.error('\nCould not find a valid private_key.');
  console.error('Download a new service account JSON from Firebase Console and set FIREBASE_ADMIN_SDK_PATH, or place the JSON under backend/config/.');
  process.exit(2);
}

const b64 = Buffer.from(privateKey, 'utf8').toString('base64');
console.log(`FIREBASE_PRIVATE_KEY_BASE64=${b64}`);
console.log('\n# Delete FIREBASE_PRIVATE_KEY from Coolify if it exists.');
console.log('# Do not set FIREBASE_ADMIN_SDK_PATH on Coolify (JSON file is not in the image).');

const out = resolve('backend/.env.coolify.firebase');
writeFileSync(
  out,
  [
    `FIREBASE_PROJECT_ID=${projectId || ''}`,
    `FIREBASE_CLIENT_EMAIL=${clientEmail || ''}`,
    apiKey ? `FIREBASE_API_KEY=${apiKey}` : null,
    `FIREBASE_PRIVATE_KEY_BASE64=${b64}`,
    '',
    '# Delete FIREBASE_PRIVATE_KEY from Coolify. Use BASE64 only.',
    '# Do not set FIREBASE_ADMIN_SDK_PATH on Coolify.',
  ]
    .filter((line) => line !== null)
    .join('\n'),
  'utf8'
);
console.error(`\nAlso wrote ${out} (gitignored via .env* pattern? check — do not commit)`);
