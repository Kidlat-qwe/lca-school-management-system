/**
 * Julla Santos Rojas (lady.louelle.rojas@gmail.com, user 590) —
 * Undrop Phase 3, fix Phase 3 issue/due, ungenerate Phase 4.
 *
 * Class 83 KG_1-3PM · Profile 462 · Guiguinto (5)
 *
 * Current:
 *   P3 CS 2605 dropped (delinquency on due Aug 5)
 *   INV-2478 Unpaid issue Jul 25 / due Aug 5, amount ₱5,802.50 (+10% penalty)
 *   INV-2556 Phase 4 Unpaid (premature) issue Aug 25 / due Sep 5
 *   generated_count 4 · profile is_active false
 *
 * Target:
 *   P3 enrollment re_enrolled (not dropped)
 *   INV-2478 issue 2026-08-25 / due 2026-09-05, amount ₱5,275 (no penalty)
 *   Phase 4 Not Generated (cancel + detach INV-2556)
 *   generated_count 3 · is_active true
 *   Queue next_generation 2026-09-25 / next_invoice_month 2026-10-01
 *
 * Run (from backend/):
 *   node scripts/repairJullaRojasPhase3UndropUngenerate4.js --production
 *   node scripts/repairJullaRojasPhase3UndropUngenerate4.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 590;
const STUDENT_EMAIL = 'lady.louelle.rojas@gmail.com';
const CLASS_ID = 83;
const PROFILE_ID = 462;
const PHASE3_CS_ID = 2605;
const PHASE3_INVOICE_ID = 2478;
const PHASE4_INVOICE_ID = 2556;

const PHASE3_ISSUE = '2026-08-25';
const PHASE3_DUE = '2026-09-05';
const PHASE_FEE = 5275;
const EXPECTED_GENERATED_COUNT = 3;
const NEXT_GEN = '2026-09-25';
const NEXT_MONTH = '2026-10-01';

const REPAIR_NOTE =
  'Ops repair 2026-09-08 — Julla Rojas undrop P3 (issue Aug 25 / due Sep 5); cancel premature P4; clear P3 penalty';

const isApply = process.argv.includes('--apply');

function appendNote(existing, note, maxLen = 2000) {
  const cur = String(existing || '').trim();
  const add = String(note || '').trim();
  if (!add) return cur || null;
  if (cur.toLowerCase().includes(add.toLowerCase())) return cur;
  if (!cur) return add.length <= maxLen ? add : add.slice(0, maxLen);
  const joined = `${cur};${add}`;
  if (joined.length <= maxLen) return joined;
  return cur.length <= maxLen ? cur : cur.slice(0, maxLen);
}

async function main() {
  console.log(
    `\nJulla Rojas — undrop P3 + ungenerate P4${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const student = (
      await client.query(
        `SELECT user_id, full_name, email
         FROM userstbl
         WHERE user_id = $1
           AND LOWER(TRIM(email)) = LOWER(TRIM($2))
           AND user_type = 'Student'`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error('Student not found');
    console.log(`Student: ${student.full_name} (${student.email})`);

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, class_id, generated_count, is_active, amount::text
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND student_id = $2
           AND class_id = $3`,
        [PROFILE_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);
    console.log('Profile before:', profile);

    const p3Inv = (
      await client.query(
        `SELECT invoice_id, status, remarks, amount::text,
                TO_CHAR(issue_date,'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date,'YYYY-MM-DD') AS due,
                installmentinvoiceprofiles_id
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE3_INVOICE_ID]
      )
    ).rows[0];
    if (!p3Inv) throw new Error(`INV-${PHASE3_INVOICE_ID} missing`);
    if (Number(p3Inv.installmentinvoiceprofiles_id) !== PROFILE_ID) {
      throw new Error('Phase 3 invoice not on expected profile');
    }
    if (parseTargetPhase(p3Inv.remarks) !== 3) {
      throw new Error(`INV-${PHASE3_INVOICE_ID} is not TARGET_PHASE:3`);
    }
    if (String(p3Inv.status) === 'Paid') {
      throw new Error(`INV-${PHASE3_INVOICE_ID} is Paid — abort`);
    }
    const p3Pays = (
      await client.query(
        `SELECT payment_id FROM paymenttbl
         WHERE invoice_id = $1 AND status = 'Completed'`,
        [PHASE3_INVOICE_ID]
      )
    ).rows;
    if (p3Pays.length) {
      throw new Error(`INV-${PHASE3_INVOICE_ID} has completed payments — abort`);
    }

    const p4Inv = (
      await client.query(
        `SELECT invoice_id, status, remarks, installmentinvoiceprofiles_id,
                TO_CHAR(issue_date,'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date,'YYYY-MM-DD') AS due
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE4_INVOICE_ID]
      )
    ).rows[0];
    if (!p4Inv) throw new Error(`INV-${PHASE4_INVOICE_ID} missing`);
    if (Number(p4Inv.installmentinvoiceprofiles_id) !== PROFILE_ID) {
      throw new Error('Phase 4 invoice not on expected profile');
    }
    if (parseTargetPhase(p4Inv.remarks) !== 4) {
      throw new Error(`INV-${PHASE4_INVOICE_ID} is not TARGET_PHASE:4`);
    }
    const p4Pays = (
      await client.query(
        `SELECT payment_id FROM paymenttbl
         WHERE invoice_id = $1 AND status = 'Completed'`,
        [PHASE4_INVOICE_ID]
      )
    ).rows;
    if (p4Pays.length) {
      throw new Error(`INV-${PHASE4_INVOICE_ID} has completed payments — abort`);
    }

    const cs = (
      await client.query(
        `SELECT classstudent_id, program_enrollment_status, removed_reason, enrolled_by
         FROM classstudentstbl
         WHERE classstudent_id = $1 AND student_id = $2 AND class_id = $3 AND phase_number = 3`,
        [PHASE3_CS_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!cs) throw new Error(`Missing Phase 3 CS ${PHASE3_CS_ID}`);
    if (String(cs.program_enrollment_status) !== 'dropped') {
      throw new Error(`CS ${PHASE3_CS_ID} status is ${cs.program_enrollment_status}, expected dropped`);
    }

    console.log('\nBefore:');
    console.log(`  P3 CS ${PHASE3_CS_ID}: dropped`);
    console.log(`  INV-${PHASE3_INVOICE_ID}: ${p3Inv.issue}/${p3Inv.due} amount ${p3Inv.amount} (${p3Inv.status})`);
    console.log(`  INV-${PHASE4_INVOICE_ID}: ${p4Inv.issue}/${p4Inv.due} (${p4Inv.status})`);

    // 1) Undrop Phase 3 enrollment → re_enrolled
    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 're_enrolled',
           enrolled_at = $1::timestamp,
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL,
           enrolled_by = $2
       WHERE classstudent_id = $3`,
      [
        `${PHASE3_ISSUE} 12:00:00`,
        appendNote(cs.enrolled_by, REPAIR_NOTE, 255),
        PHASE3_CS_ID,
      ]
    );
    console.log(`→ CS ${PHASE3_CS_ID}: dropped → re_enrolled`);

    // 2) Fix Phase 3 dates + clear penalty → fee 5275
    await client.query(
      `DELETE FROM invoiceitemstbl
       WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
      [PHASE3_INVOICE_ID]
    );
    const itemCount = (
      await client.query(
        `SELECT COUNT(*)::int AS n FROM invoiceitemstbl WHERE invoice_id = $1`,
        [PHASE3_INVOICE_ID]
      )
    ).rows[0].n;
    if (itemCount === 0) {
      await client.query(
        `INSERT INTO invoiceitemstbl
           (invoice_id, description, amount, tax_item, tax_percentage, discount_amount, penalty_amount)
         VALUES ($1, $2, $3, NULL, 0, 0, 0)`,
        [
          PHASE3_INVOICE_ID,
          'Installment plan for Julla Santos Rojas - Kindergarten',
          PHASE_FEE,
        ]
      );
    } else {
      await client.query(
        `UPDATE invoiceitemstbl
         SET amount = $1, penalty_amount = 0, discount_amount = COALESCE(discount_amount, 0)
         WHERE invoice_id = $2
           AND description ILIKE 'Installment plan%'`,
        [PHASE_FEE, PHASE3_INVOICE_ID]
      );
    }
    await client.query(
      `UPDATE invoicestbl
       SET issue_date = $1::date,
           due_date = $2::date,
           amount = $3,
           status = 'Unpaid',
           late_penalty_applied_for_due_date = NULL,
           remarks = $4
       WHERE invoice_id = $5`,
      [
        PHASE3_ISSUE,
        PHASE3_DUE,
        PHASE_FEE,
        appendNote(p3Inv.remarks, REPAIR_NOTE),
        PHASE3_INVOICE_ID,
      ]
    );
    await syncProgramPaymentStatusForInvoice(client, PHASE3_INVOICE_ID);
    console.log(
      `→ INV-${PHASE3_INVOICE_ID}: issue/due → ${PHASE3_ISSUE}/${PHASE3_DUE}, amount ₱${PHASE_FEE}`
    );

    // 3) Cancel Phase 4
    await client.query(
      `UPDATE invoicestbl
       SET status = 'Cancelled',
           installmentinvoiceprofiles_id = NULL,
           remarks = $1
       WHERE invoice_id = $2
         AND installmentinvoiceprofiles_id = $3`,
      [appendNote(p4Inv.remarks, REPAIR_NOTE), PHASE4_INVOICE_ID, PROFILE_ID]
    );
    await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [
      PHASE4_INVOICE_ID,
    ]);
    console.log(`→ Cancelled + detached INV-${PHASE4_INVOICE_ID}`);

    // Remove any Phase 4 enrollment rows if present
    const p4Enrolls = (
      await client.query(
        `SELECT classstudent_id FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND phase_number = 4`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;
    for (const row of p4Enrolls) {
      await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
        row.classstudent_id,
      ]);
      console.log(`→ DELETE Phase 4 CS ${row.classstudent_id}`);
    }

    // 4) Profile + queue
    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = $1,
           is_active = true
       WHERE installmentinvoiceprofiles_id = $2`,
      [EXPECTED_GENERATED_COUNT, PROFILE_ID]
    );
    console.log(`→ generated_count → ${EXPECTED_GENERATED_COUNT}, is_active=true`);

    const dtl = (
      await client.query(
        `SELECT installmentinvoicedtl_id
         FROM installmentinvoicestbl
         WHERE installmentinvoiceprofiles_id = $1
         ORDER BY installmentinvoicedtl_id DESC
         LIMIT 1`,
        [PROFILE_ID]
      )
    ).rows[0];
    if (!dtl) throw new Error('No installment queue row');
    await client.query(
      `UPDATE installmentinvoicestbl
       SET next_generation_date = $1::date,
           next_invoice_month = $2::date,
           scheduled_date = $1::date
       WHERE installmentinvoicedtl_id = $3
         AND installmentinvoiceprofiles_id = $4`,
      [NEXT_GEN, NEXT_MONTH, dtl.installmentinvoicedtl_id, PROFILE_ID]
    );
    console.log(`→ Queue → ${NEXT_GEN} / ${NEXT_MONTH}`);

    // Verify
    const csAfter = (
      await client.query(
        `SELECT program_enrollment_status, removed_at
         FROM classstudentstbl WHERE classstudent_id = $1`,
        [PHASE3_CS_ID]
      )
    ).rows[0];
    const inv3After = (
      await client.query(
        `SELECT TO_CHAR(issue_date,'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date,'YYYY-MM-DD') AS due,
                amount::text, status
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE3_INVOICE_ID]
      )
    ).rows[0];
    const inv4After = (
      await client.query(
        `SELECT status, installmentinvoiceprofiles_id FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE4_INVOICE_ID]
      )
    ).rows[0];
    const profileAfter = (
      await client.query(
        `SELECT generated_count, is_active FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    console.log('\nAfter (in transaction):');
    console.log('  P3 enrollment:', csAfter);
    console.log('  INV-2478:', inv3After);
    console.log('  INV-2556:', inv4After);
    console.log('  Profile:', profileAfter);

    if (String(csAfter.program_enrollment_status) !== 're_enrolled' || csAfter.removed_at) {
      throw new Error('Phase 3 still dropped');
    }
    if (inv3After.issue !== PHASE3_ISSUE || inv3After.due !== PHASE3_DUE) {
      throw new Error('Phase 3 dates mismatch');
    }
    if (Math.abs(Number(inv3After.amount) - PHASE_FEE) > 0.05) {
      throw new Error(`Phase 3 amount ${inv3After.amount} != ${PHASE_FEE}`);
    }
    if (!/^cancell?ed$/i.test(String(inv4After.status)) || inv4After.installmentinvoiceprofiles_id != null) {
      throw new Error('Phase 4 not cancelled/detached');
    }
    if (Number(profileAfter.generated_count) !== EXPECTED_GENERATED_COUNT || !profileAfter.is_active) {
      throw new Error('Profile generated_count / is_active mismatch');
    }

    console.log('\n✅ Checks passed.');

    if (isApply) {
      await client.query('COMMIT');
      console.log('\nCommitted.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run — rolled back. Re-run with --apply to commit.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFailed:', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
