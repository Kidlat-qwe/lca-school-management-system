/**
 * Atasha Cailin O. Ochengco — move installment start Phase 2 → Phase 3.
 *
 * Student 676 · arochengco@gmail.com · Profile 504 · Class 151 VMM_Playgroup_TTh 11:00 AM
 *
 * Current:
 *   - phase_start=2, total_phases=9 (absolute 2–10)
 *   - Phase 2 enrollment = new (classstudent 1987)
 *   - INV-2379 TARGET_PHASE:2 Paid
 *   - next_generation_date=2026-08-25, next_invoice_month=2026-09-01
 *
 * Target:
 *   - phase_start=3, total_phases=8 (absolute 3–10)
 *   - Phase 3 enrollment = new; Phase 2 row gone (not displayed)
 *   - INV-2379 TARGET_PHASE:3
 *   - Downpayment remarks PHASE_START:3 (PHASE_END:10)
 *   - next_generation_date=2026-09-25, next_invoice_month=2026-10-01
 *
 * Run:
 *   node backend/scripts/repairAtashaOchengcoPhaseStart3.js --production
 *   node backend/scripts/repairAtashaOchengcoPhaseStart3.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 676;
const STUDENT_EMAIL = 'arochengco@gmail.com';
const PROFILE_ID = 504;
const CLASS_ID = 151;
const CLASSSTUDENT_ID = 1987;
const PHASE2_INVOICE_ID = 2379;
const DOWNPAYMENT_INVOICE_ID = 2378;
const DTL_ID = 503;

const NEW_PHASE_START = 3;
const NEW_TOTAL_PHASES = 8; // absolute phases 3–10
const NEW_NEXT_GENERATION_DATE = '2026-09-25';
const NEW_NEXT_INVOICE_MONTH = '2026-10-01';

const REPAIR_NOTE =
  'Ops repair 2026-08-22 — Atasha Ochengco phase_start 2→3; new on Phase 3; queue Sep 25 / Oct 1';

const isApply = process.argv.includes('--apply');

function rewritePhaseStartEndRemarks(remarks, phaseStart, phaseEnd) {
  let text = String(remarks || '');
  if (/PHASE_START:\d+/i.test(text)) {
    text = text.replace(/PHASE_START:\d+/i, `PHASE_START:${phaseStart}`);
  } else {
    text = text ? `${text};PHASE_START:${phaseStart}` : `PHASE_START:${phaseStart}`;
  }
  if (phaseEnd != null) {
    if (/PHASE_END:\d+/i.test(text)) {
      text = text.replace(/PHASE_END:\d+/i, `PHASE_END:${phaseEnd}`);
    } else {
      text = `${text};PHASE_END:${phaseEnd}`;
    }
  }
  return text;
}

async function loadSnapshot(client) {
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

  const profile = (
    await client.query(
      `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.class_id,
              ip.phase_start, ip.total_phases, ip.generated_count, ip.is_active,
              ip.downpayment_invoice_id,
              TO_CHAR(ip.first_billing_month, 'YYYY-MM-DD') AS first_billing_month,
              ii.installmentinvoicedtl_id, ii.status AS dtl_status,
              TO_CHAR(ii.next_generation_date, 'YYYY-MM-DD') AS next_generation_date,
              TO_CHAR(ii.next_invoice_month, 'YYYY-MM-DD') AS next_invoice_month
       FROM installmentinvoiceprofilestbl ip
       LEFT JOIN installmentinvoicestbl ii
         ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
       WHERE ip.installmentinvoiceprofiles_id = $1
         AND ip.student_id = $2`,
      [PROFILE_ID, STUDENT_ID]
    )
  ).rows[0];

  const enrollments = (
    await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status,
              TO_CHAR(enrolled_at, 'YYYY-MM-DD HH24:MI:SS') AS enrolled_at,
              removed_at
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number, classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    )
  ).rows;

  const invoices = (
    await client.query(
      `SELECT invoice_id, status, invoice_ar_number,
              TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue_date,
              TO_CHAR(due_date, 'YYYY-MM-DD') AS due_date,
              remarks, invoice_description
       FROM invoicestbl
       WHERE installmentinvoiceprofiles_id = $1
          OR invoice_id = $2
       ORDER BY invoice_id`,
      [PROFILE_ID, DOWNPAYMENT_INVOICE_ID]
    )
  ).rows;

  return { student, profile, enrollments, invoices };
}

function printSnapshot(label, snap) {
  console.log(`\n======== ${label} ========`);
  console.log('Student:', snap.student?.full_name, `<${snap.student?.email}>`);
  console.log('Profile:', {
    id: snap.profile?.installmentinvoiceprofiles_id,
    class_id: snap.profile?.class_id,
    phase_start: snap.profile?.phase_start,
    total_phases: snap.profile?.total_phases,
    generated_count: snap.profile?.generated_count,
    next_generation_date: snap.profile?.next_generation_date,
    next_invoice_month: snap.profile?.next_invoice_month,
    dtl_id: snap.profile?.installmentinvoicedtl_id,
    dtl_status: snap.profile?.dtl_status,
  });
  console.log('Enrollments:');
  console.table(
    snap.enrollments.map((r) => ({
      classstudent_id: r.classstudent_id,
      phase: r.phase_number,
      status: r.program_enrollment_status,
      enrolled_at: r.enrolled_at,
      removed: r.removed_at != null,
    }))
  );
  console.log('Invoices:');
  console.table(
    snap.invoices.map((r) => ({
      invoice_id: r.invoice_id,
      ar: r.invoice_ar_number,
      status: r.status,
      issue: r.issue_date,
      due: r.due_date,
      remarks: String(r.remarks || '').slice(0, 120),
    }))
  );
}

async function applyRepair(client) {
  const phase2Cs = (
    await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status
       FROM classstudentstbl
       WHERE classstudent_id = $1
         AND student_id = $2
         AND class_id = $3`,
      [CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
    )
  ).rows[0];
  if (!phase2Cs) {
    throw new Error(`Expected classstudent ${CLASSSTUDENT_ID} not found`);
  }
  if (Number(phase2Cs.phase_number) !== 2) {
    throw new Error(
      `Expected classstudent ${CLASSSTUDENT_ID} on phase 2, got phase ${phase2Cs.phase_number}`
    );
  }

  const existingPhase3 = (
    await client.query(
      `SELECT classstudent_id
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = 3`,
      [STUDENT_ID, CLASS_ID]
    )
  ).rows[0];
  if (existingPhase3) {
    throw new Error(
      `Phase 3 enrollment already exists (classstudent_id=${existingPhase3.classstudent_id}); abort`
    );
  }

  await client.query(
    `UPDATE installmentinvoiceprofilestbl
     SET phase_start = $1,
         total_phases = $2
     WHERE installmentinvoiceprofiles_id = $3
       AND student_id = $4`,
    [NEW_PHASE_START, NEW_TOTAL_PHASES, PROFILE_ID, STUDENT_ID]
  );
  console.log(
    `✅ Profile ${PROFILE_ID}: phase_start=${NEW_PHASE_START}, total_phases=${NEW_TOTAL_PHASES}`
  );

  await client.query(
    `UPDATE installmentinvoicestbl
     SET next_generation_date = $1::date,
         next_invoice_month = $2::date,
         status = NULL
     WHERE installmentinvoicedtl_id = $3
       AND installmentinvoiceprofiles_id = $4`,
    [NEW_NEXT_GENERATION_DATE, NEW_NEXT_INVOICE_MONTH, DTL_ID, PROFILE_ID]
  );
  console.log(
    `✅ Dtl ${DTL_ID}: next_generation_date=${NEW_NEXT_GENERATION_DATE}, next_invoice_month=${NEW_NEXT_INVOICE_MONTH}`
  );

  await client.query(
    `UPDATE classstudentstbl
     SET phase_number = $1,
         program_enrollment_status = 'new',
         enrolled_by = RTRIM(COALESCE(enrolled_by, '') || E'\\n[${REPAIR_NOTE}]')
     WHERE classstudent_id = $2
       AND student_id = $3
       AND class_id = $4`,
    [NEW_PHASE_START, CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
  );
  console.log(
    `✅ classstudent ${CLASSSTUDENT_ID}: phase_number 2→${NEW_PHASE_START}, status=new`
  );

  const phaseInv = (
    await client.query(
      `SELECT invoice_id, remarks
       FROM invoicestbl
       WHERE invoice_id = $1
         AND installmentinvoiceprofiles_id = $2`,
      [PHASE2_INVOICE_ID, PROFILE_ID]
    )
  ).rows[0];
  if (!phaseInv) {
    throw new Error(`Phase invoice INV-${PHASE2_INVOICE_ID} not found on profile ${PROFILE_ID}`);
  }
  const newPhaseRemarks =
    rewriteTargetPhaseInRemarks(phaseInv.remarks, NEW_PHASE_START) +
    ` | ${REPAIR_NOTE}`;
  await client.query(
    `UPDATE invoicestbl
     SET remarks = $1
     WHERE invoice_id = $2`,
    [newPhaseRemarks, PHASE2_INVOICE_ID]
  );
  console.log(`✅ INV-${PHASE2_INVOICE_ID}: TARGET_PHASE → ${NEW_PHASE_START}`);

  const dpInv = (
    await client.query(
      `SELECT invoice_id, remarks
       FROM invoicestbl
       WHERE invoice_id = $1`,
      [DOWNPAYMENT_INVOICE_ID]
    )
  ).rows[0];
  if (!dpInv) {
    throw new Error(`Downpayment INV-${DOWNPAYMENT_INVOICE_ID} not found`);
  }
  const newDpRemarks =
    rewritePhaseStartEndRemarks(dpInv.remarks, NEW_PHASE_START, 10) +
    ` | ${REPAIR_NOTE}`;
  await client.query(
    `UPDATE invoicestbl
     SET remarks = $1
     WHERE invoice_id = $2`,
    [newDpRemarks, DOWNPAYMENT_INVOICE_ID]
  );
  console.log(
    `✅ INV-${DOWNPAYMENT_INVOICE_ID}: PHASE_START → ${NEW_PHASE_START} (PHASE_END:10)`
  );

  await syncProgramPaymentStatusForInvoice(client, PHASE2_INVOICE_ID);
  await syncProgramPaymentStatusForInvoice(client, DOWNPAYMENT_INVOICE_ID);
  console.log('✅ program_payment_statustbl synced for INV-2378 / INV-2379');
}

async function main() {
  console.log(
    `\nAtasha Ochengco phase_start → 3${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log('Targets:', {
    phase_start: NEW_PHASE_START,
    total_phases: NEW_TOTAL_PHASES,
    next_generation_date: NEW_NEXT_GENERATION_DATE,
    next_invoice_month: NEW_NEXT_INVOICE_MONTH,
  });

  if (!process.argv.includes('--production')) {
    console.warn(
      '\n⚠️  Pass --production to target psms_production (this student lives there).'
    );
  }

  const client = await getClient();
  try {
    const before = await loadSnapshot(client);
    if (!before.student) {
      throw new Error(`Student ${STUDENT_ID} / ${STUDENT_EMAIL} not found`);
    }
    if (!before.profile) {
      throw new Error(`Profile ${PROFILE_ID} not found for student ${STUDENT_ID}`);
    }
    printSnapshot('BEFORE', before);

    const planned = {
      profile: {
        phase_start: `${before.profile.phase_start} → ${NEW_PHASE_START}`,
        total_phases: `${before.profile.total_phases} → ${NEW_TOTAL_PHASES}`,
      },
      schedule: {
        next_generation_date: `${before.profile.next_generation_date} → ${NEW_NEXT_GENERATION_DATE}`,
        next_invoice_month: `${before.profile.next_invoice_month} → ${NEW_NEXT_INVOICE_MONTH}`,
      },
      enrollment: `classstudent ${CLASSSTUDENT_ID}: phase 2/new → phase ${NEW_PHASE_START}/new`,
      invoices: [
        `INV-${PHASE2_INVOICE_ID}: TARGET_PHASE 2 → ${NEW_PHASE_START}`,
        `INV-${DOWNPAYMENT_INVOICE_ID}: PHASE_START 2 → ${NEW_PHASE_START}`,
      ],
    };
    console.log('\n======== PLANNED CHANGES ========');
    console.log(JSON.stringify(planned, null, 2));

    if (!isApply) {
      console.log('\nDry run only. Re-run with --production --apply to commit.');
      return;
    }

    await client.query('BEGIN');
    await applyRepair(client);
    await client.query('COMMIT');

    const after = await loadSnapshot(client);
    printSnapshot('AFTER', after);

    const okPhaseStart = Number(after.profile.phase_start) === NEW_PHASE_START;
    const okTotal = Number(after.profile.total_phases) === NEW_TOTAL_PHASES;
    const okGen = after.profile.next_generation_date === NEW_NEXT_GENERATION_DATE;
    const okMonth = after.profile.next_invoice_month === NEW_NEXT_INVOICE_MONTH;
    const phase3New = after.enrollments.some(
      (e) =>
        Number(e.phase_number) === 3 &&
        e.program_enrollment_status === 'new' &&
        e.removed_at == null
    );
    const phase2Gone = !after.enrollments.some(
      (e) => Number(e.phase_number) === 2 && e.removed_at == null
    );

    console.log('\n======== CHECKS ========');
    console.log(okPhaseStart ? '✅ phase_start=3' : '❌ phase_start');
    console.log(okTotal ? '✅ total_phases=8' : '❌ total_phases');
    console.log(okGen ? '✅ next_generation_date=2026-09-25' : '❌ next_generation_date');
    console.log(okMonth ? '✅ next_invoice_month=2026-10-01' : '❌ next_invoice_month');
    console.log(phase3New ? '✅ Phase 3 = new' : '❌ Phase 3 new missing');
    console.log(phase2Gone ? '✅ Phase 2 not active' : '❌ Phase 2 still active');
    console.log('\nRefresh Student History → Installment for Atasha.');
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
