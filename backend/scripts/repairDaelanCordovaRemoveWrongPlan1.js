/**
 * Daelan Cordova — remove wrong Plan 1 (profile 499 / class 167) from Student History.
 *
 * Keeps Plan on class 121 (profile 498). Cancels paid INV-2367 (audit retained),
 * deletes queue rows, deletes profile 499 so it no longer appears under Invoices.
 *
 * Run:
 *   node backend/scripts/repairDaelanCordovaRemoveWrongPlan1.js --production
 *   node backend/scripts/repairDaelanCordovaRemoveWrongPlan1.js --production --apply
 */
import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';

const STUDENT_ID = 673;
const STUDENT_EMAIL = 'gwenthampal14@gmail.com';
const REMOVE_PROFILE_ID = 499;
const REMOVE_CLASS_ID = 167;
const KEEP_PROFILE_ID = 498;
const KEEP_CLASS_ID = 121;
const PHASE1_INVOICE_ID = 2367;

const REPAIR_NOTE =
  'Ops repair 2026-08-03 — Daelan Cordova remove wrong Plan1 profile 499 (class 167); keep profile 498';

const isApply = process.argv.includes('--apply');

async function main() {
  console.log(
    `\nDaelan Cordova — remove wrong Plan 1 (profile ${REMOVE_PROFILE_ID})` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME} | NODE_ENV=${process.env.NODE_ENV}`);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error('Student not found');
    console.log('Student:', student.full_name, student.email);

    const profiles = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id AS profile_id, class_id, is_active,
                generated_count, phase_start, downpayment_invoice_id, description
         FROM installmentinvoiceprofilestbl
         WHERE student_id = $1
         ORDER BY installmentinvoiceprofiles_id`,
        [STUDENT_ID]
      )
    ).rows;
    console.log('\nProfiles BEFORE:');
    console.table(profiles);

    const remove = profiles.find((p) => Number(p.profile_id) === REMOVE_PROFILE_ID);
    const keep = profiles.find((p) => Number(p.profile_id) === KEEP_PROFILE_ID);
    if (!remove) {
      console.log(`\nProfile ${REMOVE_PROFILE_ID} already gone — nothing to do.`);
      await client.query('ROLLBACK');
      return;
    }
    if (Number(remove.class_id) !== REMOVE_CLASS_ID) {
      throw new Error(
        `Profile ${REMOVE_PROFILE_ID} class ${remove.class_id} ≠ expected ${REMOVE_CLASS_ID}`
      );
    }
    if (!keep || Number(keep.class_id) !== KEEP_CLASS_ID) {
      throw new Error(
        `Keep profile ${KEEP_PROFILE_ID} / class ${KEEP_CLASS_ID} missing — abort`
      );
    }

    const invoices = (
      await client.query(
        `SELECT invoice_id, status, amount, invoice_ar_number, remarks,
                installmentinvoiceprofiles_id AS profile_id,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
            OR invoice_id = $2
         ORDER BY invoice_id`,
        [REMOVE_PROFILE_ID, remove.downpayment_invoice_id]
      )
    ).rows.map((r) => ({
      ...r,
      phase: parseTargetPhase(r.remarks),
    }));
    console.log('\nInvoices on remove profile:');
    console.table(invoices);

    const phase1 = invoices.find((i) => Number(i.invoice_id) === PHASE1_INVOICE_ID);
    if (!phase1) {
      console.warn(`⚠ INV-${PHASE1_INVOICE_ID} not found on profile (may already be detached)`);
    }

    const queue = (
      await client.query(
        `SELECT installmentinvoicedtl_id, status, scheduled_date
         FROM installmentinvoicestbl
         WHERE installmentinvoiceprofiles_id = $1`,
        [REMOVE_PROFILE_ID]
      )
    ).rows;
    console.log('Queue rows:', queue);

    console.log('\nPlanned:');
    console.log(`  1. Cancel all invoices still linked to profile ${REMOVE_PROFILE_ID}`);
    console.log(`  2. Detach those invoices (installmentinvoiceprofiles_id → NULL)`);
    console.log(`  3. Delete installmentinvoicestbl queue for profile ${REMOVE_PROFILE_ID}`);
    console.log(`  4. Clear program_payment_statustbl for profile ${REMOVE_PROFILE_ID}`);
    console.log(`  5. DELETE profile ${REMOVE_PROFILE_ID}`);
    console.log(`  6. KEEP profile ${KEEP_PROFILE_ID} (class ${KEEP_CLASS_ID})`);

    // Cancel + detach invoices
    for (const inv of invoices) {
      if (Number(inv.profile_id) !== REMOVE_PROFILE_ID && Number(inv.invoice_id) !== PHASE1_INVOICE_ID) {
        continue;
      }
      const nextRemarks = [inv.remarks, REPAIR_NOTE].filter(Boolean).join(';');
      await client.query(
        `UPDATE invoicestbl
         SET status = CASE
               WHEN LOWER(TRIM(COALESCE(status, ''))) IN ('cancelled', 'canceled') THEN status
               ELSE 'Cancelled'
             END,
             installmentinvoiceprofiles_id = NULL,
             remarks = $1
         WHERE invoice_id = $2`,
        [nextRemarks, inv.invoice_id]
      );
      console.log(`✅ INV-${inv.invoice_id} cancelled + detached (was ${inv.status})`);
    }

    // Also cancel downpayment if still linked only via downpayment_invoice_id
    if (remove.downpayment_invoice_id) {
      const dpId = Number(remove.downpayment_invoice_id);
      if (!invoices.some((i) => Number(i.invoice_id) === dpId)) {
        await client.query(
          `UPDATE invoicestbl
           SET status = CASE
                 WHEN LOWER(TRIM(COALESCE(status, ''))) IN ('cancelled', 'canceled') THEN status
                 ELSE 'Cancelled'
               END,
               installmentinvoiceprofiles_id = NULL,
               remarks = COALESCE(remarks, '') || ';' || $1
           WHERE invoice_id = $2`,
          [REPAIR_NOTE, dpId]
        );
        console.log(`✅ Downpayment INV-${dpId} cancelled + detached`);
      }
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET downpayment_invoice_id = NULL
       WHERE installmentinvoiceprofiles_id = $1`,
      [REMOVE_PROFILE_ID]
    );

    await client.query(
      `DELETE FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1`,
      [REMOVE_PROFILE_ID]
    );
    console.log('✅ Deleted installment queue rows');

    await client.query(
      `DELETE FROM program_payment_statustbl WHERE installmentinvoiceprofiles_id = $1`,
      [REMOVE_PROFILE_ID]
    ).catch(() => {});

    await client.query(
      `DELETE FROM installmentinvoiceprofilestbl
       WHERE installmentinvoiceprofiles_id = $1
         AND student_id = $2`,
      [REMOVE_PROFILE_ID, STUDENT_ID]
    );
    console.log(`✅ Deleted profile ${REMOVE_PROFILE_ID}`);

    const afterProfiles = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id AS profile_id, class_id, is_active
         FROM installmentinvoiceprofilestbl WHERE student_id = $1
         ORDER BY installmentinvoiceprofiles_id`,
        [STUDENT_ID]
      )
    ).rows;
    console.log('\nProfiles AFTER (in txn):');
    console.table(afterProfiles);

    if (afterProfiles.some((p) => Number(p.profile_id) === REMOVE_PROFILE_ID)) {
      throw new Error('Profile still exists');
    }
    if (!afterProfiles.some((p) => Number(p.profile_id) === KEEP_PROFILE_ID)) {
      throw new Error('Keep profile missing after delete');
    }

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nRolled back (dry run). Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted. Refresh Student History → Invoices — Plan 1 (class 167) should be gone.');
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
