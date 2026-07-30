/**
 * Move Anastasia Chrysanthe Catibog Yanga (user_id 337) from Pre-Kindergarten
 * class 69 (VMM_Pre-Kinder_MWF 1PM) to Nursery class 153 (VMM_Nursery_TThS 9:30 AM),
 * and convert her mis-clicked Fullpayment package into Phase + Installment.
 *
 * Ops decisions (confirmed):
 *   1A — Convert package 176 in place → Phase + Installment, level_tag Nursery,
 *         phase_start=1, phase_end=10 (only Anastasia uses this package).
 *   2A — Installment plan phase_start=1, total_phases=10; enroll phase 1 only.
 *
 * Context:
 *   INV-2054 (₱5,000 Paid) used package 176 "Per Phase - Old Rate" configured as
 *   Fullpayment → auto-enrolled all 10 phases as Pre-K upsell. She should be
 *   Nursery per-phase installment, phase 1 only.
 *
 * Planned changes:
 *   1. Package 176: Fullpayment → Phase + Installment; level_tag Nursery;
 *      phase_start=1, phase_end=10
 *   2. Delete Pre-K phase 2–10 enrollment rows (erroneous full-pay auto-enrolls)
 *   3. Move phase 1 enrollment 69 → 153; status upsell → new
 *   4. Create active installment profile on class 153 (package 176, phases 1–10,
 *      generated_count=1); create installment queue for phase 2 (Aug 25 / Sep 05)
 *   5. Retag INV-2054 → profile-linked TARGET_PHASE:1, CLASS_ID:153; payment_type
 *      Full Payment → Installment
 *   6. Delete 2 Pre-K MWF attendance rows (Jul 22/24 — no Nursery TThS match)
 *
 * Historical Nursery class 77 / profile 213 left unchanged.
 *
 * Usage (from backend/):
 *   node scripts/moveAnastasiaYangaPreKToNursery930.js --production
 *   node scripts/moveAnastasiaYangaPreKToNursery930.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';

const STUDENT_ID = 337;
const STUDENT_EMAIL = 'mveravgc@gmail.com';
const SOURCE_CLASS_ID = 69;
const SOURCE_CLASS_NAME = 'VMM_Pre-Kinder_MWF 1PM';
const TARGET_CLASS_ID = 153;
const TARGET_CLASS_NAME = 'VMM_Nursery_TThS 9:30 AM';
const PACKAGE_ID = 176;
const INVOICE_ID = 2054;
const PAYMENT_ID = 1713;
const PHASE1_ENROLLMENT_ID = 1904;
const REMOVE_ENROLLMENT_IDS = [1905, 1906, 1907, 1908, 1909, 1910, 1911, 1912, 1913];
const ALL_SOURCE_ENROLLMENT_IDS = [PHASE1_ENROLLMENT_ID, ...REMOVE_ENROLLMENT_IDS];

const PHASE_START = 1;
const TOTAL_PHASES = 10;
const PHASE_AMOUNT = 5000;
/** Phase 1 paid Jul 21 → next auto-gen is Aug cycle. */
const NEXT_GEN_YMD = '2026-08-25';
const NEXT_DUE_YMD = '2026-09-05';
const NEXT_INVOICE_MONTH_YMD = '2026-09-01';

const isApply = process.argv.includes('--apply');
const REPAIR_NOTE =
  'Ops repair — Anastasia Yanga: package 176→Phase+Installment Nursery; move class 69→153; phase 1 only';

