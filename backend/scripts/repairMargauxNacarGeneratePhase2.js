/**
 * Margaux Emilia Nacar — reset installment queue to July 25 / August 1 and generate Phase 2.
 *
 * Profile #483 (SOMO_JULY Pre-Kinder). Phase 1 paid (INV-1995); generated_count=1.
 * Queue had jumped to Aug 25 / Sep 01, so Phase 2 never generated on the July 25 cycle.
 * Manila today is 2026-07-25 → Phase 2 should exist.
 *
 * Steps:
 *  1. Force next_generation_date=2026-07-25, next_invoice_month=2026-08-01
 *  2. Generate Phase 2 invoice (--generate)
 *  3. Queue should advance to Aug 25 / Sep 01
 *
 * Run (from backend/):
 *   node scripts/repairMargauxNacarGeneratePhase2.js --production
 *   node scripts/repairMargauxNacarGeneratePhase2.js --production --apply
 *   node scripts/repairMargauxNacarGeneratePhase2.js --production --apply --generate
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { formatYmdLocal, todayYmdManila } from '../utils/dateUtils.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { generateInvoiceFromInstallment } from '../utils/installmentInvoiceGenerator.js';

const STUDENT_EMAIL = 'nepjuanillo@gmail.com';
const STUDENT_ID = 657;
const PROFILE_ID = 483;
const CLASS_ID = 154;
const TARGET_PHASE = 2;
const TARGET_GENERATION_DATE = '2026-07-25';
const TARGET_INVOICE_MONTH = '2026-08-01';
const AFTER_GENERATE_NEXT_GEN = '2026-08-25';
const AFTER_GENERATE_NEXT_MONTH = '2026-09-01';
const EXPECTED_ISSUE = '2026-07-25';
const EXPECTED_DUE = '2026-08-05';

const REPAIR_NOTE =
  'Ops repair — Margaux Nacar queue Jul 25 / Aug 01 + generate Phase 2';

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

async function main() {
  console.log(
    `\nMargaux Nacar — Phase 2 queue + generate${isApply ? ' (APPLY)' : ' (DRY RUN)'}${
      isGenerate ? ' + GENERATE' : ''
    }\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
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

    const phase2Before = await loadPhaseInvoice(client, TARGET_PHASE);

    console.log('BEFORE:');
    console.table([
      {
        profile_id: row.installmentinvoiceprofiles_id,
        student: row.student_name,
        generated_count: row.generated_count,
        next_gen: ymd(row.next_generation_date),
        next_month: ymd(row.next_invoice_month),
        ii_status: row.ii_status ?? '—',
        phase2_invoice: phase2Before?.invoice_id ?? 'none',
      },
    ]);

    if (phase2Before) {
      console.log('\nPhase 2 already exists:');
      console.table([phase2Before]);
    }

    const needsQueue =
      ymd(row.next_generation_date) !== TARGET_GENERATION_DATE ||
      ymd(row.next_invoice_month) !== TARGET_INVOICE_MONTH ||
      row.ii_status === 'Generated';

    console.log('\nPlanned:');
    if (needsQueue && !phase2Before) {
      console.log(
        `  • Queue: ${ymd(row.next_generation_date)} / ${ymd(row.next_invoice_month)} → ${TARGET_GENERATION_DATE} / ${TARGET_INVOICE_MONTH}`
      );
    } else if (!phase2Before) {
      console.log('  • Queue already at Jul 25 / Aug 01');
    }
    if (isGenerate && !phase2Before) {
      console.log(`  • Generate Phase ${TARGET_PHASE} (issue ~${EXPECTED_ISSUE}, due ~${EXPECTED_DUE})`);
      console.log(
        `  • After generate, queue should be ${AFTER_GENERATE_NEXT_GEN} / ${AFTER_GENERATE_NEXT_MONTH}`
      );
    } else if (!phase2Before) {
      console.log('  • (Add --generate with --apply to create Phase 2)');
    } else {
      console.log('  • Phase 2 already present — no generate needed');
    }

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply [--generate].');
      return;
    }

    if (!phase2Before) {
      await client.query('BEGIN');
      await client.query(
        `UPDATE installmentinvoicestbl
         SET status = NULL,
             next_generation_date = $1::date,
             next_invoice_month = $2::date
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
          `✅ Phase 2 dates corrected to issue ${EXPECTED_ISSUE} / due ${EXPECTED_DUE} ` +
            `(was ${phase2.issue_ymd} / ${phase2.due_ymd})`
        );
      }

      const afterRow = await loadProfileRow(client);
      const afterGen = ymd(afterRow.next_generation_date);
      const afterMonth = ymd(afterRow.next_invoice_month);
      if (afterGen !== AFTER_GENERATE_NEXT_GEN || afterMonth !== AFTER_GENERATE_NEXT_MONTH) {
        await client.query(
          `UPDATE installmentinvoicestbl
           SET status = NULL,
               next_generation_date = $1::date,
               next_invoice_month = $2::date
           WHERE installmentinvoicedtl_id = $3`,
          [AFTER_GENERATE_NEXT_GEN, AFTER_GENERATE_NEXT_MONTH, afterRow.installmentinvoicedtl_id]
        );
        console.log(
          `✅ Post-generate queue corrected to ${AFTER_GENERATE_NEXT_GEN} / ${AFTER_GENERATE_NEXT_MONTH}`
        );
      }
    } else if (isApply && phase2Before) {
      // Only sync queue forward if phase 2 already exists
      await client.query(
        `UPDATE installmentinvoicestbl
         SET status = NULL,
             next_generation_date = $1::date,
             next_invoice_month = $2::date
         WHERE installmentinvoicedtl_id = $3`,
        [AFTER_GENERATE_NEXT_GEN, AFTER_GENERATE_NEXT_MONTH, row.installmentinvoicedtl_id]
      );
      console.log(
        `✅ Queue set to ${AFTER_GENERATE_NEXT_GEN} / ${AFTER_GENERATE_NEXT_MONTH} (phase 2 already present)`
      );
    }

    const rowAfter = await loadProfileRow(client);
    const phase2After = await loadPhaseInvoice(client, TARGET_PHASE);

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
        target_phase: phase2After ? parseTargetPhase(phase2After.remarks) : '—',
      },
    ]);

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
