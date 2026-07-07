/**
 * Franco Daniel Miranda — correct installment invoice issue/due dates
 * for phases 8–10 (profile 134, VMP_Pre-Kindergarten_MWF_11AM).
 *
 *   Phase 8 — issue 2026-04-25, due 2026-05-05  (INV-793)
 *   Phase 9 — issue 2026-05-25, due 2026-06-05  (INV-1523)
 *   Phase 10 — issue 2026-06-25, due 2026-07-05 (create if missing)
 *
 * Run:
 *   node backend/scripts/repairFrancoMirandaInstallmentPhases8To10.js
 *   node backend/scripts/repairFrancoMirandaInstallmentPhases8To10.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { insertInvoiceWithArNumber } from '../utils/invoiceArNumber.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'harveymiranda368@gmail.com';
const STUDENT_ID = 281;
const PROFILE_ID = 134;
const CLASS_ID = 64;
const PHASE_AMOUNT = '4999.00';
const REPAIR_NOTE = 'Ops repair 2026-07-07 — Franco Miranda phases 8–10 issue/due dates';

const PHASE_8_INVOICE_ID = 793;
const PHASE_9_INVOICE_ID = 1523;
const TEMPLATE_INVOICE_ID = 1523;

const PHASE_TARGETS = {
  [PHASE_8_INVOICE_ID]: {
    absolute_phase: 8,
    issue_date: '2026-04-25',
    due_date: '2026-05-05',
  },
  [PHASE_9_INVOICE_ID]: {
    absolute_phase: 9,
    issue_date: '2026-05-25',
    due_date: '2026-06-05',
  },
};

const PHASE_10 = {
  absolute_phase: 10,
  issue_date: '2026-06-25',
  due_date: '2026-07-05',
};

const isApply = process.argv.includes('--apply');
const ymd = (value) => (value == null ? '' : String(value).slice(0, 10));

async function clearInvoicePenalty(client, invoiceId) {
  const penaltyItems = await client.query(
    `SELECT invoice_item_id FROM invoiceitemstbl
     WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
    [invoiceId]
  );
  if (!penaltyItems.rows.length) return false;

  for (const row of penaltyItems.rows) {
    await client.query(
      `UPDATE invoiceitemstbl SET amount = 0, penalty_amount = 0 WHERE invoice_item_id = $1`,
      [row.invoice_item_id]
    );
  }
  await client.query(
    `DELETE FROM invoiceitemstbl
     WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
    [invoiceId]
  );

  const totals = await client.query(
    `SELECT COALESCE(SUM(amount), 0) - COALESCE(SUM(discount_amount), 0)
            + COALESCE(SUM(penalty_amount), 0) AS grand
     FROM invoiceitemstbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const grand = Number(totals.rows[0]?.grand || 0);
  await client.query(
    `UPDATE invoicestbl
     SET amount = $1, late_penalty_applied_for_due_date = NULL
     WHERE invoice_id = $2`,
    [grand, invoiceId]
  );
  return true;
}

async function findPhase10Invoice(client) {
  const rows = (
    await client.query(
      `SELECT invoice_id, status,
              TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
              TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd,
              remarks
       FROM invoicestbl
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    )
  ).rows;
  return rows.find((row) => parseTargetPhase(row.remarks) === PHASE_10.absolute_phase) || null;
}

async function createPhase10Invoice(client, profile, templateInvoice) {
  const phase10Remarks =
    `Auto-generated from installment invoice: ${profile.description || 'Installment payment'};TARGET_PHASE:${PHASE_10.absolute_phase};${REPAIR_NOTE}`;

  const created = await insertInvoiceWithArNumber(
    client,
    `INSERT INTO invoicestbl (
       invoice_description, branch_id, amount, status, remarks, issue_date, due_date,
       created_by, installmentinvoiceprofiles_id, invoice_ar_number
     ) VALUES ($1, $2, $3, 'Unpaid', $4, $5::date, $6::date, $7, $8, $9)
     RETURNING invoice_id, invoice_ar_number`,
    [
      'TEMP',
      templateInvoice.branch_id,
      PHASE_AMOUNT,
      phase10Remarks,
      PHASE_10.issue_date,
      PHASE_10.due_date,
      templateInvoice.created_by,
      PROFILE_ID,
    ]
  );

  const phase10InvoiceId = created.invoice_id;

  await client.query(
    `UPDATE invoicestbl SET invoice_description = $1 WHERE invoice_id = $2`,
    [`INV-${phase10InvoiceId}`, phase10InvoiceId]
  );

  const templateItem = (
    await client.query(
      `SELECT description, tax_item, tax_percentage
       FROM invoiceitemstbl
       WHERE invoice_id = $1
       ORDER BY invoice_item_id
       LIMIT 1`,
      [TEMPLATE_INVOICE_ID]
    )
  ).rows[0];

  await client.query(
    `INSERT INTO invoiceitemstbl (
       invoice_id, description, amount, tax_item, tax_percentage,
       discount_amount, penalty_amount
     ) VALUES ($1, $2, $3, $4, $5, 0, 0)`,
    [
      phase10InvoiceId,
      templateItem?.description || `Installment Phase ${PHASE_10.absolute_phase}`,
      PHASE_AMOUNT,
      templateItem?.tax_item ?? null,
      templateItem?.tax_percentage ?? 0,
    ]
  );

  const linkedStudents = await client.query(
    `SELECT student_id FROM invoicestudentstbl WHERE invoice_id = $1`,
    [TEMPLATE_INVOICE_ID]
  );
  for (const row of linkedStudents.rows) {
    const exists = await client.query(
      `SELECT 1 FROM invoicestudentstbl WHERE invoice_id = $1 AND student_id = $2`,
      [phase10InvoiceId, row.student_id]
    );
    if (!exists.rows.length) {
      await client.query(
        `INSERT INTO invoicestudentstbl (invoice_id, student_id) VALUES ($1, $2)`,
        [phase10InvoiceId, row.student_id]
      );
    }
  }

  return phase10InvoiceId;
}

async function main() {
  console.log(
    `\nFranco Miranda — phases 8–10 issue/due repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  const changes = [];

  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
        [STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student || Number(student.user_id) !== STUDENT_ID) {
      throw new Error(`Student ${STUDENT_EMAIL} not found`);
    }

    const profile = (
      await client.query(`SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`, [
        PROFILE_ID,
      ])
    ).rows[0];
    if (!profile || Number(profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found for student ${STUDENT_ID}`);
    }
    if (Number(profile.class_id) !== CLASS_ID) {
      throw new Error(`Profile class mismatch: expected ${CLASS_ID}, got ${profile.class_id}`);
    }

    console.log('Student:', student.full_name);
    console.log('Profile:', {
      id: PROFILE_ID,
      phase_start: profile.phase_start,
      generated_count: profile.generated_count,
      total_phases: profile.total_phases,
      is_active: profile.is_active,
      class_id: profile.class_id,
    });

    for (const [invoiceIdStr, target] of Object.entries(PHASE_TARGETS)) {
      const invoiceId = Number(invoiceIdStr);
      const inv = (
        await client.query(
          `SELECT invoice_id, status, amount, remarks,
                  issue_date::text AS issue_date,
                  due_date::text AS due_date,
                  installmentinvoiceprofiles_id
           FROM invoicestbl WHERE invoice_id = $1`,
          [invoiceId]
        )
      ).rows[0];

      if (!inv) throw new Error(`Invoice ${invoiceId} not found`);
      if (Number(inv.installmentinvoiceprofiles_id) !== PROFILE_ID) {
        throw new Error(`Invoice ${invoiceId} not on profile ${PROFILE_ID}`);
      }

      const curIssue = ymd(inv.issue_date);
      const curDue = ymd(inv.due_date);
      const curTp = parseTargetPhase(inv.remarks);
      const hasPenalty = Number(inv.amount) > Number(PHASE_AMOUNT) + 0.01;

      if (
        curIssue !== target.issue_date ||
        curDue !== target.due_date ||
        curTp !== target.absolute_phase ||
        hasPenalty
      ) {
        changes.push({
          action: hasPenalty ? 'update_dates_clear_penalty' : 'update_dates',
          invoice_id: invoiceId,
          phase: target.absolute_phase,
          status: inv.status,
          amount: inv.amount,
          from_issue: curIssue,
          from_due: curDue,
          to_issue: target.issue_date,
          to_due: target.due_date,
        });
      }
    }

    const phase10 = await findPhase10Invoice(client);
    if (phase10) {
      if (
        phase10.issue_ymd !== PHASE_10.issue_date ||
        phase10.due_ymd !== PHASE_10.due_date
      ) {
        changes.push({
          action: 'update_dates',
          invoice_id: phase10.invoice_id,
          phase: PHASE_10.absolute_phase,
          status: phase10.status,
          from_issue: phase10.issue_ymd,
          from_due: phase10.due_ymd,
          to_issue: PHASE_10.issue_date,
          to_due: PHASE_10.due_date,
        });
      }
    } else {
      changes.push({
        action: 'create_invoice',
        invoice_id: '(new)',
        phase: PHASE_10.absolute_phase,
        status: 'Unpaid',
        from_issue: '—',
        from_due: '—',
        to_issue: PHASE_10.issue_date,
        to_due: PHASE_10.due_date,
      });
    }

    const targetGeneratedCount = parseInt(profile.total_phases || 4, 10);
    if (parseInt(profile.generated_count || 0, 10) !== targetGeneratedCount) {
      changes.push({
        action: 'profile_generated_count',
        invoice_id: '—',
        phase: '—',
        status: `${profile.generated_count} → ${targetGeneratedCount}`,
        from_issue: '—',
        from_due: '—',
        to_issue: '—',
        to_due: '—',
      });
    }

    if (!changes.length) {
      console.log('\nNo changes needed — dates already match requested cadence.');
      return;
    }

    console.log('\nPlanned changes:');
    console.table(changes);

    if (!isApply) {
      console.log('\nRe-run with --apply to write changes.');
      return;
    }

    await client.query('BEGIN');

    for (const [invoiceIdStr, target] of Object.entries(PHASE_TARGETS)) {
      const invoiceId = Number(invoiceIdStr);
      const inv = (
        await client.query(`SELECT status, amount FROM invoicestbl WHERE invoice_id = $1`, [invoiceId])
      ).rows[0];

      await client.query(
        `UPDATE invoicestbl
         SET issue_date = $1::date,
             due_date = $2::date,
             late_penalty_applied_for_due_date = NULL
         WHERE invoice_id = $3`,
        [target.issue_date, target.due_date, invoiceId]
      );

      const cleared = await clearInvoicePenalty(client, invoiceId);
      if (cleared) {
        console.log(`✅ Cleared penalty on INV ${invoiceId}`);
      }

      await client.query(
        `DELETE FROM invoiceitemstbl
         WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
        [invoiceId]
      );

      await syncProgramPaymentStatusForInvoice(client, invoiceId);
      console.log(
        `✅ Phase ${target.absolute_phase} INV ${invoiceId} (${inv?.status}) → ${target.issue_date}/${target.due_date}`
      );
    }

    let phase10InvoiceId = phase10?.invoice_id ?? null;
    if (!phase10InvoiceId) {
      const templateInvoice = (
        await client.query(`SELECT * FROM invoicestbl WHERE invoice_id = $1`, [TEMPLATE_INVOICE_ID])
      ).rows[0];
      if (!templateInvoice) throw new Error(`Template invoice ${TEMPLATE_INVOICE_ID} not found`);

      phase10InvoiceId = await createPhase10Invoice(client, profile, templateInvoice);
      await syncProgramPaymentStatusForInvoice(client, phase10InvoiceId);
      console.log(
        `✅ Created Phase 10 INV ${phase10InvoiceId} unpaid ${PHASE_10.issue_date}/${PHASE_10.due_date}`
      );
    } else if (
      phase10.issue_ymd !== PHASE_10.issue_date ||
      phase10.due_ymd !== PHASE_10.due_date
    ) {
      await client.query(
        `UPDATE invoicestbl
         SET issue_date = $1::date, due_date = $2::date, late_penalty_applied_for_due_date = NULL
         WHERE invoice_id = $3`,
        [PHASE_10.issue_date, PHASE_10.due_date, phase10InvoiceId]
      );
      await syncProgramPaymentStatusForInvoice(client, phase10InvoiceId);
      console.log(
        `✅ Phase 10 INV ${phase10InvoiceId} → ${PHASE_10.issue_date}/${PHASE_10.due_date}`
      );
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = $1,
           is_active = false
       WHERE installmentinvoiceprofiles_id = $2`,
      [targetGeneratedCount, PROFILE_ID]
    );
    console.log(`✅ Profile generated_count=${targetGeneratedCount}, is_active=false (final phase generated)`);

    const ii = (
      await client.query(`SELECT installmentinvoicedtl_id FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1`, [
        PROFILE_ID,
      ])
    ).rows[0];
    if (ii) {
      await client.query(
        `UPDATE installmentinvoicestbl
         SET status = 'Generated',
             next_generation_date = NULL,
             next_invoice_month = NULL
         WHERE installmentinvoicedtl_id = $1`,
        [ii.installmentinvoicedtl_id]
      );
      console.log('✅ Installment queue closed (all phases generated)');
    }

    await client.query('COMMIT');

    const verify = (
      await client.query(
        `SELECT invoice_id, status, amount, remarks,
                TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
         ORDER BY invoice_id`,
        [PROFILE_ID]
      )
    ).rows;

    console.log('\nAfter repair:');
    console.table(
      verify.map((r) => ({
        invoice_id: r.invoice_id,
        target_phase: parseTargetPhase(r.remarks),
        issue: r.issue,
        due: r.due,
        amount: r.amount,
        status: r.status,
      }))
    );

    console.log('\n✅ Done. Refresh Student History → Invoices for Franco Miranda.');
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
    console.error('\nFailed:', err.message || err);
    process.exit(1);
  });