async function loadSnapshot(queryFn = query) {
  const student = (
    await queryFn(
      `SELECT user_id, full_name, email, branch_id
       FROM userstbl WHERE user_id = $1`,
      [STUDENT_ID]
    )
  ).rows[0];

  const source = (
    await queryFn(
      `SELECT c.class_id, c.class_name, c.branch_id, c.program_id, c.max_students, c.status,
              c.level_tag, p.program_code, p.program_name
       FROM classestbl c
       LEFT JOIN programstbl p ON p.program_id = c.program_id
       WHERE c.class_id = $1`,
      [SOURCE_CLASS_ID]
    )
  ).rows[0];

  const target = (
    await queryFn(
      `SELECT c.class_id, c.class_name, c.branch_id, c.program_id, c.max_students, c.status,
              c.level_tag, p.program_code, p.program_name,
              TO_CHAR(c.start_date, 'YYYY-MM-DD') AS start_ymd,
              TO_CHAR(c.end_date, 'YYYY-MM-DD') AS end_ymd
       FROM classestbl c
       LEFT JOIN programstbl p ON p.program_id = c.program_id
       WHERE c.class_id = $1`,
      [TARGET_CLASS_ID]
    )
  ).rows[0];

  const pkg = (
    await queryFn(
      `SELECT package_id, package_name, branch_id, level_tag, status,
              package_type, payment_option, package_price,
              phase_start, phase_end, downpayment_amount
       FROM packagestbl WHERE package_id = $1`,
      [PACKAGE_ID]
    )
  ).rows[0];

  const packageUsage = (
    await queryFn(
      `SELECT COUNT(DISTINCT i.invoice_id)::int AS invoices,
              COUNT(DISTINCT ist.student_id)::int AS students
       FROM invoicestbl i
       JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
       WHERE i.package_id = $1`,
      [PACKAGE_ID]
    )
  ).rows[0];

  const enrollments = (
    await queryFn(
      `SELECT classstudent_id, class_id, phase_number, program_enrollment_status,
              TO_CHAR(enrolled_at, 'YYYY-MM-DD HH24:MI') AS enrolled_wall,
              removed_at
       FROM classstudentstbl
       WHERE student_id = $1
         AND classstudent_id = ANY($2::int[])
       ORDER BY phase_number, classstudent_id`,
      [STUDENT_ID, ALL_SOURCE_ENROLLMENT_IDS]
    )
  ).rows;

  const invoice = (
    await queryFn(
      `SELECT i.invoice_id, i.invoice_ar_number, i.status, i.invoice_description,
              i.remarks, i.package_id, i.installmentinvoiceprofiles_id AS profile_id,
              TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue_ymd,
              TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due_ymd
       FROM invoicestbl i
       JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
       WHERE i.invoice_id = $1 AND ist.student_id = $2`,
      [INVOICE_ID, STUDENT_ID]
    )
  ).rows[0];

  const payment = (
    await queryFn(
      `SELECT payment_id, invoice_id, status, approval_status, payment_type,
              payable_amount, discount_amount,
              TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue_ymd
       FROM paymenttbl WHERE payment_id = $1 AND invoice_id = $2`,
      [PAYMENT_ID, INVOICE_ID]
    )
  ).rows[0];

  const attendance = (
    await queryFn(
      `SELECT a.attendance_id, a.status, a.classsession_id,
              cs.class_id, cs.phase_number, cs.phase_session_number,
              TO_CHAR(cs.scheduled_date, 'YYYY-MM-DD') AS scheduled_ymd
       FROM attendancetbl a
       JOIN classsessionstbl cs ON cs.classsession_id = a.classsession_id
       WHERE a.student_id = $1 AND cs.class_id = $2
       ORDER BY cs.phase_number, cs.phase_session_number`,
      [STUDENT_ID, SOURCE_CLASS_ID]
    )
  ).rows;

  const targetActive = (
    await queryFn(
      `SELECT COUNT(DISTINCT student_id)::int AS n
       FROM classstudentstbl
       WHERE class_id = $1
         AND removed_at IS NULL
         AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')`,
      [TARGET_CLASS_ID]
    )
  ).rows[0]?.n;

  const alreadyOnTarget = (
    await queryFn(
      `SELECT classstudent_id, phase_number, program_enrollment_status
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND removed_at IS NULL`,
      [STUDENT_ID, TARGET_CLASS_ID]
    )
  ).rows;

  const existingProfileOnTarget = (
    await queryFn(
      `SELECT installmentinvoiceprofiles_id, class_id, package_id, is_active,
              phase_start, total_phases, generated_count
       FROM installmentinvoiceprofilestbl
       WHERE student_id = $1 AND class_id = $2`,
      [STUDENT_ID, TARGET_CLASS_ID]
    )
  ).rows;

  return {
    student,
    source,
    target,
    pkg,
    packageUsage,
    enrollments,
    invoice,
    payment,
    attendance,
    targetActive,
    alreadyOnTarget,
    existingProfileOnTarget,
  };
}

