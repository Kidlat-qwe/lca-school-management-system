/**
 * Semaphore.co SMS gateway (Philippines).
 * @see https://semaphore.co/docs
 */
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

const SEMAPHORE_API_URL =
  (process.env.SEMAPHORE_API_URL || 'https://api.semaphore.co/api/v4/messages').trim();
const SEMAPHORE_API_KEY = (process.env.SEMAPHORE_API_KEY || '').trim();
const SEMAPHORE_SENDER_NAME = (process.env.SEMAPHORE_SENDER_NAME || '').trim();
const SMS_NOTIFICATIONS_ENABLED = process.env.SMS_NOTIFICATIONS_ENABLED !== 'false';

/**
 * Normalize PH mobile to Semaphore format (63XXXXXXXXXX).
 * @returns {string|null}
 */
export function normalizePhilippineMobile(raw) {
  if (raw == null) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith('63')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  if (digits.length === 10 && digits.startsWith('9')) {
    return `63${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('9')) {
    return `63${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('639')) {
    return digits;
  }

  return null;
}

export function collectPhilippineMobiles(...values) {
  const seen = new Set();
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const n = normalizePhilippineMobile(item);
        if (n) seen.add(n);
      }
    } else {
      const n = normalizePhilippineMobile(value);
      if (n) seen.add(n);
    }
  }
  return [...seen];
}

export function isSemaphoreConfigured() {
  return SMS_NOTIFICATIONS_ENABLED && Boolean(SEMAPHORE_API_KEY);
}

function extractSemaphoreErrorMessage(data, httpStatus) {
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === 'object') {
        const fieldMsg = Object.values(item).find((v) => typeof v === 'string' && v.trim());
        if (fieldMsg) return fieldMsg.trim();
      }
    }
    if (data[0]?.message) return String(data[0].message);
  }
  if (data?.message) return String(data.message);
  if (data?.error) return String(data.error);
  return `Semaphore HTTP ${httpStatus}`;
}

/**
 * @param {{ numbers: string|string[], message: string, sendername?: string }} params
 */
export async function sendSemaphoreSms({ numbers, message, sendername }) {
  if (!isSemaphoreConfigured()) {
    return {
      success: false,
      skipped: true,
      reason: 'semaphore_not_configured',
    };
  }

  const normalized = collectPhilippineMobiles(numbers);
  if (normalized.length === 0) {
    return { success: false, skipped: true, reason: 'no_valid_phone_numbers' };
  }

  const text = String(message || '').trim();
  if (!text) {
    return { success: false, skipped: true, reason: 'empty_message' };
  }
  if (/^TEST\b/i.test(text)) {
    return { success: false, skipped: true, reason: 'test_message_blocked' };
  }

  const sender = (sendername || SEMAPHORE_SENDER_NAME || '').trim();

  const body = new URLSearchParams();
  body.set('apikey', SEMAPHORE_API_KEY);
  body.set('number', normalized.join(','));
  body.set('message', text);
  // Omit sendername when unset — Semaphore uses the account default (avoids 500 from invalid custom sender).
  if (sender) {
    body.set('sendername', sender);
  }

  let response;
  let rawText = '';
  try {
    response = await fetch(SEMAPHORE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    rawText = await response.text();
  } catch (netErr) {
    console.error('[semaphoreSms] Network error:', netErr?.message || netErr);
    return {
      success: false,
      error: netErr?.message || 'Network error contacting SMS provider',
      reason: 'network_error',
    };
  }

  let data;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = rawText;
  }

  if (!response.ok) {
    const errMsg = extractSemaphoreErrorMessage(data, response.status);
    console.error('[semaphoreSms] API error:', {
      status: response.status,
      errMsg,
      raw: typeof data === 'string' ? data.slice(0, 500) : data,
      recipients: normalized,
      sender: sender || '(account default)',
    });
    return {
      success: false,
      error: errMsg,
      httpStatus: response.status,
      reason: 'semaphore_api_error',
    };
  }

  console.log('[semaphoreSms] Sent:', {
    recipients: normalized.length,
    sender: sender || '(account default)',
    preview: text.slice(0, 80),
  });

  return {
    success: true,
    recipients: normalized,
    response: data,
  };
}
