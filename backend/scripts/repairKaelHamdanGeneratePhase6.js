/**
 * Kael Devin Burayag Hamdan (myrna01@gmail.com, user 524) —
 * Generate missing Phase 6 on Playgroup installment (profile 307, class 91).
 *
 * After remap P3–7 → P1–5, phases 1–5 are paid; Phase 6 was left Not Generated.
 * Ops: issue 2026-08-25 / due 2026-09-05.
 *
 * Expected after --apply --generate:
 *  - Phase 6 unpaid invoice issue 2026-08-25 / due 2026-09-05
 *  - generated_count = 6
 *  - Queue advances to 2026-09-25 / 2026-10-01 (next Phase 7)
 *
 * Run (from backend/):
 *   node scripts/repairKaelHamdanGeneratePhase6.js --production
 *   node scripts/repairKaelHamdanGeneratePhase6.js --production --apply --generate
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { formatYmdLocal, todayYmdManila } from '../utils/dateUtils.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { generateInvoiceFromInstallment } from '../utils/installmentInvoiceGenerator.js';
import { isPhaseInstallmentProfile } from '../utils/phaseInstallmentUtils.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'myrna01@gmail.com';
const STUDENT_ID = 524;
const PROFILE_ID = 307;
const CLASS_ID = 91;
const TARGET_PHASE = 6;
const TARGET_GENERATION_DATE = '2026-08-25';
const TARGET_INVOICE_MONTH = '2026-09-01';
const AFTER_GENERATE_NEXT_GEN = '2026-09-25';
const AFTER_GENERATE_NEXT_MONTH = '2026-10-01';
const EXPECTED_ISSUE = '2026-08-25';
const EXPECTED_DUE = '2026-09-05';
const EXPECTED_GENERATED_COUNT = 6;

const REPAIR_NOTE =
  'Ops repair 2026-09-08 — Kael Hamdan generate Phase 6 (Aug 25 / Sep 5)';

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
            ip.description, ip.package_id,
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
       AND COALESCE(i.status, '') <> 'Cancelled'
     ORDER BY i.invoice_id DESC
     LIMIT 1`,
    [PROFILE_ID, `%TARGET_PHASE:${absolutePhase}%`]
  );
  return res.rows[0] || null;
}

async function main() {
  console.log(
    `\nKael Hamdan — generate Phase 6${isApply ? ' (APPLY)' : ' (DRY RUN)'}${
      isGenerate ? ' + GENERATE' : ''
    }\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB note / Manila today: ${todayYmdManila()}\n`);

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
    if (!isPhaseInstallmentProfile(row)) {
      throw new Error('Profile is not a phase installment plan');
    }

    const phase5 = await loadPhaseInvoice(client, 5);
    const phase6Before = await loadPhaseInvoice(client, TARGET_PHASE);

    console.log('BEFORE:');
    console.table([
      {
        student: row.student_name,
        class: row.class_name,
        phase_start: row.phase_start,
        total_phases: row.total_phases,
        generated_count: row.generated_count,
        amount: row.amount,
        next_gen: ymd(row.next_generation_date),
        next_month: ymd(row.next_invoice_month),
        ii_status: row.ii_status ?? '—',
        phase5_invoice: phase5?.invoice_id ?? 'none',
        phase6_invoice: phase6Before?.invoice_id ?? 'none',
      },
    ]);

    if (phase6Before) {
      console.log('\nPhase 6 already exists:');
      console.table([phase6Before]);
    }

    const needsQueue =
      !phase6Before &&
      (ymd(row.next_generation_date) !== TARGET_GENERATION_DATE ||
        ymd(row.next_invoice_month) !== TARGET_INVOICE_MONTH ||
        row.ii_status === 'Generated');

    console.log('\nPlanned:');
    if (needsQueue) {
      console.log(
        `  1. Queue: ${ymd(row.next_generation_date)} / ${ymd(row.next_invoice_month)} → ${TARGET_GENERATION_DATE} / ${TARGET_INVOICE_MONTH}`
      );
    } else if (!phase6Before) {
      console.log(
        `  1. Queue already at ${TARGET_GENERATION_DATE} / ${TARGET_INVOICE_MONTH}`
      );
    } else {
      console.log('  1. Phase 6 already present — no queue rewind');
    }
    if (!phase6Before) {
      console.log(
        `  2. Generate Phase ${TARGET_PHASE} (issue ${EXPECTED_ISSUE}, due ${EXPECTED_DUE})`
      );
      console.log(
        `  3. Post-generate queue → ${AFTER_GENERATE_NEXT_GEN} / ${AFTER_GENERATE_NEXT_MONTH}; generated_count → ${EXPECTED_GENERATED_COUNT}`
      );
      if (!isGenerate) {
        console.log('  (Add --generate with --apply to create Phase 6)');
      }
    } else {
      console.log('  2. Phase 6 already present — ensure dates + queue');
    }

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply --generate to commit.');
      return;
    }

    if (!phase6Before && needsQueue) {
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

    if (isGenerate && !phase6Before) {
      console.log('\nGenerating Phase 6...');
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
        package_id: fresh.package_id,
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

      let phase6 = await loadPhaseInvoice(client, TARGET_PHASE);
      if (
        phase6 &&
        (phase6.issue_ymd !== EXPECTED_ISSUE || phase6.due_ymd !== EXPECTED_DUE)
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
            phase6.invoice_id,
          ]
        );
        console.log(
          `✅ Phase 6 dates corrected to issue ${EXPECTED_ISSUE} / due ${EXPECTED_DUE} ` +
            `(was ${phase6.issue_ymd} / ${phase6.due_ymd})`
        );
        phase6 = await loadPhaseInvoice(client, TARGET_PHASE);
      } else if (phase6) {
        await client.query(
          `UPDATE invoicestbl
           SET remarks = CASE
                 WHEN remarks ILIKE $2 THEN remarks
                 ELSE TRIM(BOTH ';' FROM COALESCE(remarks, '')) || ';' || $1
               END
           WHERE invoice_id = $3`,
          [REPAIR_NOTE, `%${REPAIR_NOTE}%`, phase6.invoice_id]
        );
      }

      if (phase6?.invoice_id) {
        await syncProgramPaymentStatusForInvoice(client, phase6.invoice_id);
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
    } else if (isApply && phase6Before) {
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
        [EXPECTED_ISSUE, EXPECTED_DUE, phase6Before.invoice_id]
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
      await syncProgramPaymentStatusForInvoice(client, phase6Before.invoice_id);
      console.log(
        `✅ Existing Phase 6 dates/queue synced (${EXPECTED_ISSUE}/${EXPECTED_DUE}, queue ${AFTER_GENERATE_NEXT_GEN}/${AFTER_GENERATE_NEXT_MONTH})`
      );
    } else if (isApply && !isGenerate) {
      console.log('\nQueue rewind applied. Re-run with --generate to create Phase 6.');
    }

    const rowAfter = await loadProfileRow(client);
    const phase6After = await loadPhaseInvoice(client, TARGET_PHASE);

    console.log('\nAFTER:');
    console.table([
      {
        generated_count: rowAfter.generated_count,
        next_gen: ymd(rowAfter.next_generation_date),
        next_month: ymd(rowAfter.next_invoice_month),
        phase6_invoice: phase6After?.invoice_id ?? 'none',
        phase6_issue: phase6After?.issue_ymd ?? '—',
        phase6_due: phase6After?.due_ymd ?? '—',
        phase6_status: phase6After?.status ?? '—',
        phase6_amount: phase6After?.amount ?? '—',
        target_phase: phase6After ? parseTargetPhase(phase6After.remarks) : '—',
      },
    ]);

    if (isGenerate && phase6After) {
      if (phase6After.issue_ymd !== EXPECTED_ISSUE || phase6After.due_ymd !== EXPECTED_DUE) {
        throw new Error(
          `Phase 6 dates mismatch: got ${phase6After.issue_ymd}/${phase6After.due_ymd}`
        );
      }
      if (Number(rowAfter.generated_count) !== EXPECTED_GENERATED_COUNT) {
        throw new Error(
          `generated_count expected ${EXPECTED_GENERATED_COUNT}, got ${rowAfter.generated_count}`
        );
      }
      console.log('\n✅ Phase 6 generate verified.');
    }

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
