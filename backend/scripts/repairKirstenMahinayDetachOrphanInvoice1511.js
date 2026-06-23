/**
 * Detach cancelled orphan INV-1511 from profile 123 so it cannot fill phase slot 1
 * via billing-order fallback (duplicate TARGET_PHASE:4 with INV-1012).
 *
 * Run: node backend/scripts/repairKirstenMahinayDetachOrphanInvoice1511.js [--apply]
 */
import '../config/loadEnv.js';
import pool from '../config/database.js';

const PROFILE_ID = 123;
const ORPHAN_INVOICE_ID = 1511;
const apply = process.argv.includes('--apply');

const before = await pool.query(
  `SELECT invoice_id, status, installmentinvoiceprofiles_id, remarks
   FROM invoicestbl WHERE invoice_id = $1`,
  [ORPHAN_INVOICE_ID]
);
console.log('Before:', before.rows[0]);

if (!apply) {
  console.log('\nDry run — would detach INV-1511 from profile and strip TARGET_PHASE from remarks.');
  await pool.end();
  process.exit(0);
}

const res = await pool.query(
  `UPDATE invoicestbl
   SET installmentinvoiceprofiles_id = NULL,
       remarks = REGEXP_REPLACE(COALESCE(remarks, ''), ';?TARGET_PHASE:\\d+', '', 'g')
   WHERE invoice_id = $1
     AND installmentinvoiceprofiles_id = $2
     AND status = 'Cancelled'
   RETURNING invoice_id, status, installmentinvoiceprofiles_id, remarks`,
  [ORPHAN_INVOICE_ID, PROFILE_ID]
);
console.log('After:', res.rows[0] || '(no row updated)');

await pool.end();
