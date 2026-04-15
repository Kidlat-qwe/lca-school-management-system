/**
 * Bulk-update all class session schedules to match current sessionCalculation rules
 * (weekday pattern, holidays, continuous inter-phase dates, etc.).
 *
 * This delegates to the same logic as:
 *   node backend/scripts/fixPhaseSessionDates.js --all
 *
 * Usage (from project root):
 *   node backend/scripts/updateAllClassSessionSchedules.js --dry-run
 *   node backend/scripts/updateAllClassSessionSchedules.js
 *
 * Options:
 *   --dry-run   Preview changes only; no database updates.
 */

import '../config/loadEnv.js';
import { runFixAllClassSessionDates } from './fixPhaseSessionDates.js';

const dryRun = process.argv.includes('--dry-run');

runFixAllClassSessionDates(dryRun)
  .then((summary) => {
    if (summary.failures > 0) process.exit(1);
  })
  .catch((err) => {
    console.error('❌ Script failed:', err);
    process.exit(1);
  });
