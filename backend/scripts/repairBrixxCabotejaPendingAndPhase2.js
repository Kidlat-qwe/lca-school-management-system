/**
 * Brixx Irving T. Caboteja — same as Margaux Nacar:
 *  1) Promote pending_enrollment → new (DP + Phase 1 already Paid)
 *  2) Force installment queue to Jul 25 / Aug 01
 *  3) Generate Phase 2 (Manila today is 2026-07-25)
 *  4) Queue advances to Aug 25 / Sep 01
 *
 * Profile #492 · class 149 SOMO_JULY_Nursery_MWF 2:30 PM · Cavite
 * INV-2057 DP Paid · INV-2058 Phase 1 Paid · classstudent 1915 pending
 *
 * Run (from backend/):
 *   node scripts/repairBrixxCabotejaPendingAndPhase2.js --production
 *   node scripts/repairBrixxCabotejaPendingAndPhase2.js --production --apply
 *   node scripts/repairBrixxCabotejaPendingAndPhase2.js --production --apply --generate
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { formatYmdLocal, todayYmdManila } from '../utils/dateUtils.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { generateInvoiceFromInstallment } from '../utils/installmentInvoiceGenerator.js';
import { syncInstallmentEnrollmentForPaidInvoice } from '../utils/installmentEnrollmentSync.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_EMAIL = 'marjorietanala@gmail.com';
const STUDENT_ID = 666;
const CLASS_ID = 149;
const PROFILE_ID = 492;
const PHASE1_INVOICE_ID = 2058;
const CLASSSTUDENT_ID = 1915;
const BRANCH_ID = 3;

const TARGET_PHASE = 2;
const TARGET_GENERATION_DATE = '2026-07-25';
const TARGET_INVOICE_MONTH = '2026-08-01';
const AFTER_GENERATE_NEXT_GEN = '2026-08-25';
const AFTER_GENERATE_NEXT_MONTH = '2026-09-01';
const EXPECTED_ISSUE = '2026-07-25';
const EXPECTED_DUE = '2026-08-05';

const REPAIR_NOTE =
  'Ops repair — Brixx Caboteja promote pending→new + Phase 2 (Jul 25 / Aug 01)';

const args = new Set(process.argv.slice(2));
const isApply = args.has('--apply');
const isGenerate = args.has('--generate');

const ymd = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return formatYmdLocal(value).slice(0, 10);
};

async function loadProfileRow(client) {
  const res = await client.query(
    `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.class_id, ip.branch_id,
            ip.phase_start, ip.total_phases, ip.generated_count, ip.is_active,
            ip.downpayment_paid, ip.downpayment_invoice_id, ip.amount, ip.frequency,
            ip.description,
            ii.installmentinvoicedtl_id, ii.next_generation_date, ii.next_invoice_month,
            ii.status AS ii_status, ii.frequency AS ii_frequency,
            ii.total_amount_including_tax, ii.total_amount_excluding_tax,
            u.full_name AS student_name, u.email AS student_email,
            c.class_name
     FROM installmentinvoiceprofilestbl ip
     INNER JOIN installmentinvoicestbl ii
       ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
     INNER JOIN userstbl u ON u.user_id = ip.student_id
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     WHERE ip.installmentinvoiceprofiles_id = $1`,
    [PROFILE_ID]
  );
  return res.rows[0] || null;
}

async function loadPhaseInvoice(client, absolutePhase) {
  const res = await client.query(
    `SELECT i.invoice_id, i.status, i.invoice_ar_number, i.amount,
            TO_CHAR(TIMEZONE('Asia/Manila', i.issue_date), 'YYYY-MM-DD') AS issue_ymd,
            TO_CHAR(TIMEZONE('Asia/Manila', i.due_date), 'YYYY-MM-DD') AS due_ymd,
            i.remarks
     FROM invoicestbl i
     WHERE i.installmentinvoiceprofiles_id = $1
       AND i.remarks ILIKE $2
     ORDER BY i.invoice_id DESC
     LIMIT 1`,
    [PROFILE_ID, `%TARGET_PHASE:${absolutePhase}%`]
  );
  return res.rows[0] || null;
}

async function previewMatrix(queryFn) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year: 2026,
    branchId: BRANCH_ID,
    classId: CLASS_ID,
  });
  const track = (matrix.students || []).find(
    (s) => Number(s.student_id) === STUDENT_ID && Number(s.class_id) === CLASS_ID
  );
  const cells = [];
  for (const key of ['2026-06', '2026-07', '2026-08', '2026-09']) {
    const c = track?.months?.[key];
    if (!c) continue;
    if (c.mark === '1' || c.mark === '✓' || c.mark === 'X' || c.label) {
      cells.push({
        month: key,
        label: c.label,
        status: c.status,
        phase: c.phase_number ?? null,
        mark: c.mark,
      });
    }
  }
  return cells;
}

async function main() {
  console.log(
    `\nBrixx Caboteja — pending→new + Phase 2${isApply ? ' (APPLY)' : ' (DRY RUN)'}${
      isGenerate ? ' + GENERATE' : ''
    }\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`Manila today: ${todayYmdManila()}\n`);

  const client = await getClient();

  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error(`Student ${STUDENT_ID} / ${STUDENT_EMAIL} not found`);

    const enrollment = (
      await client.query(
        `SELECT classstudent_id, class_id, phase_number, program_enrollment_status,
                TO_CHAR(enrolled_at, 'YYYY-MM-DD HH24:MI') AS enrolled_wall,
                enrolled_by
         FROM classstudentstbl WHERE classstudent_id = $1`,
        [CLASSSTUDENT_ID]
      )
    ).rows[0];

    const phase1Invoice = (
      await client.query(
        `SELECT invoice_id, invoice_ar_number, status, amount, remarks,
                invoice_description, invoice_chain_root_id, installmentinvoiceprofiles_id,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue_date,
                TO_CHAR(due_date, 'YYYY-MM-DD') AS due_date
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE1_INVOICE_ID]
      )
    ).rows[0];

    const profile = (
      await client.query(
        `SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    const row = await loadProfileRow(client);
    const phase2Before = await loadPhaseInvoice(client, TARGET_PHASE);
    const statusBefore = (
      await client.query(
        `SELECT status, updated_reason FROM student_statustbl WHERE student_id = $1`,
        [STUDENT_ID]
      )
    ).rows[0];

    console.log('Student:', student.full_name, student.email);
    console.log('Enrollment:', enrollment);
    console.log('Phase 1 invoice:', {
      id: phase1Invoice?.invoice_id,
      ar: phase1Invoice?.invoice_ar_number,
      status: phase1Invoice?.status,
    });
    console.log('student_statustbl:', statusBefore);
    console.log('Queue:', {
      next_gen: ymd(row.next_generation_date),
      next_month: ymd(row.next_invoice_month),
      generated_count: row.generated_count,
      phase2: phase2Before?.invoice_id ?? 'none',
    });
    console.log('\nMatrix BEFORE:');
    console.table(await previewMatrix(query));

    if (!phase1Invoice || String(phase1Invoice.status).toLowerCase() !== 'paid') {
      throw new Error(`Phase 1 invoice ${PHASE1_INVOICE_ID} is not Paid`);
    }

    const needsPromote = enrollment?.program_enrollment_status === 'pending_enrollment';
    const needsQueue =
      !phase2Before &&
      (ymd(row.next_generation_date) !== TARGET_GENERATION_DATE ||
        ymd(row.next_invoice_month) !== TARGET_INVOICE_MONTH);

    console.log('\nPlanned:');
    if (needsPromote) console.log('  • Promote pending_enrollment → new');
    else console.log(`  • Enrollment already ${enrollment?.program_enrollment_status}`);
    if (needsQueue) {
      console.log(
        `  • Queue → ${TARGET_GENERATION_DATE} / ${TARGET_INVOICE_MONTH}`
      );
    }
    if (isGenerate && !phase2Before) {
      console.log(`  • Generate Phase ${TARGET_PHASE} (~${EXPECTED_ISSUE} / ${EXPECTED_DUE})`);
      console.log(
        `  • After generate queue → ${AFTER_GENERATE_NEXT_GEN} / ${AFTER_GENERATE_NEXT_MONTH}`
      );
    } else if (!phase2Before) {
      console.log('  • (Add --generate with --apply to create Phase 2)');
    }

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply [--generate].');
      return;
    }

    await client.query('BEGIN');

    if (needsPromote) {
      await syncInstallmentEnrollmentForPaidInvoice({
        client,
        profileId: PROFILE_ID,
        profile,
        studentId: STUDENT_ID,
        sourceLabel: REPAIR_NOTE,
        invoice: phase1Invoice,
      });
      console.log('✅ Promoted pending_enrollment → new');
    }

    if (!phase2Before) {
      await client.query(
        `UPDATE installmentinvoicestbl
         SET status = NULL,
             next_generation_date = $1::date,
             next_invoice_month = $2::date
         WHERE installmentinvoicedtl_id = $3`,
        [TARGET_GENERATION_DATE, TARGET_INVOICE_MONTH, row.installmentinvoicedtl_id]
      );
      console.log(`✅ Queue forced to ${TARGET_GENERATION_DATE} / ${TARGET_INVOICE_MONTH}`);
    }

    await client.query('COMMIT');

    if (isGenerate && !phase2Before) {
      console.log('\nGenerating Phase 2...');
      const fresh = await loadProfileRow(client);
      const generated = await generateInvoiceFromInstallment(
        {
          installmentinvoicedtl_id: fresh.installmentinvoicedtl_id,
          installmentinvoiceprofiles_id: fresh.installmentinvoiceprofiles_id,
          next_generation_date: TARGET_GENERATION_DATE,
          next_invoice_month: TARGET_INVOICE_MONTH,
          frequency: fresh.ii_frequency || fresh.frequency,
          total_amount_including_tax: fresh.total_amount_including_tax,
          total_amount_excluding_tax: fresh.total_amount_excluding_tax,
          status: fresh.ii_status,
        },
        {
          student_id: fresh.student_id,
          branch_id: fresh.branch_id,
          package_id: null,
          amount: fresh.amount,
          frequency: fresh.frequency,
          description: fresh.description,
          generated_count: fresh.generated_count,
          class_id: fresh.class_id,
          total_phases: fresh.total_phases,
          phase_start: fresh.phase_start,
          next_generation_date: TARGET_GENERATION_DATE,
        }
      );
      console.log('✅ Invoice generated:', {
        invoice_id: generated.invoice_id,
        amount: generated.amount,
        next_generation_date: generated.next_generation_date,
      });

      const phase2 = await loadPhaseInvoice(client, TARGET_PHASE);
      if (
        phase2 &&
        (phase2.issue_ymd !== EXPECTED_ISSUE || phase2.due_ymd !== EXPECTED_DUE)
      ) {
        await client.query(
          `UPDATE invoicestbl
           SET issue_date = ($1::date + TIME '12:00'),
               due_date = ($2::date + TIME '12:00'),
               late_penalty_applied_for_due_date = NULL
           WHERE invoice_id = $3`,
          [EXPECTED_ISSUE, EXPECTED_DUE, phase2.invoice_id]
        );
        console.log(
          `✅ Phase 2 dates → ${EXPECTED_ISSUE} / ${EXPECTED_DUE}`
        );
      }

      const afterRow = await loadProfileRow(client);
      if (
        ymd(afterRow.next_generation_date) !== AFTER_GENERATE_NEXT_GEN ||
        ymd(afterRow.next_invoice_month) !== AFTER_GENERATE_NEXT_MONTH
      ) {
        await client.query(
          `UPDATE installmentinvoicestbl
           SET status = NULL,
               next_generation_date = $1::date,
               next_invoice_month = $2::date
           WHERE installmentinvoicedtl_id = $3`,
          [AFTER_GENERATE_NEXT_GEN, AFTER_GENERATE_NEXT_MONTH, afterRow.installmentinvoicedtl_id]
        );
        console.log(
          `✅ Queue → ${AFTER_GENERATE_NEXT_GEN} / ${AFTER_GENERATE_NEXT_MONTH}`
        );
      }
    }

    const rowAfter = await loadProfileRow(client);
    const phase2After = await loadPhaseInvoice(client, TARGET_PHASE);
    const enrollAfter = (
      await client.query(
        `SELECT program_enrollment_status, TO_CHAR(enrolled_at, 'YYYY-MM-DD') AS enrolled_wall
         FROM classstudentstbl WHERE classstudent_id = $1`,
        [CLASSSTUDENT_ID]
      )
    ).rows[0];
    const statusAfter = (
      await client.query(
        `SELECT status FROM student_statustbl WHERE student_id = $1`,
        [STUDENT_ID]
      )
    ).rows[0];

    console.log('\nAFTER:');
    console.table([
      {
        enrollment: enrollAfter?.program_enrollment_status,
        student_status: statusAfter?.status,
        generated_count: rowAfter.generated_count,
        next_gen: ymd(rowAfter.next_generation_date),
        next_month: ymd(rowAfter.next_invoice_month),
        phase2_invoice: phase2After?.invoice_id ?? 'none',
        phase2_issue: phase2After?.issue_ymd ?? '—',
        phase2_due: phase2After?.due_ymd ?? '—',
        phase2_status: phase2After?.status ?? '—',
        target_phase: phase2After ? parseTargetPhase(phase2After.remarks) : '—',
      },
    ]);
    console.log('\nMatrix AFTER:');
    console.table(await previewMatrix(query));
    console.log(`\n${REPAIR_NOTE}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFailed:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
