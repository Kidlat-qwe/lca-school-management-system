/**
 * Marianna Agatha Romero — ensure phase 5 invoice is generated (unpaid).
 *
 * Target:
 *   - Phase 4: paid (INV-1354, TARGET_PHASE:4)
 *   - Phase 5: unpaid generated INV, issue 2026-05-25, due 2026-06-05, ₱5,146
 *   - generated_count = 2; no phase 5 enrollment until paid
 *
 * Run:
 *   node backend/scripts/repairMariannaRomeroPhase5Invoice.js
 *   node backend/scripts/repairMariannaRomeroPhase5Invoice.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import { buildPhaseInstallmentSchedule } from '../utils/phaseInstallmentUtils.js';
import { loadInstallmentProfilePhaseChains } from '../lib/installmentPaymentEligibility.js';
import { mapPhaseChainsToLocalSlots } from '../utils/installmentPhaseRowMapping.js';
import { resolveProfilePhaseStart } from '../utils/phaseInstallmentUtils.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { insertInvoiceWithArNumber } from '../utils/invoiceArNumber.js';

const STUDENT_EMAIL = 'amgromero1987@gmail.com';
const STUDENT_ID = 560;
const PROFILE_ID = 400;
const CLASS_ID = 56;
const PHASE_4_INVOICE_ID = 1354;
const ABSOLUTE_PHASE_5 = 5;
const GENERATED_COUNT = 2;

const PHASE_5_ISSUE = '2026-05-25';
const PHASE_5_DUE = '2026-06-05';
const PHASE_4_ISSUE = '2026-05-25';
const PHASE_4_DUE = '2026-06-05';
const PHASE_AMOUNT = 5146;
const DROP_WAIVE_FLAG = 'DELINQUENCY_DROP_WAIVED';

const REPAIR_NOTE = 'Ops repair — Marianna Romero phase 5 invoice generated unpaid';

const isApply = process.argv.includes('--apply');

async function clearInvoicePenalty(client, invoiceId) {
  const items = await client.query(
    `SELECT invoice_item_id FROM invoiceitemstbl
     WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
    [invoiceId]
  );
  for (const item of items.rows) {
    await client.query(
      `UPDATE invoiceitemstbl SET amount = 0, penalty_amount = 0 WHERE invoice_item_id = $1`,
      [item.invoice_item_id]
    );
  }
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
}

async function loadPlanMapping(client, profile) {
  const { phaseChains } = await loadInstallmentProfilePhaseChains(client, PROFILE_ID);
  const mapped = mapPhaseChainsToLocalSlots(phaseChains, profile);
  const phaseStart = resolveProfilePhaseStart(profile);
  const rows = [];
  for (const [local, chain] of [...mapped.entries()].sort((a, b) => a[0] - b[0])) {
    const rep = chain.representative;
    rows.push({
      local_slot: local,
      display_phase: local + phaseStart - 1,
      invoice_id: rep.invoice_id,
      status: rep.status,
      issue: String(rep.issue_date || '').slice(0, 10),
      due: String(rep.due_date || '').slice(0, 10),
      amount: rep.amount,
      target_phase: parseTargetPhase(rep.remarks),
    });
  }
  return rows;
}

async function previewMatrix() {
  const matrix = await loadStudentMonthEnrollmentMatrix(query, { year: 2026 });
  const track = matrix.students.find(
    (s) => s.student_id === STUDENT_ID && s.class_id === CLASS_ID
  );
  if (!track) return [];
  return Object.entries(track.months || {})
    .filter(
      ([, c]) =>
        c?.mark === '1' || c?.mark === '✓' || c?.mark === 'X' || c?.status === 'dropped'
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, c]) => ({
      month,
      label: c.label,
      phase: c.phase_number,
    }));
}

async function findOrCreatePhase5Invoice(client, profile) {
  const existing = await client.query(
    `SELECT i.invoice_id, i.status, i.amount, i.remarks
     FROM invoicestbl i
     WHERE i.installmentinvoiceprofiles_id = $1
       AND i.remarks ILIKE '%TARGET_PHASE:5%'
     ORDER BY i.invoice_id DESC
     LIMIT 1`,
    [PROFILE_ID]
  );

  let phase5Id = existing.rows[0]?.invoice_id ?? null;

  if (phase5Id) {
    await clearInvoicePenalty(client, phase5Id);
    const remarks = rewriteTargetPhaseInRemarks(existing.rows[0]?.remarks, ABSOLUTE_PHASE_5);
    let withNote = remarks.includes(REPAIR_NOTE) ? remarks : `${remarks};${REPAIR_NOTE}`;
    if (!withNote.includes(DROP_WAIVE_FLAG)) {
      withNote = withNote ? `${withNote};${DROP_WAIVE_FLAG}` : DROP_WAIVE_FLAG;
    }
    await client.query(
      `UPDATE invoicestbl
       SET issue_date = $1::date,
           due_date = $2::date,
           amount = $3,
           status = 'Unpaid',
           late_penalty_applied_for_due_date = NULL,
           remarks = $4
       WHERE invoice_id = $5`,
      [PHASE_5_ISSUE, PHASE_5_DUE, PHASE_AMOUNT, withNote, phase5Id]
    );
    await client.query(
      `UPDATE invoiceitemstbl
       SET amount = $1, discount_amount = 0, penalty_amount = 0
       WHERE invoice_id = $2
         AND COALESCE(description, '') NOT ILIKE '%penalty%'`,
      [PHASE_AMOUNT, phase5Id]
    );
    return phase5Id;
  }

  const template = (
    await client.query(`SELECT * FROM invoicestbl WHERE invoice_id = $1`, [PHASE_4_INVOICE_ID])
  ).rows[0];
  const phase5Remarks =
    `Auto-generated from installment invoice: ${profile.description};TARGET_PHASE:${ABSOLUTE_PHASE_5};${DROP_WAIVE_FLAG};${REPAIR_NOTE}`;

  const created = await insertInvoiceWithArNumber(
    client,
    `INSERT INTO invoicestbl (
       invoice_description, branch_id, amount, status, remarks, issue_date, due_date,
       created_by, installmentinvoiceprofiles_id, invoice_ar_number
     ) VALUES ($1, $2, $3, 'Unpaid', $4, $5::date, $6::date, $7, $8, $9)
     RETURNING invoice_id, invoice_ar_number`,
    [
      'TEMP',
      template.branch_id,
      PHASE_AMOUNT,
      phase5Remarks,
      PHASE_5_ISSUE,
      PHASE_5_DUE,
      template.created_by,
      PROFILE_ID,
    ]
  );
  phase5Id = created.invoice_id;

  await client.query(`UPDATE invoicestbl SET invoice_description = $1 WHERE invoice_id = $2`, [
    `INV-${phase5Id}`,
    phase5Id,
  ]);

  const templateItem = (
    await client.query(
      `SELECT description, tax_item, tax_percentage
       FROM invoiceitemstbl
       WHERE invoice_id = $1
       ORDER BY invoice_item_id
       LIMIT 1`,
      [PHASE_4_INVOICE_ID]
    )
  ).rows[0];

  await client.query(
    `INSERT INTO invoiceitemstbl (
       invoice_id, description, amount, tax_item, tax_percentage,
       discount_amount, penalty_amount
     ) VALUES ($1, $2, $3, $4, $5, 0, 0)`,
    [
      phase5Id,
      templateItem?.description || profile.description,
      PHASE_AMOUNT,
      templateItem?.tax_item ?? null,
      templateItem?.tax_percentage ?? 0,
    ]
  );

  const linkedStudents = await client.query(
    `SELECT student_id FROM invoicestudentstbl WHERE invoice_id = $1`,
    [PHASE_4_INVOICE_ID]
  );
  for (const row of linkedStudents.rows) {
    const exists = await client.query(
      `SELECT 1 FROM invoicestudentstbl WHERE invoice_id = $1 AND student_id = $2`,
      [phase5Id, row.student_id]
    );
    if (!exists.rows.length) {
      await client.query(
        `INSERT INTO invoicestudentstbl (invoice_id, student_id) VALUES ($1, $2)`,
        [phase5Id, row.student_id]
      );
    }
  }

  return phase5Id;
}

async function main() {
  console.log(
    `\nMarianna Romero — phase 5 unpaid invoice repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  try {
    const profile = (
      await client.query(
        `SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];
    if (!profile || Number(profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found`);
    }

    console.log('Before plan mapping:');
    console.table(await loadPlanMapping(client, profile));

    const schedule = await buildPhaseInstallmentSchedule({
      db: client,
      profile: { ...profile, generated_count: GENERATED_COUNT },
      generatedCountOverride: GENERATED_COUNT,
    });

    console.log('\nQueue after repair (phase 6 next):');
    console.table([
      {
        current_phase: schedule?.current_phase_number,
        current_gen: schedule?.current_generation_date,
        current_month: schedule?.current_invoice_month,
        current_due: schedule?.current_due_date,
      },
    ]);

    if (!isApply) {
      console.log('\nPlanned changes:');
      console.log(`  • Phase 4 paid INV-${PHASE_4_INVOICE_ID} display dates ${PHASE_4_ISSUE} / ${PHASE_4_DUE}`);
      console.log(`  • Phase 5 unpaid invoice issue ${PHASE_5_ISSUE}, due ${PHASE_5_DUE}`);
      console.log(`  • Amount ₱${PHASE_AMOUNT.toFixed(2)} (no penalty)`);
      console.log('  • Remove phase 5 dropped enrollment; add DELINQUENCY_DROP_WAIVED');
      console.log(`  • generated_count → ${GENERATED_COUNT}, is_active → true`);
      console.log('\nRe-run with --apply to execute.');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE invoicestbl
       SET issue_date = $1::date,
           due_date = $2::date
       WHERE invoice_id = $3`,
      [PHASE_4_ISSUE, PHASE_4_DUE, PHASE_4_INVOICE_ID]
    );

    const phase5InvoiceId = await findOrCreatePhase5Invoice(client, profile);
    await syncProgramPaymentStatusForInvoice(client, phase5InvoiceId);

    await client.query(
      `DELETE FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = $3`,
      [STUDENT_ID, CLASS_ID, ABSOLUTE_PHASE_5]
    );

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = $1,
           is_active = true
       WHERE installmentinvoiceprofiles_id = $2`,
      [GENERATED_COUNT, PROFILE_ID]
    );

    await client.query(
      `UPDATE installmentinvoicestbl
       SET next_generation_date = $1::date,
           next_invoice_month = $2::date,
           scheduled_date = COALESCE($3::date, scheduled_date)
       WHERE installmentinvoiceprofiles_id = $4`,
      [
        schedule?.current_generation_date || '2026-06-24',
        schedule?.current_invoice_month || '2026-07-01',
        schedule?.current_due_date || '2026-07-05',
        PROFILE_ID,
      ]
    );

    await client.query('COMMIT');

    const profileAfter = (
      await client.query(
        `SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    console.log('\n✅ Repair applied.');
    console.log(`Phase 5 invoice id: ${phase5InvoiceId}`);
    console.log('After plan mapping:');
    console.table(await loadPlanMapping(client, profileAfter));
    console.log('After matrix:');
    console.table(await previewMatrix());
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
    console.error(err);
    process.exit(1);
  });
