/**
 * Ensures cash_deposit_summarytbl has optional second attachment + submission remarks columns.
 * Idempotent — safe to call on every write path if migration 121 was not applied yet.
 */
import { query } from '../config/database.js';

let ensured = false;
let ensurePromise = null;

export async function ensureCashDepositSummaryExtendedColumns() {
  if (ensured) return;
  if (ensurePromise) {
    await ensurePromise;
    return;
  }

  ensurePromise = (async () => {
    await query(`
      ALTER TABLE public.cash_deposit_summarytbl
        ADD COLUMN IF NOT EXISTS deposit_attachment_url_2 TEXT,
        ADD COLUMN IF NOT EXISTS submission_remarks TEXT
    `);
    ensured = true;
  })();

  try {
    await ensurePromise;
  } catch (error) {
    ensurePromise = null;
    throw error;
  }
}

/**
 * Reset cached flag (tests only).
 */
export function resetCashDepositSummarySchemaCacheForTests() {
  ensured = false;
  ensurePromise = null;
}
