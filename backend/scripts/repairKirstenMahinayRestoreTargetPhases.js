/**
 * Restore TARGET_PHASE 2/3/4 on Kirsten Mahinay profile 123 after auto-repair
 * incorrectly renumbered them to 1/2/3 (empty phase 1 slot is intentional).
 *
 * Run: node backend/scripts/repairKirstenMahinayRestoreTargetPhases.js [--apply]
 */
import '../config/loadEnv.js';
import pool from '../config/database.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';

const PROFILE_ID = 123;
const TARGETS = [
  { invoice_id: 311, target_phase: 2 },
  { invoice_id: 571, target_phase: 3 },
  { invoice_id: 1012, target_phase: 4 },
];

const apply = process.argv.includes('--apply');

for (const row of TARGETS) {
  const cur = await pool.query(`SELECT invoice_id, remarks FROM invoicestbl WHERE invoice_id = $1`, [
    row.invoice_id,
  ]);
  const remarks = cur.rows[0]?.remarks || '';
  const next = rewriteTargetPhaseInRemarks(remarks, row.target_phase);
  console.log(`INV-${row.invoice_id}: TARGET_PHASE:${row.target_phase}`);
  console.log(`  before: ${remarks}`);
  console.log(`  after:  ${next}`);
  if (apply) {
    await pool.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
      next,
      row.invoice_id,
    ]);
  }
}

if (!apply) {
  console.log('\nDry run — re-run with --apply to write.');
}

await pool.end();
