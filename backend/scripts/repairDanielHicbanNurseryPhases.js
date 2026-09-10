/**
 * Daniel Sungcang Hicban (sungcangvivianvillamater@gmail.com, user 76) —
 * SOMO Nursery MWF 1PM (class 27) · Profile 60 · Branch SOMO (3)
 *
 * Issues:
 *   1. Phase 2–3 enrollment stored as "new"; Phase 4 active row is "rejoin"
 *      (plus a prior Phase 4 delinquency drop). Should be: P1 new, P2–P4 re_enrolled.
 *   2. Phase 5 chain INV-1658 → INV-1942 has stacked late penalties
 *      (UI Amount ~₱130,321 / Balance ~₱125,821). True phase fee ₱5,000, paid ₱4,500,
 *      remaining balance ₱500.
 *   3. Phase 6 INV-2208 + Phase 7 INV-2609 generated after Phase 5 drop —
 *      cancel/detach; remove Phase 6 dropped enrollment; generated_count → 5.
 *   4. Month matrix misaligned (Jun/Jul rejoin, Aug P6 dropped, Sep Inactive).
 *
 * Expected after:
 *   History: P1 new · P2–P4 re_enrolled · P5 dropped (₱5,000 / ₱4,500 / ₱500) · P6–10 Not Generated
 *   Matrix: Mar new · Apr–Jun re-enrolled · Jul dropped · later blank/inactive
 *
 * Run (from backend/):
 *   node scripts/repairDanielHicbanNurseryPhases.js --production
 *   node scripts/repairDanielHicbanNurseryPhases.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { getChainFinancialSummary } from '../utils/balanceInvoice.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 76;
const STUDENT_EMAIL = 'sungcangvivianvillamater@gmail.com';
const CLASS_ID = 27;
const BRANCH_ID = 3;
const PROFILE_ID = 60;

const PHASE2_CS = 357;
const PHASE3_CS = 763;
const PHASE4_DROP_CS = 1623; // false mid-track drop before pay — remove
const PHASE4_ACTIVE_CS = 1736; // rejoin → re_enrolled
const PHASE5_DROP_CS = 1737;
const PHASE6_DROP_CS = 2613; // remove with cancelled Phase 6 invoice

const PHASE5_PARENT_INVOICE_ID = 1658;
const PHASE5_LEAF_INVOICE_ID = 1942;
const CANCEL_INVOICE_IDS = [2208, 2609]; // Phase 6 + 7

const PHASE_FEE = 5000;
const EXPECTED_PAID = 4500;
const TARGET_LEAF_BALANCE = 500; // 5000 - 4500
const EXPECTED_GENERATED_COUNT = 5;

const PHASE5_ENROLLED_AT = '2026-07-07 12:00:00';
const PHASE5_REMOVED_AT = '2026-07-07 12:00:01';
const PHASE4_ENROLLED_AT = '2026-06-01 12:00:00';

const REPAIR_NOTE =
  'Ops repair 2026-09-07 — Daniel Hicban: P2–P4 re_enrolled; clear P5 penalty stack (balance 500); cancel P6–P7';

const EXPECTED_MATRIX = [
  ['2026-03', 'new'],
  ['2026-04', 're-enrolled'],
  ['2026-05', 're-enrolled'],
  ['2026-06', 're-enrolled'],
  ['2026-07', 'dropped'],
];

const isApply = process.argv.includes('--apply');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function appendNote(existing, note, maxLen = 255) {
  const cur = String(existing || '').trim();
  const add = String(note || '').trim();
  if (!add) return cur || null;
  if (cur.toLowerCase().includes(add.toLowerCase())) return cur;
  if (!cur) return add.length <= maxLen ? add : add.slice(0, maxLen);
  const joined = `${cur} | ${add}`;
  if (joined.length <= maxLen) return joined;
  return cur.length <= maxLen ? cur : cur.slice(0, maxLen);
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

function assertExpectedMatrix(cells) {
  const byMonth = Object.fromEntries(cells.map((c) => [c.month, c]));
  const problems = [];
  for (const [month, label] of EXPECTED_MATRIX) {
    const cell = byMonth[month];
    const got = String(cell?.label || '').toLowerCase();
    if (!cell || got !== label) {
      problems.push(
        `${month}: expected ${label}, got ${cell ? `${cell.label} (phase ${cell.phase})` : 'missing'}`
      );
    }
  }
  for (const month of ['2026-08', '2026-09']) {
    const cell = byMonth[month];
    const label = String(cell?.label || '').toLowerCase();
    if (label === 'rejoin' || label === 'dropped' || label === 'continue') {
      problems.push(`${month}: unexpected ${cell.label}`);
    }
  }
  return problems;
}

async function listItems(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_item_id, description, amount, discount_amount, penalty_amount
     FROM invoiceitemstbl
     WHERE invoice_id = $1
     ORDER BY invoice_item_id`,
    [invoiceId]
  );
  return r.rows;
}

async function main() {
  console.log(
    `\nDaniel Hicban — Nursery phases / P5 balance / cancel P6–P7` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  const txQuery = (text, params) => client.query(text, params);

  try {
    await client.query('BEGIN');

    const student = (
      await client.query(
        `SELECT user_id, full_name, email
         FROM userstbl
         WHERE user_id = $1
           AND LOWER(TRIM(email)) = LOWER(TRIM($2))
           AND user_type = 'Student'`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error('Student not found');
    console.log(`Student: ${student.full_name} (${student.email})`);

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, class_id, generated_count, is_active, amount::text
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND student_id = $2
           AND class_id = $3`,
        [PROFILE_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);
    console.log('Profile before:', profile);

    console.log('\nMatrix BEFORE:');
    for (const c of await previewMatrix(txQuery)) console.log(' ', c);

    // --- Validate Phase 5 chain ---
    const parent = (
      await client.query(
        `SELECT invoice_id, status, amount::text, balance_invoice_id, remarks
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE5_PARENT_INVOICE_ID]
      )
    ).rows[0];
    if (!parent) throw new Error(`INV-${PHASE5_PARENT_INVOICE_ID} missing`);
    if (Number(parent.balance_invoice_id) !== PHASE5_LEAF_INVOICE_ID) {
      throw new Error(
        `Expected balance_invoice_id=${PHASE5_LEAF_INVOICE_ID}, got ${parent.balance_invoice_id}`
      );
    }
    if (!String(parent.remarks || '').includes('TARGET_PHASE:5')) {
      throw new Error('Parent missing TARGET_PHASE:5');
    }

    const linked = (
      await client.query(
        `SELECT 1 FROM invoicestudentstbl WHERE invoice_id = $1 AND student_id = $2`,
        [PHASE5_PARENT_INVOICE_ID, STUDENT_ID]
      )
    ).rows[0];
    if (!linked) throw new Error('Phase 5 parent not linked to student');

    const parentItems = await listItems(client, PHASE5_PARENT_INVOICE_ID);
    const parentItemTotal = round2(
      parentItems.reduce(
        (s, it) =>
          s +
          Number(it.amount || 0) -
          Number(it.discount_amount || 0) +
          Number(it.penalty_amount || 0),
        0
      )
    );
    if (Math.abs(parentItemTotal - PHASE_FEE) > 0.05) {
      throw new Error(`Parent item total ${parentItemTotal} != phase fee ${PHASE_FEE}`);
    }

    const chainBefore = await getChainFinancialSummary(client, PHASE5_PARENT_INVOICE_ID);
    const paidOnChain = round2(Number(chainBefore.total_paid_in_chain || 0));
    if (Math.abs(paidOnChain - EXPECTED_PAID) > 0.05) {
      throw new Error(`Chain paid ${paidOnChain} != expected ${EXPECTED_PAID}`);
    }
    console.log('\nPhase 5 chain BEFORE:', {
      paid: paidOnChain,
      remaining: chainBefore.remaining_on_leaf,
      obligation: chainBefore.total_obligation,
      leafItems: (await listItems(client, PHASE5_LEAF_INVOICE_ID)).length,
    });

    // --- 1) Enrollment status fixes ---
    for (const [csId, phase, fromStatus] of [
      [PHASE2_CS, 2, 'new'],
      [PHASE3_CS, 3, 'new'],
    ]) {
      const row = (
        await client.query(
          `SELECT classstudent_id, program_enrollment_status AS status, enrolled_by
           FROM classstudentstbl
           WHERE classstudent_id = $1 AND student_id = $2 AND class_id = $3 AND phase_number = $4`,
          [csId, STUDENT_ID, CLASS_ID, phase]
        )
      ).rows[0];
      if (!row) throw new Error(`Missing CS ${csId} phase ${phase}`);
      if (String(row.status) !== fromStatus) {
        throw new Error(`CS ${csId} status ${row.status}, expected ${fromStatus}`);
      }
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 're_enrolled',
             enrolled_by = $1,
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL
         WHERE classstudent_id = $2`,
        [appendNote(row.enrolled_by, REPAIR_NOTE), csId]
      );
      console.log(`→ CS ${csId} P${phase}: ${fromStatus} → re_enrolled`);
    }

    {
      const row = (
        await client.query(
          `SELECT classstudent_id, program_enrollment_status AS status, enrolled_by
           FROM classstudentstbl
           WHERE classstudent_id = $1 AND student_id = $2 AND class_id = $3 AND phase_number = 4`,
          [PHASE4_ACTIVE_CS, STUDENT_ID, CLASS_ID]
        )
      ).rows[0];
      if (!row) throw new Error(`Missing CS ${PHASE4_ACTIVE_CS} phase 4`);
      if (String(row.status) !== 'rejoin') {
        throw new Error(`CS ${PHASE4_ACTIVE_CS} status ${row.status}, expected rejoin`);
      }
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 're_enrolled',
             enrolled_at = $1::timestamp,
             enrolled_by = $2,
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL
         WHERE classstudent_id = $3`,
        [PHASE4_ENROLLED_AT, appendNote(row.enrolled_by, REPAIR_NOTE), PHASE4_ACTIVE_CS]
      );
      console.log(`→ CS ${PHASE4_ACTIVE_CS} P4: rejoin → re_enrolled`);
    }

    // Remove false Phase 4 drop (rejoin narrative)
    const drop4 = (
      await client.query(
        `SELECT classstudent_id, program_enrollment_status
         FROM classstudentstbl WHERE classstudent_id = $1 AND student_id = $2`,
        [PHASE4_DROP_CS, STUDENT_ID]
      )
    ).rows[0];
    if (!drop4 || String(drop4.program_enrollment_status) !== 'dropped') {
      throw new Error(`Expected dropped CS ${PHASE4_DROP_CS}`);
    }
    await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
      PHASE4_DROP_CS,
    ]);
    console.log(`→ DELETE CS ${PHASE4_DROP_CS} (false Phase 4 drop)`);

    // Anchor Phase 5 drop in July
    const drop5 = (
      await client.query(
        `SELECT classstudent_id, program_enrollment_status, removed_reason
         FROM classstudentstbl WHERE classstudent_id = $1 AND student_id = $2`,
        [PHASE5_DROP_CS, STUDENT_ID]
      )
    ).rows[0];
    if (!drop5 || String(drop5.program_enrollment_status) !== 'dropped') {
      throw new Error(`Expected dropped CS ${PHASE5_DROP_CS}`);
    }
    await client.query(
      `UPDATE classstudentstbl
       SET enrolled_at = $1::timestamp,
           removed_at = $2::timestamp,
           removed_reason = $3
       WHERE classstudent_id = $4`,
      [
        PHASE5_ENROLLED_AT,
        PHASE5_REMOVED_AT,
        appendNote(drop5.removed_reason, REPAIR_NOTE, 255),
        PHASE5_DROP_CS,
      ]
    );
    console.log(`→ CS ${PHASE5_DROP_CS} P5 dropped anchored Jul 7`);

    // Remove Phase 6 drop enrollment
    const drop6 = (
      await client.query(
        `SELECT classstudent_id FROM classstudentstbl
         WHERE classstudent_id = $1 AND student_id = $2 AND phase_number = 6`,
        [PHASE6_DROP_CS, STUDENT_ID]
      )
    ).rows[0];
    if (!drop6) throw new Error(`Missing Phase 6 CS ${PHASE6_DROP_CS}`);
    await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
      PHASE6_DROP_CS,
    ]);
    console.log(`→ DELETE CS ${PHASE6_DROP_CS} (Phase 6 drop with cancelled invoice)`);

    // --- 2) Clear Phase 5 penalty stack ---
    const leafItems = await listItems(client, PHASE5_LEAF_INVOICE_ID);
    await client.query(`DELETE FROM invoiceitemstbl WHERE invoice_id = $1`, [
      PHASE5_LEAF_INVOICE_ID,
    ]);
    await client.query(
      `INSERT INTO invoiceitemstbl
         (invoice_id, description, amount, tax_item, tax_percentage, discount_amount, penalty_amount)
       VALUES ($1, $2, $3, NULL, 0, 0, 0)`,
      [
        PHASE5_LEAF_INVOICE_ID,
        `Remaining balance (from invoice INV-${PHASE5_PARENT_INVOICE_ID}) — corrected to phase fee ${PHASE_FEE} minus paid ${EXPECTED_PAID}`,
        TARGET_LEAF_BALANCE,
      ]
    );
    await client.query(
      `UPDATE invoicestbl
       SET amount = $1,
           status = 'Unpaid',
           late_penalty_applied_for_due_date = NULL,
           remarks = CASE
             WHEN remarks IS NULL OR BTRIM(remarks) = '' THEN $3
             WHEN remarks LIKE '%' || $3 || '%' THEN remarks
             ELSE LEFT(remarks || ';' || $3, 2000)
           END
       WHERE invoice_id = $2`,
      [TARGET_LEAF_BALANCE, PHASE5_LEAF_INVOICE_ID, REPAIR_NOTE]
    );
    await client.query(
      `UPDATE invoicestbl
       SET amount = 0,
           status = 'Partially Paid',
           late_penalty_applied_for_due_date = NULL
       WHERE invoice_id = $1`,
      [PHASE5_PARENT_INVOICE_ID]
    );
    console.log(
      `→ INV-${PHASE5_LEAF_INVOICE_ID}: cleared ${leafItems.length} lines → remaining ₱${TARGET_LEAF_BALANCE}`
    );

    await syncProgramPaymentStatusForInvoice(client, PHASE5_PARENT_INVOICE_ID);
    await syncProgramPaymentStatusForInvoice(client, PHASE5_LEAF_INVOICE_ID);

    const chainAfter = await getChainFinancialSummary(client, PHASE5_PARENT_INVOICE_ID);
    console.log('Phase 5 chain AFTER:', {
      paid: chainAfter.total_paid_in_chain,
      remaining: chainAfter.remaining_on_leaf,
      obligation: chainAfter.total_obligation,
    });
    if (Math.abs(round2(chainAfter.remaining_on_leaf) - TARGET_LEAF_BALANCE) > 0.05) {
      throw new Error(
        `Leaf remaining ${chainAfter.remaining_on_leaf} != ${TARGET_LEAF_BALANCE}`
      );
    }
    if (Math.abs(round2(chainAfter.total_obligation) - PHASE_FEE) > 0.05) {
      throw new Error(`Obligation ${chainAfter.total_obligation} != ${PHASE_FEE}`);
    }

    // --- 3) Cancel Phase 6 + 7 invoices ---
    for (const invoiceId of CANCEL_INVOICE_IDS) {
      const inv = (
        await client.query(
          `SELECT invoice_id, status, remarks, installmentinvoiceprofiles_id
           FROM invoicestbl WHERE invoice_id = $1`,
          [invoiceId]
        )
      ).rows[0];
      if (!inv) throw new Error(`INV-${invoiceId} missing`);
      if (Number(inv.installmentinvoiceprofiles_id) !== PROFILE_ID) {
        throw new Error(`INV-${invoiceId} not on profile ${PROFILE_ID}`);
      }
      const pays = (
        await client.query(
          `SELECT payment_id FROM paymenttbl
           WHERE invoice_id = $1 AND status = 'Completed'`,
          [invoiceId]
        )
      ).rows;
      if (pays.length) {
        throw new Error(`INV-${invoiceId} has completed payments — abort`);
      }
      const nextRemarks = [inv.remarks, REPAIR_NOTE].filter(Boolean).join(';');
      await client.query(
        `UPDATE invoicestbl
         SET status = 'Cancelled',
             installmentinvoiceprofiles_id = NULL,
             remarks = $1
         WHERE invoice_id = $2`,
        [nextRemarks, invoiceId]
      );
      await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [
        invoiceId,
      ]);
      console.log(`→ Cancelled + detached INV-${invoiceId}`);
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = $1,
           is_active = false
       WHERE installmentinvoiceprofiles_id = $2`,
      [EXPECTED_GENERATED_COUNT, PROFILE_ID]
    );
    console.log(`→ generated_count → ${EXPECTED_GENERATED_COUNT}, is_active=false`);

    // Stop queue if present (schema varies). Use SAVEPOINT so a missing
    // table/column does not abort the whole repair transaction.
    await client.query('SAVEPOINT queue_clear');
    try {
      const dtl = (
        await client.query(
          `SELECT installmentinvoicedtl_id
           FROM installmentinvoicedtl
           WHERE installmentinvoiceprofiles_id = $1
           ORDER BY installmentinvoicedtl_id DESC
           LIMIT 1`,
          [PROFILE_ID]
        )
      ).rows[0];
      if (dtl?.installmentinvoicedtl_id) {
        await client.query(
          `UPDATE installmentinvoicedtl
           SET next_generation_date = NULL,
               next_invoice_month = NULL
           WHERE installmentinvoicedtl_id = $1`,
          [dtl.installmentinvoicedtl_id]
        );
        console.log('→ Cleared installmentinvoicedtl next_*');
      } else {
        console.log('→ No installmentinvoicedtl row for profile (ok)');
      }
      await client.query('RELEASE SAVEPOINT queue_clear');
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT queue_clear');
      await client.query('SAVEPOINT queue_clear2');
      try {
        await client.query(
          `UPDATE installmentinvoicestbl
           SET next_generation_date = NULL,
               next_invoice_month = NULL
           WHERE installmentinvoiceprofiles_id = $1`,
          [PROFILE_ID]
        );
        console.log('→ Cleared installmentinvoicestbl next_*');
        await client.query('RELEASE SAVEPOINT queue_clear2');
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT queue_clear2');
        console.log('→ No installment queue table/columns to clear (skipped)');
      }
    }

    console.log('\nMatrix AFTER (in transaction):');
    const afterCells = await previewMatrix(txQuery);
    for (const c of afterCells) console.log(' ', c);

    const problems = assertExpectedMatrix(afterCells);
    if (problems.length) {
      console.error('\n❌ Matrix did not match expected:');
      for (const p of problems) console.error('  -', p);
      await client.query('ROLLBACK');
      process.exitCode = 1;
      return;
    }
    console.log('\n✅ Enrollment + Phase 5 balance + matrix checks passed.');

    if (isApply) {
      await client.query('COMMIT');
      console.log('\nCommitted.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run — rolled back. Re-run with --apply to commit.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFailed:', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
