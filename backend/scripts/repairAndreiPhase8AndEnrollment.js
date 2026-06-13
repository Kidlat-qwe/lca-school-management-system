/**
 * Repair Andrei phase 8 invoice status + remove erroneous phase 10 enrollment.
 *
 * Run:  node scripts/repairAndreiPhase8AndEnrollment.js --dry-run
 * Apply: node scripts/repairAndreiPhase8AndEnrollment.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { deriveInvoiceStatusForInvoice } from '../utils/invoicePaymentStatus.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 247;
const CLASS_ID = 58;
const INV_773 = 773;
const PHASE10_CLASSSTUDENT_ID = 1095;

const isDryRun = !process.argv.includes('--apply');

async function sumSettlement(client, invoiceId) {
  const r = await client.query(
    `SELECT COALESCE(SUM(COALESCE(payable_amount, 0) + COALESCE(discount_amount, 0)), 0) AS total
     FROM paymenttbl
     WHERE invoice_id = $1
       AND status = 'Completed'
       AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
    [invoiceId]
  );
  return parseFloat(r.rows[0]?.total) || 0;
}

async function main() {
  console.log(`\nRepair Andrei phase 8 + enrollment${isDryRun ? ' (DRY RUN)' : ' (APPLY)'}\n`);

  const client = await getClient();
  try {
    const inv = await client.query(
      `SELECT invoice_id, status, amount FROM invoicestbl WHERE invoice_id = $1`,
      [INV_773]
    );
    const settled773 = await sumSettlement(client, INV_773);
    const settled774 = await sumSettlement(client, 774);
    console.log('INV-773:', inv.rows[0], 'settled on 773:', settled773, 'on 774:', settled774);

    const phase10 = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status
       FROM classstudentstbl WHERE classstudent_id = $1`,
      [PHASE10_CLASSSTUDENT_ID]
    );
    console.log('Phase 10 row:', phase10.rows[0]);

    if (isDryRun) {
      console.log('\nWould: set INV-773 status Paid; delete phase 10 enrollment row');
      return;
    }

    await client.query('BEGIN');

    const newStatus = await deriveInvoiceStatusForInvoice(client, INV_773, {
      totalSettled: settled773,
      originalInvoiceAmount: inv.rows[0]?.amount ?? 0,
      previousStatus: inv.rows[0]?.status,
    });
    await client.query(`UPDATE invoicestbl SET status = $1 WHERE invoice_id = $2`, [
      newStatus,
      INV_773,
    ]);
    await syncProgramPaymentStatusForInvoice(client, INV_773);
    await syncProgramPaymentStatusForInvoice(client, 774);

    await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
      PHASE10_CLASSSTUDENT_ID,
    ]);

    await client.query('COMMIT');
    console.log(`✅ INV-773 status -> ${newStatus}`);
    console.log('✅ Deleted erroneous phase 10 enrollment row');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