function assertReady(snap) {
  if (!snap.student || Number(snap.student.user_id) !== STUDENT_ID) {
    throw new Error(`Student ${STUDENT_ID} not found`);
  }
  if (String(snap.student.email || '').toLowerCase() !== STUDENT_EMAIL) {
    throw new Error(`Expected email ${STUDENT_EMAIL}, got ${snap.student.email}`);
  }
  if (!String(snap.student.full_name || '').includes('Anastasia')) {
    throw new Error(`Unexpected student name: ${snap.student.full_name}`);
  }
  if (!snap.source || snap.source.class_name !== SOURCE_CLASS_NAME) {
    throw new Error(
      `Expected source class ${SOURCE_CLASS_ID} named ${SOURCE_CLASS_NAME}, got ${snap.source?.class_name}`
    );
  }
  if (!snap.target || snap.target.class_name !== TARGET_CLASS_NAME) {
    throw new Error(
      `Expected target class ${TARGET_CLASS_ID} named ${TARGET_CLASS_NAME}, got ${snap.target?.class_name}`
    );
  }
  if (Number(snap.target.program_id) !== 1 || snap.target.level_tag !== 'Nursery') {
    throw new Error('Target class is not Nursery program');
  }
  if (Number(snap.source.branch_id) !== Number(snap.target.branch_id)) {
    throw new Error('Source and target must share the same branch_id');
  }
  if (snap.alreadyOnTarget.length) {
    throw new Error(`Student already has enrollment on target class ${TARGET_CLASS_ID}`);
  }
  if (snap.existingProfileOnTarget.length) {
    throw new Error(
      `Student already has installment profile on target class ${TARGET_CLASS_ID}`
    );
  }
  if (snap.enrollments.length !== ALL_SOURCE_ENROLLMENT_IDS.length) {
    throw new Error(
      `Expected ${ALL_SOURCE_ENROLLMENT_IDS.length} Pre-K enrollments, found ${snap.enrollments.length}`
    );
  }
  for (const row of snap.enrollments) {
    if (Number(row.class_id) !== SOURCE_CLASS_ID) {
      throw new Error(
        `Enrollment ${row.classstudent_id} is not on source class ${SOURCE_CLASS_ID}`
      );
    }
    if (row.removed_at) {
      throw new Error(`Enrollment ${row.classstudent_id} is already removed`);
    }
  }
  const phase1 = snap.enrollments.find((r) => Number(r.phase_number) === 1);
  if (!phase1 || Number(phase1.classstudent_id) !== PHASE1_ENROLLMENT_ID) {
    throw new Error(`Expected phase 1 enrollment ${PHASE1_ENROLLMENT_ID}`);
  }
  if (String(phase1.program_enrollment_status) !== 'upsell') {
    throw new Error(
      `Expected phase 1 upsell on source; got ${phase1.program_enrollment_status}`
    );
  }
  if (!snap.pkg || Number(snap.pkg.package_id) !== PACKAGE_ID) {
    throw new Error(`Package ${PACKAGE_ID} not found`);
  }
  if (String(snap.pkg.package_type) !== 'Fullpayment') {
    throw new Error(
      `Expected package ${PACKAGE_ID} package_type=Fullpayment before convert; got ${snap.pkg.package_type}`
    );
  }
  if (Number(snap.packageUsage?.students) !== 1 || Number(snap.packageUsage?.invoices) !== 1) {
    throw new Error(
      `Refuse to convert package ${PACKAGE_ID}: expected sole use by Anastasia (1 invoice / 1 student), got invoices=${snap.packageUsage?.invoices} students=${snap.packageUsage?.students}`
    );
  }
  if (!snap.invoice || Number(snap.invoice.package_id) !== PACKAGE_ID) {
    throw new Error(`Invoice ${INVOICE_ID} is not on package ${PACKAGE_ID}`);
  }
  if (!String(snap.invoice.remarks || '').includes(`CLASS_ID:${SOURCE_CLASS_ID}`)) {
    throw new Error(
      `Expected invoice ${INVOICE_ID} remarks to include CLASS_ID:${SOURCE_CLASS_ID}`
    );
  }
  if (snap.invoice.profile_id) {
    throw new Error(
      `Invoice ${INVOICE_ID} already linked to profile ${snap.invoice.profile_id}`
    );
  }
  if (!snap.payment || String(snap.payment.status) !== 'Completed') {
    throw new Error(`Expected completed payment ${PAYMENT_ID} on invoice ${INVOICE_ID}`);
  }

  const afterActive = (parseInt(snap.targetActive, 10) || 0) + 1;
  if (snap.target.max_students != null && afterActive > Number(snap.target.max_students)) {
    throw new Error(
      `Target would exceed capacity (${snap.targetActive}+1 > ${snap.target.max_students})`
    );
  }
}

