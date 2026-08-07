/**
 * Anastasia Chrysanthe Catibog Yanga — generate missed Phase 2 (Jul 25 / Aug 5).
 *
 * Profile #494 · Class 153 VMM_Nursery_TThS 9:30 AM · Branch 1
 * Student 337 · mveravgc@gmail.com
 *
 * Phase 1 paid (INV-2054). Queue already at Aug 25 / Sep 01, so Phase 2
 * never generated on the July 25 cycle. Matrix currently Jul new / Aug Active.
 *
 * Expected after repair:
 *  - Phase 2 unpaid invoice issue 2026-07-25 / due 2026-08-05
 *  - Queue returns to Aug 25 / Sep 01
 *  - Matrix: Jul new / Aug Inactive (past due Aug 5 → under grace → Inactive)
 *
 * Run:
 *   node backend/scripts/repairAnastasiaYangaGeneratePhase2.js --production
 *   node backend/scripts/repairAnastasiaYangaGeneratePhase2.js --production --apply --generate
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { formatYmdLocal, todayYmdManila } from '../utils/dateUtils.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { generateInvoiceFromInstallment } from '../utils/installmentInvoiceGenerator.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'mveravgc@gmail.com';
const STUDENT_ID = 337;
const PROFILE_ID = 494;
const CLASS_ID = 153;
const BRANCH_ID = 1;
const TARGET_PHASE = 2;
const TARGET_GENERATION_DATE = '2026-07-25';
const TARGET_INVOICE_MONTH = '2026-08-01';
const AFTER_GENERATE_NEXT_GEN = '2026-08-25';
const AFTER_GENERATE_NEXT_MONTH = '2026-09-01';
const EXPECTED_ISSUE = '2026-07-25';
const EXPECTED_DUE = '2026-08-05';

const REPAIR_NOTE =
  'Ops repair 2026-08-07 — Anastasia Yanga missed Phase 2 (Jul 25 / Aug 5) + Aug Inactive';

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
  if (!track) return [];
  const cells = [];
  for (const m of matrix.months || []) {
    const c = track.months?.[m.key];
    if (!c) continue;
    if (c.mark === '1' || c.mark === '✓' || c.mark === 'X' || c.label) {
      cells.push({
        month: m.key,
        label: c.label,
        status: c.status,
        phase: c.phase_number,
        mark: c.mark,
      });
    }
  }
  return cells;
}

async function main() {
  console.log(
    `\nAnastasia Yanga — Phase 2 generate${isApply ? ' (APPLY)' : ' (DRY RUN)'}${
      isGenerate ? ' + GENERATE' : ''
    }\n`
  );
  console.log(`DB note: ${REPAIR_NOTE}`);
  console.log(`Manila today: ${todayYmdManila()}\n`);

  const client = await getClient();

  try {
    const row = await loadProfileRow(client);
    if (!row) throw new Error(`Profile ${PROFILE_ID} not found`);
    if (Number(row.student_id) !== STUDENT_ID) {
      throw new Error(`Profile student mismatch (expected ${STUDENT_ID})`);
    }
    if (row.student_email?.toLowerCase() !== STUDENT_EMAIL.toLowerCase()) {
      throw new Error(`Email mismatch (expected ${STUDENT_EMAIL})`);
    }
    if (Number(row.class_id) !== CLASS_ID) {
      throw new Error(`Class mismatch (expected ${CLASS_ID})`);
    }

    const phase1 = await loadPhaseInvoice(client, 1);
    const phase2Before = await loadPhaseInvoice(client, TARGET_PHASE);
    const matrixBefore = await previewMatrix(query);

    console.log('BEFORE:');
    console.table([
      {
        profile_id: row.installmentinvoiceprofiles_id,
        student: row.student_name,
        class: row.class_name,
        generated_count: row.generated_count,
        amount: row.amount,
        next_gen: ymd(row.next_generation_date),
        next_month: ymd(row.next_invoice_month),
        ii_status: row.ii_status ?? '—',
        phase1_invoice: phase1?.invoice_id ?? 'none',
        phase2_invoice: phase2Before?.invoice_id ?? 'none',
      },
    ]);
    console.log('BEFORE matrix:');
    console.table(matrixBefore);

    if (phase2Before) {
      console.log('\nPhase 2 already exists:');
      console.table([phase2Before]);
    }

    const needsQueue =
      !phase2Before &&
      (ymd(row.next_generation_date) !== TARGET_GENERATION_DATE ||
        ymd(row.next_invoice_month) !== TARGET_INVOICE_MONTH ||
        row.ii_status === 'Generated');

    console.log('\nPlanned:');
    if (needsQueue) {
      console.log(
        `  1. Queue: ${ymd(row.next_generation_date)} / ${ymd(row.next_invoice_month)} → ${TARGET_GENERATION_DATE} / ${TARGET_INVOICE_MONTH}`
      );
    } else if (!phase2Before) {
      console.log('  1. Queue already at Jul 25 / Aug 01');
    } else {
      console.log('  1. Phase 2 already present — no queue rewind');
    }
    if (!phase2Before) {
      console.log(
        `  2. Generate Phase ${TARGET_PHASE} (issue ${EXPECTED_ISSUE}, due ${EXPECTED_DUE})`
      );
      console.log(
        `  3. Post-generate queue → ${AFTER_GENERATE_NEXT_GEN} / ${AFTER_GENERATE_NEXT_MONTH}`
      );
      console.log('  4. Expect matrix: Jul new, Aug Inactive (unpaid due Aug 5, past due / grace)');
      if (!isGenerate) {
        console.log('  (Add --generate with --apply to create Phase 2)');
      }
    } else {
      console.log('  2. Phase 2 already present — ensure dates + queue + matrix');
    }

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply --generate to commit.');
      return;
    }

    if (!phase2Before) {
      await client.query('BEGIN');
      await client.query(
        `UPDATE installmentinvoicestbl
         SET status = NULL,
             next_generation_date = $1::date,
             next_invoice_month = $2::date,
             scheduled_date = $2::date + INTERVAL '4 days'
         WHERE installmentinvoicedtl_id = $3`,
        [TARGET_GENERATION_DATE, TARGET_INVOICE_MONTH, row.installmentinvoicedtl_id]
      );
      console.log(`✅ Queue forced to ${TARGET_GENERATION_DATE} / ${TARGET_INVOICE_MONTH}`);
      await client.query('COMMIT');
    }

    if (isGenerate && !phase2Before) {
      console.log('\nGenerating Phase 2...');
      const fresh = await loadProfileRow(client);
      const installmentInvoice = {
        installmentinvoicedtl_id: fresh.installmentinvoicedtl_id,
        installmentinvoiceprofiles_id: fresh.installmentinvoiceprofiles_id,
        next_generation_date: TARGET_GENERATION_DATE,
        next_invoice_month: TARGET_INVOICE_MONTH,
        frequency: fresh.ii_frequency || fresh.frequency,
        total_amount_including_tax: fresh.total_amount_including_tax,
        total_amount_excluding_tax: fresh.total_amount_excluding_tax,
        status: fresh.ii_status,
      };
      const profilePayload = {
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
      };

      const generated = await generateInvoiceFromInstallment(
        installmentInvoice,
        profilePayload
      );
      console.log('\n✅ Invoice generated:');
      console.table([
        {
          invoice_id: generated.invoice_id,
          phase: generated.phase_number,
          issue_date: generated.issue_date,
          due_date: generated.due_date,
          amount: generated.amount,
          next_generation_date: generated.next_generation_date,
        },
      ]);

      let phase2 = await loadPhaseInvoice(client, TARGET_PHASE);
      if (
        phase2 &&
        (phase2.issue_ymd !== EXPECTED_ISSUE || phase2.due_ymd !== EXPECTED_DUE)
      ) {
        await client.query(
          `UPDATE invoicestbl
           SET issue_date = ($1::date + TIME '12:00'),
               due_date = ($2::date + TIME '12:00'),
               late_penalty_applied_for_due_date = NULL,
               remarks = CASE
                 WHEN remarks ILIKE $4 THEN remarks
                 ELSE TRIM(BOTH ';' FROM COALESCE(remarks, '')) || ';' || $3
               END
           WHERE invoice_id = $5`,
          [
            EXPECTED_ISSUE,
            EXPECTED_DUE,
            REPAIR_NOTE,
            `%${REPAIR_NOTE}%`,
            phase2.invoice_id,
          ]
        );
        console.log(
          `✅ Phase 2 dates corrected to issue ${EXPECTED_ISSUE} / due ${EXPECTED_DUE} ` +
            `(was ${phase2.issue_ymd} / ${phase2.due_ymd})`
        );
        phase2 = await loadPhaseInvoice(client, TARGET_PHASE);
      } else if (phase2) {
        await client.query(
          `UPDATE invoicestbl
           SET remarks = CASE
                 WHEN remarks ILIKE $2 THEN remarks
                 ELSE TRIM(BOTH ';' FROM COALESCE(remarks, '')) || ';' || $1
               END
           WHERE invoice_id = $3`,
          [REPAIR_NOTE, `%${REPAIR_NOTE}%`, phase2.invoice_id]
        );
      }

      if (phase2?.invoice_id) {
        await syncProgramPaymentStatusForInvoice(client, phase2.invoice_id);
      }

      const afterRow = await loadProfileRow(client);
      const afterGen = ymd(afterRow.next_generation_date);
      const afterMonth = ymd(afterRow.next_invoice_month);
      if (afterGen !== AFTER_GENERATE_NEXT_GEN || afterMonth !== AFTER_GENERATE_NEXT_MONTH) {
        await client.query(
          `UPDATE installmentinvoicestbl
           SET status = NULL,
               next_generation_date = $1::date,
               next_invoice_month = $2::date,
               scheduled_date = $2::date + INTERVAL '4 days'
           WHERE installmentinvoicedtl_id = $3`,
          [AFTER_GENERATE_NEXT_GEN, AFTER_GENERATE_NEXT_MONTH, afterRow.installmentinvoicedtl_id]
        );
        console.log(
          `✅ Post-generate queue corrected to ${AFTER_GENERATE_NEXT_GEN} / ${AFTER_GENERATE_NEXT_MONTH}`
        );
      }
    } else if (isApply && phase2Before) {
      await client.query(
        `UPDATE invoicestbl
         SET issue_date = ($1::date + TIME '12:00'),
             due_date = ($2::date + TIME '12:00'),
             late_penalty_applied_for_due_date = NULL
         WHERE invoice_id = $3
           AND (
             TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') IS DISTINCT FROM $1
             OR TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') IS DISTINCT FROM $2
           )`,
        [EXPECTED_ISSUE, EXPECTED_DUE, phase2Before.invoice_id]
      );
      await client.query(
        `UPDATE installmentinvoicestbl
         SET status = NULL,
             next_generation_date = $1::date,
             next_invoice_month = $2::date,
             scheduled_date = $2::date + INTERVAL '4 days'
         WHERE installmentinvoicedtl_id = $3`,
        [AFTER_GENERATE_NEXT_GEN, AFTER_GENERATE_NEXT_MONTH, row.installmentinvoicedtl_id]
      );
      await syncProgramPaymentStatusForInvoice(client, phase2Before.invoice_id);
      console.log(
        `✅ Existing Phase 2 dates/queue synced (${EXPECTED_ISSUE}/${EXPECTED_DUE}, queue ${AFTER_GENERATE_NEXT_GEN}/${AFTER_GENERATE_NEXT_MONTH})`
      );
    } else if (isApply && !isGenerate) {
      console.log('\nQueue rewind applied. Re-run with --generate to create Phase 2.');
    }

    const rowAfter = await loadProfileRow(client);
    const phase2After = await loadPhaseInvoice(client, TARGET_PHASE);
    const matrixAfter = await previewMatrix(query);

    console.log('\nAFTER:');
    console.table([
      {
        generated_count: rowAfter.generated_count,
        next_gen: ymd(rowAfter.next_generation_date),
        next_month: ymd(rowAfter.next_invoice_month),
        phase2_invoice: phase2After?.invoice_id ?? 'none',
        phase2_issue: phase2After?.issue_ymd ?? '—',
        phase2_due: phase2After?.due_ymd ?? '—',
        phase2_status: phase2After?.status ?? '—',
        phase2_amount: phase2After?.amount ?? '—',
        target_phase: phase2After ? parseTargetPhase(phase2After.remarks) : '—',
      },
    ]);
    console.log('AFTER matrix:');
    console.table(matrixAfter);

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
