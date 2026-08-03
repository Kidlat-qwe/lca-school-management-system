/**
 * Olivia Brie Sales — generate Plan 2 Phase 6 installment invoice + queue.
 *
 * Profile 413 | VMP_NURSERY_TThS_11:00 AM | phase_start 3 | 8 local phases (3–10)
 * Phase 5 INV-1744 is Paid. Phase 6 should already be generated:
 *   - issue 2026-07-25, due 2026-08-05
 *   - after generate: next_generation_date 2026-08-25, next_invoice_month 2026-09-01
 *   - generated_count → 4
 *
 * Run:
 *   node backend/scripts/repairOliviaSalesGeneratePlan2Phase6.js --production
 *   node backend/scripts/repairOliviaSalesGeneratePlan2Phase6.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { formatYmdLocal } from '../utils/dateUtils.js';
import { generateInvoiceFromInstallment } from '../utils/installmentInvoiceGenerator.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'ladypipay24@gmail.com';
const STUDENT_ID = 272;
const PROFILE_ID = 413;
const CLASS_ID = 53;

const PHASE_6 = 6;
/** generated_count before creating phase 6 (phases 3–5 already billed). */
const GENERATED_COUNT_BEFORE = 3;
const GENERATED_COUNT_AFTER = 4;

const PHASE_6_ISSUE = '2026-07-25';
const PHASE_6_DUE = '2026-08-05';
/** Queue while generating phase 6 */
const QUEUE_BEFORE_GEN = '2026-07-25';
const QUEUE_BEFORE_MONTH = '2026-08-01';
/** Queue after phase 6 exists */
const QUEUE_AFTER_GEN = '2026-08-25';
const QUEUE_AFTER_MONTH = '2026-09-01';

const REPAIR_NOTE =
  'Ops repair 2026-08-01 — Olivia Sales Plan2 generate Phase 6 (Jul 25 / Aug 5); queue → Aug 25 / Sep 01';

const isApply = process.argv.includes('--apply');

const ymd = (value) => {
  if (!value) return null;
  return formatYmdLocal(value).slice(0, 10);
};

