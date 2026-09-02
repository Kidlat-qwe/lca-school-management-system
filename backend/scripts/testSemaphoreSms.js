/**
 * Quick Semaphore SMS test (OTP-style message).
 * Usage: node scripts/testSemaphoreSms.js 09171234567
 */
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const number = process.argv[2];
if (!number) {
  console.error('Usage: node scripts/testSemaphoreSms.js <mobile e.g. 09171234567>');
  process.exit(1);
}

const { isSemaphoreConfigured, sendSemaphoreSms, normalizePhilippineMobile } = await import(
  '../utils/sms/semaphoreSmsService.js'
);

const normalized = normalizePhilippineMobile(number);
if (!normalized) {
  console.error('Invalid PH mobile:', number);
  process.exit(1);
}

console.log('Configured:', isSemaphoreConfigured());
console.log('Sender env:', process.env.SEMAPHORE_SENDER_NAME || '(account default)');
console.log('Sending to:', normalized);

const result = await sendSemaphoreSms({
  numbers: normalized,
  message: 'LCA CMS test: code 123456 — verify AutoPay. Valid 10 min.',
});

console.log(JSON.stringify(result, null, 2));
process.exit(result.success ? 0 : 1);