async function main() {
  if (!process.argv.includes('--production') && !process.argv.includes('--development')) {
    console.log(
      'Tip: pass --production (this student lives on production) or --development.\n'
    );
  }

  const before = await loadSnapshot();

  console.log('============================================================');
  console.log(isApply ? 'APPLY' : 'DRY RUN — no data will change');
  console.log('============================================================');
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log('\nStudent:', before.student);
  console.log('Source (Pre-K):', before.source);
  console.log('Target (Nursery):', before.target);
  console.log(
    `Target active enrolled: ${before.targetActive} / max ${before.target?.max_students}`
  );

  console.log('\nPackage 176 (before):');
  console.log(before.pkg);
  console.log('Package usage:', before.packageUsage);

  console.log('\nPre-K enrollments:');
  console.table(before.enrollments);

  console.log('\nInvoice / payment:');
  console.log(before.invoice);
  console.log(before.payment);

  console.log('\nAttendance on Pre-K (will be deleted — no TThS date match):');
  console.table(before.attendance);

  assertReady(before);

  const phase1Remarks =
    `Auto-generated from installment invoice: Installment plan for ${before.student.full_name} - Nursery;TARGET_PHASE:1;CLASS_ID:${TARGET_CLASS_ID};${REPAIR_NOTE}`;

  console.log('\nPlanned fixes:');
  console.table([
    {
      step: '1_convert_package_176',
      detail:
        'Fullpayment → Phase + Installment; level_tag Nursery; phase_start=1, phase_end=10',
    },
    {
      step: '2_delete_phases_2_to_10',
      detail: `delete ${REMOVE_ENROLLMENT_IDS.length} erroneous full-pay enrollment rows`,
    },
    {
      step: '3_move_phase1',
      detail: `classstudent ${PHASE1_ENROLLMENT_ID}: class ${SOURCE_CLASS_ID}→${TARGET_CLASS_ID}, upsell→new`,
    },
    {
      step: '4_create_installment_profile',
      detail: `new profile on class ${TARGET_CLASS_ID}, package ${PACKAGE_ID}, phase_start=${PHASE_START}, total_phases=${TOTAL_PHASES}, generated_count=1, queue ${NEXT_GEN_YMD}/${NEXT_DUE_YMD}`,
    },
    {
      step: '5_retag_invoice_payment',
      detail: `INV-${INVOICE_ID} → TARGET_PHASE:1 + CLASS_ID:${TARGET_CLASS_ID} + link profile; payment ${PAYMENT_ID} type → Installment`,
    },
    {
      step: '6_delete_wrong_attendance',
      detail: `delete ${before.attendance.length} Pre-K MWF attendance row(s)`,
    },
    {
      step: 'capacity_after',
      detail: `active enrolled ~${(parseInt(before.targetActive, 10) || 0) + 1}/${before.target.max_students}`,
    },
  ]);

  console.log('\nPhase 1 invoice remarks (after):');
  console.log(phase1Remarks);

  if (!isApply) {
    console.log('\nDry run only. Re-run with --apply to commit.');
    process.exit(0);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const pkgUpd = await client.query(
      `UPDATE packagestbl
       SET package_type = 'Phase',
           payment_option = 'Installment',
           level_tag = 'Nursery',
           phase_start = $1,
           phase_end = $2
       WHERE package_id = $3
         AND package_type = 'Fullpayment'
       RETURNING package_id, package_name, package_type, payment_option,
                 level_tag, phase_start, phase_end, package_price`,
      [PHASE_START, PHASE_START + TOTAL_PHASES - 1, PACKAGE_ID]
    );
    if (!pkgUpd.rows.length) throw new Error('Failed to convert package 176');
    console.log('✅ Package converted:', pkgUpd.rows[0]);

    const delEnr = await client.query(
      `DELETE FROM classstudentstbl
       WHERE student_id = $1
         AND class_id = $2
         AND classstudent_id = ANY($3::int[])
         AND phase_number BETWEEN 2 AND 10
       RETURNING classstudent_id, phase_number`,
      [STUDENT_ID, SOURCE_CLASS_ID, REMOVE_ENROLLMENT_IDS]
    );
    if (delEnr.rows.length !== REMOVE_ENROLLMENT_IDS.length) {
      throw new Error(
        `Deleted ${delEnr.rows.length} phase 2–10 rows, expected ${REMOVE_ENROLLMENT_IDS.length}`
      );
    }
    console.log(
      `✅ Deleted phases 2–10:`,
      delEnr.rows.map((r) => `P${r.phase_number}#${r.classstudent_id}`).join(', ')
    );

    const movePhase1 = await client.query(
      `UPDATE classstudentstbl
       SET class_id = $1,
           program_enrollment_status = 'new'
       WHERE classstudent_id = $2
         AND student_id = $3
         AND class_id = $4
         AND phase_number = 1
         AND program_enrollment_status = 'upsell'
       RETURNING classstudent_id, class_id, phase_number, program_enrollment_status`,
      [TARGET_CLASS_ID, PHASE1_ENROLLMENT_ID, STUDENT_ID, SOURCE_CLASS_ID]
    );
    if (!movePhase1.rows.length) throw new Error('Failed to move/fix phase 1 enrollment');
    console.log('✅ Phase 1 moved:', movePhase1.rows[0]);

    const profileIns = await client.query(
      `INSERT INTO installmentinvoiceprofilestbl
         (student_id, branch_id, package_id, amount, frequency, description,
          day_of_month, is_active, bill_invoice_due_date, next_invoice_due_date,
          first_billing_month, first_generation_date, created_by, class_id,
          total_phases, generated_count, downpayment_paid, downpayment_invoice_id,
          promo_id, promo_apply_scope, promo_months_to_apply, promo_months_applied,
          phase_start)
       VALUES
         ($1, $2, $3, $4, $5, $6,
          $7, true, $8::date, $9::date,
          $10::date, $11::date, $12, $13,
          $14, 1, false, NULL,
          NULL, NULL, NULL, 0,
          $15)
       RETURNING installmentinvoiceprofiles_id, class_id, package_id, phase_start,
                 total_phases, generated_count, is_active, amount`,
      [
        STUDENT_ID,
        before.student.branch_id,
        PACKAGE_ID,
        PHASE_AMOUNT,
        '1 month(s)',
        `Installment plan for ${before.student.full_name} - Nursery`,
        5,
        '2026-07-21',
        NEXT_DUE_YMD,
        '2026-07-01',
        '2026-07-21',
        'Ops repair script',
        TARGET_CLASS_ID,
        TOTAL_PHASES,
        PHASE_START,
      ]
    );
    const profileId = profileIns.rows[0].installmentinvoiceprofiles_id;
    console.log('✅ Installment profile created:', profileIns.rows[0]);

    const queueIns = await client.query(
      `INSERT INTO installmentinvoicestbl
         (installmentinvoiceprofiles_id, scheduled_date, status, student_name,
          total_amount_including_tax, total_amount_excluding_tax, frequency,
          next_generation_date, next_invoice_month)
       VALUES ($1, $2::date, 'Pending', $3, $4, $4, $5, $6::date, $7::date)
       RETURNING installmentinvoicedtl_id, status,
                 TO_CHAR(next_generation_date, 'YYYY-MM-DD') AS next_gen,
                 TO_CHAR(next_invoice_month, 'YYYY-MM-DD') AS next_month`,
      [
        profileId,
        NEXT_DUE_YMD,
        before.student.full_name,
        PHASE_AMOUNT,
        '1 month(s)',
        NEXT_GEN_YMD,
        NEXT_INVOICE_MONTH_YMD,
      ]
    );
    console.log('✅ Installment queue (phase 2):', queueIns.rows[0]);

    const invUpd = await client.query(
      `UPDATE invoicestbl
       SET remarks = $1,
           installmentinvoiceprofiles_id = $2,
           due_date = COALESCE(due_date, issue_date)
       WHERE invoice_id = $3
       RETURNING invoice_id, package_id, installmentinvoiceprofiles_id AS profile_id, remarks`,
      [phase1Remarks, profileId, INVOICE_ID]
    );
    if (!invUpd.rows.length) throw new Error(`Failed to retag invoice ${INVOICE_ID}`);
    console.log('✅ Invoice retagged:', invUpd.rows[0]);

    const payUpd = await client.query(
      `UPDATE paymenttbl
       SET payment_type = 'Installment'
       WHERE payment_id = $1 AND invoice_id = $2
       RETURNING payment_id, payment_type, payable_amount`,
      [PAYMENT_ID, INVOICE_ID]
    );
    if (!payUpd.rows.length) throw new Error(`Failed to update payment ${PAYMENT_ID}`);
    console.log('✅ Payment type updated:', payUpd.rows[0]);

    if (before.attendance.length) {
      const attIds = before.attendance.map((a) => a.attendance_id);
      const attDel = await client.query(
        `DELETE FROM attendancetbl
         WHERE attendance_id = ANY($1::int[])
           AND student_id = $2
         RETURNING attendance_id`,
        [attIds, STUDENT_ID]
      );
      console.log(
        `✅ Deleted ${attDel.rows.length} Pre-K attendance row(s):`,
        attDel.rows.map((r) => r.attendance_id).join(', ')
      );
    }

    await client.query('COMMIT');
    console.log('\nCommitted.');

    const after = await loadSnapshot();
    console.log('\nAFTER package 176:', after.pkg);
    console.log('\nAFTER enrollments (source IDs — phase 1 should be on target):');
    console.table(after.enrollments);
    const afterTargetEnr = (
      await query(
        `SELECT classstudent_id, class_id, phase_number, program_enrollment_status
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND removed_at IS NULL
         ORDER BY phase_number`,
        [STUDENT_ID, TARGET_CLASS_ID]
      )
    ).rows;
    console.log('\nAFTER enrollments on target class 153:');
    console.table(afterTargetEnr);
    console.log('AFTER invoice:', after.invoice);
    console.log('AFTER payment:', after.payment);
    console.log('AFTER profiles on target:', after.existingProfileOnTarget);
    console.log(
      `AFTER attendance still on source class ${SOURCE_CLASS_ID}:`,
      after.attendance.length
    );
    console.log(
      `AFTER target active enrolled: ${after.targetActive} / ${after.target.max_students}`
    );
    console.log(`\n${REPAIR_NOTE}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nMove failed:', err?.message || err);
    process.exit(1);
  } finally {
    client.release();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
