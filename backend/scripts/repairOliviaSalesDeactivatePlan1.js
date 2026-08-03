/**
 * Olivia Brie Sales — set Plan 1 (9:30AM Nursery) installment profile Inactive.
 *
 * Profile 128 | VMP_Nursery_TThS_9:30AM | phase_start 6
 * Last paid phase: Phase 7 (May 2026). Phases 8–9 unpaid dropped; Phase 10 unpaid locked.
 * Plan should be Inactive (no further auto-billing); Rejoin remains available in UI.
 *
 * Run:
 *   node backend/scripts/repairOliviaSalesDeactivatePlan1.js --production
 *   node backend/scripts/repairOliviaSalesDeactivatePlan1.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { formatYmdLocal } from '../utils/dateUtils.js';

const STUDENT_EMAIL = 'ladypipay24@gmail.com';
const STUDENT_ID = 272;
const PROFILE_ID = 128;
const CLASS_ID = 63;

const REPAIR_NOTE =
  'Ops repair 2026-08-01 — Olivia Sales deactivate Plan1 (last paid May; unpaid drops after)';

const isApply = process.argv.includes('--apply');

const ymd = (value) => {
  if (!value) return null;
  return formatYmdLocal(value).slice(0, 10);
};

async function main() {
  console.log(
    `\nOlivia Sales — deactivate Plan 1 profile${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
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

    const row = (
      await client.query(
        `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.class_id,
                ip.phase_start, ip.total_phases, ip.generated_count, ip.is_active,
                ii.installmentinvoicedtl_id, ii.status AS ii_status,
                ii.next_generation_date, ii.next_invoice_month,
                c.class_name
         FROM installmentinvoiceprofilestbl ip
         LEFT JOIN installmentinvoicestbl ii
           ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
         LEFT JOIN classestbl c ON c.class_id = ip.class_id
         WHERE ip.installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

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

    const invoices = (
      await client.query(
        `SELECT invoice_id, status, amount, remarks,
                TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due,
                (SELECT MAX(TO_CHAR(p.issue_date, 'YYYY-MM-DD'))
                   FROM paymenttbl p
                  WHERE p.invoice_id = i.invoice_id
                    AND p.status = 'Completed'
                    AND COALESCE(p.approval_status, 'Approved') = 'Approved') AS paid_on
         FROM invoicestbl i
         WHERE installmentinvoiceprofiles_id = $1
         ORDER BY invoice_id`,
        [PROFILE_ID]
      )
    ).rows.map((r) => ({
      inv: r.invoice_id,
      phase: parseTargetPhase(r.remarks),
      status: r.status,
      amount: r.amount,
      issue: r.issue,
      due: r.due,
      paid_on: r.paid_on,
    }));

    console.log('\nPlan 1 invoices:');
    console.table(invoices);

    const lastPaid = invoices
      .filter((i) => String(i.status).toLowerCase() === 'paid' && i.paid_on)
      .sort((a, b) => String(b.paid_on).localeCompare(String(a.paid_on)))[0];
    console.log(
      'Last paid:',
      lastPaid
        ? `Phase ${lastPaid.phase} INV-${lastPaid.inv} on ${lastPaid.paid_on}`
        : '(none)'
    );

    if (row.is_active === false) {
      console.log('\nAlready inactive — nothing to do.');
      return;
    }

    console.log('\nPlanned:');
    console.log(`  • installmentinvoiceprofilestbl ${PROFILE_ID}: is_active true → false`);
    console.log(`  • Note: ${REPAIR_NOTE}`);
    console.log('  • Queue dates left unchanged (Rejoin still available in UI)');

    if (!isApply) {
      console.log('\nDry run only — no writes. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET is_active = false
       WHERE installmentinvoiceprofiles_id = $1
         AND student_id = $2
         AND is_active = true
       RETURNING installmentinvoiceprofiles_id, is_active`,
      [PROFILE_ID, STUDENT_ID]
    );
    if (!updated.rows.length) {
      throw new Error('No profile row updated');
    }
    await client.query('COMMIT');

    console.log('✅ Updated:', updated.rows[0]);
    console.log('\n✅ Apply complete — Plan 1 status should show Inactive.');
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