async function loadProfileRow(client) {
  const res = await client.query(
    `SELECT ip.*, ii.installmentinvoicedtl_id, ii.next_generation_date, ii.next_invoice_month,
            ii.status AS ii_status, ii.frequency AS ii_frequency,
            ii.total_amount_including_tax, ii.total_amount_excluding_tax,
            u.full_name, u.email, c.class_name
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
    `SELECT invoice_id, status, amount, invoice_ar_number, remarks,
            TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
            TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd
     FROM invoicestbl
     WHERE installmentinvoiceprofiles_id = $1
       AND remarks ILIKE $2
     ORDER BY invoice_id DESC
     LIMIT 1`,
    [PROFILE_ID, `%TARGET_PHASE:${absolutePhase}%`]
  );
  return res.rows[0] || null;
}

async function loadPlanInvoices(client) {
  const res = await client.query(
    `SELECT invoice_id, status, amount, remarks,
            TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
            TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd
     FROM invoicestbl
     WHERE installmentinvoiceprofiles_id = $1
     ORDER BY invoice_id`,
    [PROFILE_ID]
  );
  return res.rows.map((r) => ({
    ...r,
    phase: parseTargetPhase(r.remarks),
  }));
}

async function main() {
  console.log(
    `\nOlivia Sales — Plan2 generate Phase 6${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  let client;
  try {
    client = await getClient();

    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
        [STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student || Number(student.user_id) !== STUDENT_ID) {
      throw new Error(`Student ${STUDENT_EMAIL} (id ${STUDENT_ID}) not found`);
    }

    const row = await loadProfileRow(client);
    if (!row || Number(row.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found for student ${STUDENT_ID}`);
    }
    if (Number(row.class_id) !== CLASS_ID) {
      throw new Error(`Profile class_id=${row.class_id}, expected ${CLASS_ID}`);
    }

    console.log('Student:', student.full_name, student.email);
    console.log('Profile BEFORE:', {
      id: PROFILE_ID,
      class: row.class_name,
      phase_start: row.phase_start,
      total_phases: row.total_phases,
      generated_count: row.generated_count,
      is_active: row.is_active,
      ii_status: row.ii_status,
      next_gen: ymd(row.next_generation_date),
      next_month: ymd(row.next_invoice_month),
    });

    console.log('\nPlan invoices BEFORE:');
    console.table(await loadPlanInvoices(client));

    const phase6Before = await loadPhaseInvoice(client, PHASE_6);
    if (phase6Before) {
      console.log('\nPhase 6 already exists:');
      console.table([phase6Before]);
    } else {
      console.log('\nPhase 6: not found (will generate)');
    }

    console.log('\nPlanned:');
    if (!phase6Before) {
      console.log(
        `  1. Set generated_count=${GENERATED_COUNT_BEFORE}, is_active=true`
      );
      console.log(
        `  2. Queue → next_generation_date ${QUEUE_BEFORE_GEN}, next_invoice_month ${QUEUE_BEFORE_MONTH}`
      );
      console.log(`  3. generateInvoiceFromInstallment → Phase ${PHASE_6}`);
    } else {
      console.log(`  1. Keep existing Phase 6 INV-${phase6Before.invoice_id}`);
    }
    console.log(
      `  4. Force Phase 6 dates → issue ${PHASE_6_ISSUE}, due ${PHASE_6_DUE}`
    );
    console.log(
      `  5. generated_count → ${GENERATED_COUNT_AFTER}; queue → ${QUEUE_AFTER_GEN} / ${QUEUE_AFTER_MONTH}; status NULL; is_active true`
    );

    if (!isApply) {
      console.log('\nDry run only — no writes. Re-run with --apply to commit.');
      return;
    }

    let phase6Inv = phase6Before;

    if (!phase6Inv) {
      await client.query('BEGIN');
      await client.query(
        `UPDATE installmentinvoiceprofilestbl
         SET generated_count = $1, is_active = true
         WHERE installmentinvoiceprofiles_id = $2`,
        [GENERATED_COUNT_BEFORE, PROFILE_ID]
      );
      await client.query(
        `UPDATE installmentinvoicestbl
         SET status = NULL,
             next_generation_date = $1::date,
             next_invoice_month = $2::date
         WHERE installmentinvoicedtl_id = $3`,
        [QUEUE_BEFORE_GEN, QUEUE_BEFORE_MONTH, row.installmentinvoicedtl_id]
      );
      await client.query('COMMIT');
      console.log('✅ Profile prepared for Phase 6 generation');

      const fresh = await loadProfileRow(client);
      const installmentInvoice = {
        installmentinvoicedtl_id: fresh.installmentinvoicedtl_id,
        installmentinvoiceprofiles_id: fresh.installmentinvoiceprofiles_id,
        next_generation_date: fresh.next_generation_date,
        next_invoice_month: fresh.next_invoice_month,
        frequency: fresh.ii_frequency || fresh.frequency,
        total_amount_including_tax: fresh.total_amount_including_tax,
        total_amount_excluding_tax: fresh.total_amount_excluding_tax,
        status: fresh.ii_status,
      };

      const result = await generateInvoiceFromInstallment(installmentInvoice, {
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
      });
      console.log('✅ Generated invoice:', {
        invoice_id: result.invoice_id,
        issue: ymd(result.issue_date),
        due: ymd(result.due_date),
        phase: result.phase_number,
      });

      phase6Inv = await loadPhaseInvoice(client, PHASE_6);
      if (!phase6Inv) {
        throw new Error('Phase 6 invoice was not found after generation');
      }
    }

    await client.query('BEGIN');

    if (
      phase6Inv.issue_ymd !== PHASE_6_ISSUE ||
      phase6Inv.due_ymd !== PHASE_6_DUE
    ) {
      await client.query(
        `UPDATE invoicestbl
         SET issue_date = $1::date,
             due_date = $2::date,
             late_penalty_applied_for_due_date = NULL
         WHERE invoice_id = $3`,
        [PHASE_6_ISSUE, PHASE_6_DUE, phase6Inv.invoice_id]
      );
      await syncProgramPaymentStatusForInvoice(client, phase6Inv.invoice_id);
      console.log(`✅ Phase 6 dates set to ${PHASE_6_ISSUE} / ${PHASE_6_DUE}`);
    } else {
      console.log('✅ Phase 6 dates already correct');
    }

    // Append repair note once
    await client.query(
      `UPDATE invoicestbl
       SET remarks = CASE
         WHEN remarks ILIKE '%' || $2 || '%' THEN remarks
         WHEN remarks IS NULL OR TRIM(remarks) = '' THEN $2
         ELSE remarks || ' | ' || $2
       END
       WHERE invoice_id = $1`,
      [phase6Inv.invoice_id, REPAIR_NOTE]
    );

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = GREATEST(COALESCE(generated_count, 0), $1),
           is_active = true
       WHERE installmentinvoiceprofiles_id = $2`,
      [GENERATED_COUNT_AFTER, PROFILE_ID]
    );

    await client.query(
      `UPDATE installmentinvoicestbl
       SET status = NULL,
           next_generation_date = $1::date,
           next_invoice_month = $2::date
       WHERE installmentinvoicedtl_id = $3`,
      [QUEUE_AFTER_GEN, QUEUE_AFTER_MONTH, row.installmentinvoicedtl_id]
    );
    console.log(
      `✅ Queue → next_gen ${QUEUE_AFTER_GEN}, month ${QUEUE_AFTER_MONTH}; generated_count ≥ ${GENERATED_COUNT_AFTER}`
    );

    await client.query('COMMIT');

    const afterProfile = await loadProfileRow(client);
    const afterPhase6 = await loadPhaseInvoice(client, PHASE_6);
    console.log('\nProfile AFTER:', {
      generated_count: afterProfile.generated_count,
      is_active: afterProfile.is_active,
      ii_status: afterProfile.ii_status,
      next_gen: ymd(afterProfile.next_generation_date),
      next_month: ymd(afterProfile.next_invoice_month),
    });
    console.log('Phase 6 AFTER:');
    console.table([afterPhase6]);
    console.log('\nPlan invoices AFTER:');
    console.table(await loadPlanInvoices(client));
    console.log('\n✅ Apply complete.');
  } catch (err) {
    try {
      if (client) await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    console.error('\n❌ Repair failed:', err.message);
    throw err;
  } finally {
    if (client) client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
