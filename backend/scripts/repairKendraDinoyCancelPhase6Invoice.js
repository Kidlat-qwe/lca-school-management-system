/**
 * Kendra Dinoy — cancel orphan Phase 6 INV-2338 (unpaid, post late-start shift).
 *
 * Run:
 *   node backend/scripts/repairKendraDinoyCancelPhase6Invoice.js --production
 *   node backend/scripts/repairKendraDinoyCancelPhase6Invoice.js --production --apply
 */
import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';

const STUDENT_ID = 536;
const PROFILE_ID = 325;
const INVOICE_ID = 2338;
const EXPECTED_PHASE = 6;
const REPAIR_NOTE =
  'Ops repair 2026-08-03 — Kendra Dinoy cancel orphan Phase 6 INV-2338 after late-start shift';

const isApply = process.argv.includes('--apply');

async function main() {
  console.log(
    `\nKendra Dinoy — cancel Phase 6 INV-${INVOICE_ID}` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME} | NODE_ENV=${process.env.NODE_ENV}`);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const inv = (
      await client.query(
        `SELECT invoice_id, status, amount, invoice_ar_number, remarks,
                installmentinvoiceprofiles_id AS profile_id,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date, 'YYYY-MM-DD') AS due
         FROM invoicestbl
         WHERE invoice_id = $1`,
        [INVOICE_ID]
      )
    ).rows[0];
    if (!inv) throw new Error(`INV-${INVOICE_ID} not found`);
    if (Number(inv.profile_id) !== PROFILE_ID) {
      throw new Error(`INV-${INVOICE_ID} profile ${inv.profile_id} ≠ ${PROFILE_ID}`);
    }

    const phase = parseTargetPhase(inv.remarks);
    const payments = (
      await client.query(
        `SELECT payment_id, status, approval_status, payable_amount
         FROM paymenttbl WHERE invoice_id = $1`,
        [INVOICE_ID]
      )
    ).rows;

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, generated_count, is_active
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    console.log('BEFORE invoice:', inv, '| TARGET_PHASE:', phase);
    console.log('Payments:', payments);
    console.log('BEFORE profile:', profile);

    if (String(inv.status).toLowerCase() === 'cancelled' || String(inv.status).toLowerCase() === 'canceled') {
      console.log('Already cancelled — nothing to do.');
      await client.query('ROLLBACK');
      return;
    }

    if (payments.some((p) => String(p.status) === 'Completed' && String(p.approval_status || '') !== 'Rejected')) {
      throw new Error('INV has completed payments — refuse to cancel');
    }

    if (phase != null && phase !== EXPECTED_PHASE) {
      console.warn(`⚠ TARGET_PHASE is ${phase}, expected ${EXPECTED_PHASE}`);
    }

    const nextGenerated = Math.max(0, Number(profile.generated_count || 0) - 1);

    console.log('\nPlanned:');
    console.log(`  1. INV-${INVOICE_ID} status → Cancelled`);
    console.log(`  2. Detach from profile (installmentinvoiceprofiles_id → NULL)`);
    console.log(`  3. profile.generated_count ${profile.generated_count} → ${nextGenerated}`);

    const nextRemarks = [inv.remarks, REPAIR_NOTE].filter(Boolean).join(';');

    await client.query(
      `UPDATE invoicestbl
       SET status = 'Cancelled',
           installmentinvoiceprofiles_id = NULL,
           remarks = $1
       WHERE invoice_id = $2
         AND installmentinvoiceprofiles_id = $3`,
      [nextRemarks, INVOICE_ID, PROFILE_ID]
    );

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = $1
       WHERE installmentinvoiceprofiles_id = $2`,
      [nextGenerated, PROFILE_ID]
    );

    const afterInv = (
      await client.query(
        `SELECT invoice_id, status, installmentinvoiceprofiles_id, LEFT(remarks, 120) AS remarks
         FROM invoicestbl WHERE invoice_id = $1`,
        [INVOICE_ID]
      )
    ).rows[0];
    const afterProfile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, generated_count
         FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    const remaining = await client.query(
      `SELECT invoice_id, status,
              SUBSTRING(remarks FROM 'TARGET_PHASE:([0-9]+)') AS phase
       FROM invoicestbl
       WHERE installmentinvoiceprofiles_id = $1
         AND remarks ILIKE '%TARGET_PHASE:%'
         AND COALESCE(status, '') NOT IN ('Cancelled', 'Canceled')
       ORDER BY SUBSTRING(remarks FROM 'TARGET_PHASE:([0-9]+)')::int`,
      [PROFILE_ID]
    );

    console.log('\nAFTER invoice:', afterInv);
    console.log('AFTER profile:', afterProfile);
    console.log('Remaining phase invoices on profile:');
    console.table(remaining.rows);

    if (afterInv.status !== 'Cancelled' || afterInv.installmentinvoiceprofiles_id != null) {
      throw new Error('Cancel/detach validation failed');
    }
    if (Number(afterProfile.generated_count) !== nextGenerated) {
      throw new Error('generated_count validation failed');
    }
    if (remaining.rows.some((r) => Number(r.invoice_id) === INVOICE_ID)) {
      throw new Error('INV still linked to profile');
    }
    if (remaining.rows.some((r) => Number(r.phase) === 6)) {
      throw new Error('Another Phase 6 invoice still on profile');
    }

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nRolled back (dry run). Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted. Phase 6 row should show Not Generated after refresh.');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\n❌ Repair failed:', err?.message || err);
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
