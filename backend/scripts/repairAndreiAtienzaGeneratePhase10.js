/**
 * Andrei Caleb Ethan V. Atienza — generate Nursery Phase 10 invoice.
 *
 * Profile 97 | NC_Nursery_MWF_4:00-5:00PM | phase_start 6 | 5 local phases (6–10)
 * Queue was marked Generated / profile inactive after phase 9.
 *
 * Steps:
 *  1. Ensure generated_count = 4 (next absolute phase = 10)
 *  2. Reactivate profile; reset queue to 2026-06-25 / 2026-07-01
 *  3. Generate phase 10 invoice (issue 2026-06-25, due 2026-07-05)
 *  4. Mark profile inactive again (plan complete)
 *
 * Run:
 *   node backend/scripts/repairAndreiAtienzaGeneratePhase10.js
 *   node backend/scripts/repairAndreiAtienzaGeneratePhase10.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import { buildPhaseInstallmentSchedule } from '../utils/phaseInstallmentUtils.js';
import { formatYmdLocal } from '../utils/dateUtils.js';
import { generateInvoiceFromInstallment } from '../utils/installmentInvoiceGenerator.js';

const STUDENT_EMAIL = 'juliven_atienza@lifelinediag.com';
const STUDENT_ID = 247;
const PROFILE_ID = 97;
const CLASS_ID = 58;
const PHASE_10 = 10;
const PHASE_10_ISSUE = '2026-06-25';
const PHASE_10_DUE = '2026-07-05';
const QUEUE_MONTH = '2026-07-01';
const REPAIR_NOTE =
  'Ops repair 2026-07-13 — Andrei Atienza generate Nursery phase 10';

const isApply = process.argv.includes('--apply');

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
    `SELECT invoice_id, status, amount,
            TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
            TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd,
            remarks
     FROM invoicestbl
     WHERE installmentinvoiceprofiles_id = $1
       AND remarks ILIKE $2
     ORDER BY invoice_id DESC
     LIMIT 1`,
    [PROFILE_ID, `%TARGET_PHASE:${absolutePhase}%`]
  );
  return res.rows[0] || null;
}

async function main() {
  console.log(
    `\nAndrei Atienza — generate Nursery phase 10${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();

  try {
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
    console.log('Profile:', {
      id: PROFILE_ID,
      class: row.class_name,
      phase_start: row.phase_start,
      total_phases: row.total_phases,
      generated_count: row.generated_count,
      is_active: row.is_active,
      ii_status: row.ii_status,
      next_generation_date: row.next_generation_date,
    });
    console.log('Note:', REPAIR_NOTE);

    const phase10Before = await loadPhaseInvoice(client, PHASE_10);
    if (phase10Before) {
      console.log('\nPhase 10 already exists:');
      console.table([phase10Before]);
      return;
    }

    const workingCount = Math.min(
      parseInt(row.generated_count || 0, 10),
      parseInt(row.total_phases || 5, 10) - 1
    );

    const sched = await buildPhaseInstallmentSchedule({
      db: client,
      profile: { ...row, generated_count: workingCount },
      generatedCountOverride: workingCount,
      generationAnchorYmd: PHASE_10_ISSUE,
    });

    console.log('\nPlanned:');
    console.log(`  • generated_count → ${workingCount} (next absolute phase ${PHASE_10})`);
    console.log(`  • is_active → true (temporarily)`);
    console.log('  • class status → Active temporarily if currently Inactive');
    console.log(
      `  • queue → next_generation_date ${PHASE_10_ISSUE}, next_invoice_month ${QUEUE_MONTH}, status NULL`
    );
    console.log(
      `  • generate phase ${PHASE_10}: issue ${PHASE_10_ISSUE}, due ${PHASE_10_DUE}`
    );
    console.log('  • restore class Inactive (if flipped); profile inactive after generation');
    if (sched?.current_phase_number != null) {
      console.log('  • schedule current_phase_number:', sched.current_phase_number);
      console.log('  • schedule current_issue_date:', sched.current_issue_date);
      console.log('  • schedule current_due_date:', sched.current_due_date);
    }

    if (!isApply) {
      console.log('\nDry run complete. Re-run with --apply to generate.');
      return;
    }

    await client.query('BEGIN');

    const classBefore = (
      await client.query(`SELECT status FROM classestbl WHERE class_id = $1`, [CLASS_ID])
    ).rows[0];
    const classWasInactive =
      String(classBefore?.status || '').toLowerCase() === 'inactive';
    if (classWasInactive) {
      await client.query(
        `UPDATE classestbl SET status = 'Active' WHERE class_id = $1`,
        [CLASS_ID]
      );
      console.log('✅ Class temporarily set Active for generation.');
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = $1, is_active = true
       WHERE installmentinvoiceprofiles_id = $2`,
      [workingCount, PROFILE_ID]
    );

    await client.query(
      `UPDATE installmentinvoicestbl
       SET status = NULL,
           next_generation_date = $1::date,
           next_invoice_month = $2::date
       WHERE installmentinvoicedtl_id = $3`,
      [PHASE_10_ISSUE, QUEUE_MONTH, row.installmentinvoicedtl_id]
    );

    await client.query('COMMIT');
    console.log('\n✅ Profile reactivated; queue set for phase 10.');

    let generateError = null;
    let result = null;
    try {
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

      result = await generateInvoiceFromInstallment(installmentInvoice, {
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
    } catch (err) {
      generateError = err;
    }

    // Always restore class status if we flipped it.
    if (classWasInactive) {
      await client.query(
        `UPDATE classestbl SET status = 'Inactive' WHERE class_id = $1`,
        [CLASS_ID]
      );
      console.log('✅ Class status restored to Inactive.');
    }

    if (generateError) throw generateError;

    console.log('✅ Generated invoice:', {
      invoice_id: result.invoice_id,
      issue: formatYmdLocal(result.issue_date),
      due: formatYmdLocal(result.due_date),
      phase: result.phase_number,
    });

    const phase10Inv = await loadPhaseInvoice(client, PHASE_10);
    if (!phase10Inv) {
      throw new Error('Phase 10 invoice was not found after generation');
    }

    if (
      phase10Inv.issue_ymd !== PHASE_10_ISSUE ||
      phase10Inv.due_ymd !== PHASE_10_DUE
    ) {
      await client.query(
        `UPDATE invoicestbl
         SET issue_date = $1::date, due_date = $2::date,
             late_penalty_applied_for_due_date = NULL
         WHERE invoice_id = $3`,
        [PHASE_10_ISSUE, PHASE_10_DUE, phase10Inv.invoice_id]
      );
      await syncProgramPaymentStatusForInvoice(client, phase10Inv.invoice_id);
      console.log(`✅ Phase 10 dates corrected to ${PHASE_10_ISSUE} / ${PHASE_10_DUE}`);
    }

    // Plan complete — keep inactive (matches prior ops state).
    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET is_active = false, generated_count = GREATEST(COALESCE(generated_count, 0), $1)
       WHERE installmentinvoiceprofiles_id = $2`,
      [parseInt(row.total_phases || 5, 10), PROFILE_ID]
    );
    await client.query(
      `UPDATE installmentinvoicestbl
       SET status = 'Generated', next_generation_date = NULL, next_invoice_month = NULL
       WHERE installmentinvoicedtl_id = $1`,
      [row.installmentinvoicedtl_id]
    );
    console.log('✅ Profile marked inactive; queue marked Generated (plan complete).');

    const after = await loadPhaseInvoice(client, PHASE_10);
    const profileAfter = await loadProfileRow(client);
    console.log('\nPhase 10 AFTER:');
    console.table([
      {
        invoice_id: after.invoice_id,
        status: after.status,
        amount: after.amount,
        phase: parseTargetPhase(after.remarks),
        issue: after.issue_ymd,
        due: after.due_ymd,
      },
    ]);
    console.log('Profile AFTER:', {
      generated_count: profileAfter.generated_count,
      is_active: profileAfter.is_active,
      ii_status: profileAfter.ii_status,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // Best-effort restore class if generation failed mid-flight.
    try {
      await client.query(
        `UPDATE classestbl SET status = 'Inactive' WHERE class_id = $1 AND status = 'Active'`,
        [CLASS_ID]
      );
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
