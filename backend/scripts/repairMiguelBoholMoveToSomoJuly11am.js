/**
 * Miguel Sebastian C. Bohol — point installment plan at July class + Phase 2 dates.
 *
 * Student: 78 · carlosgeline26@gmail.com
 * Profile: 54 (inactive) still on class 37 SOMO_Pre-Kinder_MWF_9:30-10:30AM
 * UI Move Student already put CS 1518 (phase 1 new) on class 95
 *   SOMO_JULY_Pre-Kinder_MWF 11 AM. Inactive profiles are not updated by
 *   POST /classes/move-student, so Student History still shows the old class.
 *
 * Scope (--apply):
 *   1. Profile 54 class_id 37 → 95 (keep is_active = false)
 *   2. Retag invoice remarks CLASS_ID:37 → CLASS_ID:95
 *   3. Phase 2 INV-1927 issue/due → 2026-07-25 / 2026-08-05
 *
 * Leave class 37 dropped Phase 2 row (CS 1721) as history.
 * Leave Phase 1 INV-1850 dates/payment, unpaid amount, and Inactive plan.
 *
 * Run:
 *   node backend/scripts/repairMiguelBoholMoveToSomoJuly11am.js --production
 *   node backend/scripts/repairMiguelBoholMoveToSomoJuly11am.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 78;
const STUDENT_EMAIL = 'carlosgeline26@gmail.com';
const PROFILE_ID = 54;
const FROM_CLASS_ID = 37;
const TO_CLASS_ID = 95;
const FROM_CLASS_NAME = 'SOMO_Pre-Kinder_MWF_9:30-10:30AM';
const TO_CLASS_NAME = 'SOMO_JULY_Pre-Kinder_MWF 11 AM';

const PHASE2_INVOICE_ID = 1927;
const PHASE2_CURRENT_ISSUE = '2026-03-25';
const PHASE2_CURRENT_DUE = '2026-04-05';
const PHASE2_TARGET_ISSUE = '2026-07-25';
const PHASE2_TARGET_DUE = '2026-08-05';

const REPAIR_NOTE =
  'Ops repair 2026-08-12 — Miguel Bohol plan class 37 → 95; Phase 2 INV-1927 Jul 25 / Aug 5';

const isApply = process.argv.includes('--apply');

async function loadEnrollments(client) {
  const r = await client.query(
    `SELECT cs.classstudent_id, cs.class_id, c.class_name, cs.phase_number,
            cs.program_enrollment_status AS status,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD') AS enrolled,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM-DD') AS removed
     FROM classstudentstbl cs
     LEFT JOIN classestbl c ON c.class_id = cs.class_id
     WHERE cs.student_id = $1
     ORDER BY cs.class_id, cs.phase_number`,
    [STUDENT_ID]
  );
  return r.rows;
}

async function loadProfile(client) {
  const r = await client.query(
    `SELECT ip.installmentinvoiceprofiles_id AS profile_id, ip.student_id,
            ip.class_id, c.class_name, ip.is_active, ip.generated_count
     FROM installmentinvoiceprofilestbl ip
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     WHERE ip.installmentinvoiceprofiles_id = $1`,
    [PROFILE_ID]
  );
  return r.rows[0] || null;
}

async function loadInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_id, status, amount, invoice_ar_number,
            installmentinvoiceprofiles_id AS profile_id,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
            TO_CHAR(due_date, 'YYYY-MM-DD') AS due,
            remarks
     FROM invoicestbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const row = r.rows[0] || null;
  if (row) row.phase = parseTargetPhase(row.remarks);
  return row;
}

async function loadClassTaggedInvoices(client, classId) {
  const r = await client.query(
    `SELECT i.invoice_id, i.status,
            LEFT(COALESCE(i.remarks, ''), 120) AS remarks
     FROM invoicestbl i
     JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
     WHERE ist.student_id = $1
       AND i.remarks ILIKE '%' || $2 || '%'
     ORDER BY i.invoice_id`,
    [STUDENT_ID, `CLASS_ID:${classId}`]
  );
  return r.rows;
}

async function main() {
  console.log(
    `\nMiguel Bohol — plan → July 11 AM + Phase 2 Jul 25 / Aug 5` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
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
        `SELECT user_id, full_name, email FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error('Student not found');
    console.log('Student:', student.full_name, student.email);

    const toClass = (
      await client.query(
        `SELECT class_id, class_name, status, program_id, branch_id
         FROM classestbl WHERE class_id = $1`,
        [TO_CLASS_ID]
      )
    ).rows[0];
    if (!toClass || toClass.class_name !== TO_CLASS_NAME) {
      throw new Error(`Target class ${TO_CLASS_ID} name mismatch: ${toClass?.class_name}`);
    }

    const profile = await loadProfile(client);
    if (!profile || Number(profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found`);
    }
    const profileAlreadyMoved = Number(profile.class_id) === TO_CLASS_ID;
    if (!profileAlreadyMoved && Number(profile.class_id) !== FROM_CLASS_ID) {
      throw new Error(
        `Profile class_id=${profile.class_id}, expected ${FROM_CLASS_ID} or ${TO_CLASS_ID}`
      );
    }
    console.log('Profile BEFORE:', profile);

    console.log('\nEnrollments:');
    const enrollments = await loadEnrollments(client);
    console.table(enrollments);

    const onJuly = enrollments.find(
      (e) => Number(e.class_id) === TO_CLASS_ID && Number(e.phase_number) === 1 && !e.removed
    );
    if (!onJuly) {
      throw new Error(`No active Phase 1 enrollment on class ${TO_CLASS_ID}`);
    }

    const inv2 = await loadInvoice(client, PHASE2_INVOICE_ID);
    if (!inv2 || Number(inv2.profile_id) !== PROFILE_ID) {
      throw new Error(`INV-${PHASE2_INVOICE_ID} not on profile ${PROFILE_ID}`);
    }
    if (inv2.phase !== 2) {
      throw new Error(`INV-${PHASE2_INVOICE_ID} TARGET_PHASE:${inv2.phase}, expected 2`);
    }
    const datesAlready =
      inv2.issue === PHASE2_TARGET_ISSUE && inv2.due === PHASE2_TARGET_DUE;
    const datesMatchCurrent =
      inv2.issue === PHASE2_CURRENT_ISSUE && inv2.due === PHASE2_CURRENT_DUE;
    if (!datesAlready && !datesMatchCurrent) {
      throw new Error(
        `INV-${PHASE2_INVOICE_ID} unexpected dates ${inv2.issue} / ${inv2.due}`
      );
    }
    console.log('Phase 2 invoice BEFORE:', {
      invoice_id: inv2.invoice_id,
      issue: inv2.issue,
      due: inv2.due,
      status: inv2.status,
      amount: inv2.amount,
    });

    const taggedFrom = await loadClassTaggedInvoices(client, FROM_CLASS_ID);
    console.log('\nInvoices with CLASS_ID:37:');
    console.table(taggedFrom.length ? taggedFrom : [{ note: '(none)' }]);

    console.log('\nPlanned:');
    console.log(
      profileAlreadyMoved
        ? `  1. Profile ${PROFILE_ID} already on class ${TO_CLASS_ID}`
        : `  1. Profile ${PROFILE_ID} class_id ${FROM_CLASS_ID} → ${TO_CLASS_ID} (${TO_CLASS_NAME})`
    );
    console.log(
      taggedFrom.length
        ? `  2. Retag CLASS_ID:${FROM_CLASS_ID} → CLASS_ID:${TO_CLASS_ID} on INV ${taggedFrom.map((i) => i.invoice_id).join(', ')}`
        : `  2. No CLASS_ID:${FROM_CLASS_ID} remarks to retag`
    );
    console.log(
      datesAlready
        ? `  3. Phase 2 INV-1927 already ${PHASE2_TARGET_ISSUE} / ${PHASE2_TARGET_DUE}`
        : `  3. Phase 2 INV-1927 ${PHASE2_CURRENT_ISSUE}/${PHASE2_CURRENT_DUE} → ${PHASE2_TARGET_ISSUE}/${PHASE2_TARGET_DUE}`
    );
    console.log('  4. Keep Inactive plan; leave class 37 dropped Phase 2 row');

    if (!profileAlreadyMoved) {
      const upd = await client.query(
        `UPDATE installmentinvoiceprofilestbl
         SET class_id = $1
         WHERE installmentinvoiceprofiles_id = $2
           AND student_id = $3
           AND class_id = $4
         RETURNING installmentinvoiceprofiles_id, class_id, is_active`,
        [TO_CLASS_ID, PROFILE_ID, STUDENT_ID, FROM_CLASS_ID]
      );
      if (!upd.rows.length) throw new Error('Failed to update profile class_id');
      console.log('✅ Profile:', upd.rows[0]);
    }

    if (taggedFrom.length) {
      const invUpd = await client.query(
        `UPDATE invoicestbl i
         SET remarks = regexp_replace(COALESCE(i.remarks, ''), 'CLASS_ID:\\d+', 'CLASS_ID:' || $1)
         FROM invoicestudentstbl ist
         WHERE ist.invoice_id = i.invoice_id
           AND ist.student_id = $2
           AND i.remarks ILIKE '%' || $3 || '%'
         RETURNING i.invoice_id`,
        [String(TO_CLASS_ID), STUDENT_ID, `CLASS_ID:${FROM_CLASS_ID}`]
      );
      console.log(`✅ Retagged CLASS_ID on INV ${invUpd.rows.map((r) => r.invoice_id).join(', ')}`);
    }

    if (!datesAlready) {
      const nextRemarks = String(inv2.remarks || '').includes(REPAIR_NOTE)
        ? inv2.remarks
        : [inv2.remarks, REPAIR_NOTE].filter(Boolean).join(';');
      await client.query(
        `UPDATE invoicestbl
         SET issue_date = $1::date,
             due_date = $2::date,
             remarks = $3
         WHERE invoice_id = $4
           AND installmentinvoiceprofiles_id = $5`,
        [PHASE2_TARGET_ISSUE, PHASE2_TARGET_DUE, nextRemarks, PHASE2_INVOICE_ID, PROFILE_ID]
      );
      try {
        await syncProgramPaymentStatusForInvoice(client, PHASE2_INVOICE_ID);
      } catch (e) {
        console.warn('⚠ sync Phase 2:', e.message);
      }
      console.log(`✅ INV-${PHASE2_INVOICE_ID} dates → ${PHASE2_TARGET_ISSUE} / ${PHASE2_TARGET_DUE}`);
    }

    const afterProfile = await loadProfile(client);
    const afterInv2 = await loadInvoice(client, PHASE2_INVOICE_ID);
    const taggedTo = await loadClassTaggedInvoices(client, TO_CLASS_ID);

    console.log('\nProfile AFTER:', afterProfile);
    console.log('Phase 2 AFTER:', {
      invoice_id: afterInv2.invoice_id,
      issue: afterInv2.issue,
      due: afterInv2.due,
      status: afterInv2.status,
    });
    console.log('Invoices with CLASS_ID:95:');
    console.table(taggedTo.length ? taggedTo : [{ note: '(none)' }]);

    if (Number(afterProfile.class_id) !== TO_CLASS_ID) {
      throw new Error(`Profile still on class ${afterProfile.class_id}`);
    }
    if (afterProfile.class_name !== TO_CLASS_NAME) {
      throw new Error(`Profile class_name ${afterProfile.class_name}`);
    }
    if (afterInv2.issue !== PHASE2_TARGET_ISSUE || afterInv2.due !== PHASE2_TARGET_DUE) {
      throw new Error(`Phase 2 dates ${afterInv2.issue} / ${afterInv2.due}`);
    }

    console.log('\nExpected UI:');
    console.log(`  Class Enrolled: ${TO_CLASS_NAME}`);
    console.log('  Phase 2 Issued: Jul 25, 2026  Due: Aug 5, 2026');

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDry run only — rolled back. Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted. Refresh Student History → Invoices.');
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
