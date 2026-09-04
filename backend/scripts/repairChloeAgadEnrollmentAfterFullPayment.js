/**
 * Chloe Skye Agad (Kahreen.agad@yahoo.com, user 11) —
 * restore installment enrollment after upgrade to full payment.
 *
 * Production class 38 · SOMO_Pre-Kinder_MWF_11:00-12:00NN · profile 24 · Cavite (3)
 * Conversion invoice: INV-1348 (PACKAGE_CHANGE_TO_FULLPAYMENT, PHASE_START:1 PHASE_END:10)
 *
 * Why the first apply "didn't stick":
 *   Opening Student History → Installment runs syncInstallmentDelinquencyDropsForProfile().
 *   Unpaid TARGET_PHASE 4–7 invoices (generated after the June upgrade) re-dropped P4–P6.
 *
 * This repair:
 *   1. Cancel leftover Unpaid/Pending/Overdue invoices on profile 24
 *   2. Cancel Pending/Scheduled installment schedule rows; deactivate profile
 *   3. Set P1 new, P2–9 re_enrolled, P10 completed; clear removed_at
 *   4. Re-run delinquency sync (expect 0 drops)
 *
 * Run (from backend/):
 *   node scripts/repairChloeAgadEnrollmentAfterFullPayment.js --production
 *   node scripts/repairChloeAgadEnrollmentAfterFullPayment.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import {
  loadStudentMonthEnrollmentMatrix,
  isMonthMatrixCellActiveForOperationalDashboard,
} from '../lib/enrollmentRateMetrics.js';
import { syncInstallmentDelinquencyDropsForProfile } from '../utils/installmentDelinquencyDrop.js';

const STUDENT_ID = 11;
const STUDENT_EMAIL = 'Kahreen.agad@yahoo.com';
const CLASS_ID = 38;
const BRANCH_ID = 3;
const PROFILE_ID = 24;
const CONVERSION_INVOICE_ID = 1348;

const REPAIR_NOTE =
  'Ops repair 2026-09-04 — Chloe Agad full-payment upgrade: cancel leftover unpaid phases; P1 new, P2–9 re_enrolled, P10 completed';

/** @type {Array<{ classstudent_id: number, phase: number, status: string }>} */
const TARGETS = [
  { classstudent_id: 39, phase: 1, status: 'new' },
  { classstudent_id: 180, phase: 2, status: 're_enrolled' },
  { classstudent_id: 539, phase: 3, status: 're_enrolled' },
  { classstudent_id: 1186, phase: 4, status: 're_enrolled' },
  { classstudent_id: 1187, phase: 5, status: 're_enrolled' },
  { classstudent_id: 1188, phase: 6, status: 're_enrolled' },
  { classstudent_id: 1189, phase: 7, status: 're_enrolled' },
  { classstudent_id: 1190, phase: 8, status: 're_enrolled' },
  { classstudent_id: 1191, phase: 9, status: 're_enrolled' },
  { classstudent_id: 1192, phase: 10, status: 'completed' },
];

const isApply = process.argv.includes('--apply');

async function loadRows(client) {
  const res = await client.query(
    `SELECT cs.classstudent_id, cs.phase_number, cs.program_enrollment_status,
            cs.removed_at, cs.removed_reason, cs.removed_by,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD') AS enrolled_ymd,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM-DD') AS removed_ymd
     FROM classstudentstbl cs
     WHERE cs.student_id = $1
       AND cs.class_id = $2
       AND cs.phase_number BETWEEN 1 AND 10
     ORDER BY cs.phase_number, cs.classstudent_id`,
    [STUDENT_ID, CLASS_ID]
  );
  return res.rows;
}

async function loadOpenInvoices(client) {
  const res = await client.query(
    `SELECT invoice_id, status,
            substring(remarks from 'TARGET_PHASE:([0-9]+)') AS phase,
            amount::text AS amount
     FROM invoicestbl
     WHERE installmentinvoiceprofiles_id = $1
       AND COALESCE(status, '') IN ('Unpaid', 'Pending', 'Overdue')
     ORDER BY invoice_id`,
    [PROFILE_ID]
  );
  return res.rows;
}

async function previewMonthMatrix(queryFn) {
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
        active: isMonthMatrixCellActiveForOperationalDashboard(c, track, m.key),
      });
    }
  }
  return cells;
}

async function main() {
  console.log(
    `\nChloe Skye Agad — enrollment + cancel leftover unpaid after full payment` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  try {
    const user = (
      await client.query(
        `SELECT user_id, full_name, email, branch_id
         FROM userstbl
         WHERE user_id = $1`,
        [STUDENT_ID]
      )
    ).rows[0];
    if (!user) throw new Error(`Student ${STUDENT_ID} not found`);
    if (user.email?.toLowerCase() !== STUDENT_EMAIL.toLowerCase()) {
      throw new Error(`Email mismatch (expected ${STUDENT_EMAIL}, got ${user.email})`);
    }
    if (Number(user.branch_id) !== BRANCH_ID) {
      throw new Error(`Branch mismatch (expected ${BRANCH_ID}, got ${user.branch_id})`);
    }

    const conversion = (
      await client.query(
        `SELECT i.invoice_id, i.status, LEFT(i.remarks, 280) AS remarks
         FROM invoicestbl i
         INNER JOIN invoicestudentstbl ist
           ON ist.invoice_id = i.invoice_id AND ist.student_id = $1
         WHERE i.invoice_id = $2`,
        [STUDENT_ID, CONVERSION_INVOICE_ID]
      )
    ).rows[0];
    if (!conversion) throw new Error(`Conversion INV-${CONVERSION_INVOICE_ID} not found`);
    if (String(conversion.status) !== 'Paid') {
      throw new Error(`Conversion INV-${CONVERSION_INVOICE_ID} status ${conversion.status}, expected Paid`);
    }
    if (!/PACKAGE_CHANGE_TO_FULLPAYMENT/i.test(conversion.remarks || '')) {
      throw new Error(`INV-${CONVERSION_INVOICE_ID} missing PACKAGE_CHANGE_TO_FULLPAYMENT`);
    }
    if (!/PROFILE_ID:24/i.test(conversion.remarks || '')) {
      throw new Error(`INV-${CONVERSION_INVOICE_ID} PROFILE_ID mismatch`);
    }

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, is_active, generated_count, total_phases, class_id
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND student_id = $2
           AND class_id = $3`,
        [PROFILE_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found for student/class`);

    console.log('Student:', user.full_name, user.email, `(id ${user.user_id})`);
    console.log('Profile:', profile);
    console.log('Conversion:', conversion);

    const openInvoices = await loadOpenInvoices(client);
    console.log('\nOpen invoices to cancel:');
    console.table(openInvoices.length ? openInvoices : [{ note: '(none)' }]);

    const before = await loadRows(client);
    console.log('\nBEFORE classstudent rows:');
    console.table(before);

    const beforeMatrix = await previewMonthMatrix(query);
    console.log('\nBEFORE month matrix:');
    console.table(beforeMatrix);
    const augBefore = beforeMatrix.find((c) => c.month === '2026-08');
    console.log(
      'August 2026 active before:',
      augBefore ? `${augBefore.label} (active=${augBefore.active})` : '— (missing / inactive)'
    );

    for (const t of TARGETS) {
      const row = before.find((r) => Number(r.classstudent_id) === t.classstudent_id);
      if (!row) throw new Error(`Missing classstudent_id ${t.classstudent_id}`);
      if (Number(row.phase_number) !== t.phase) {
        throw new Error(
          `classstudent ${t.classstudent_id} phase mismatch (expected ${t.phase}, got ${row.phase_number})`
        );
      }
    }

    console.log('\nPlanned:');
    console.log(
      `  Cancel ${openInvoices.length} open invoice(s) on profile ${PROFILE_ID} (keep Paid INV-${CONVERSION_INVOICE_ID})`
    );
    console.log('  Deactivate installment profile + cancel Pending/Scheduled schedule rows');
    for (const t of TARGETS) {
      const row = before.find((r) => Number(r.classstudent_id) === t.classstudent_id);
      console.log(
        `  CS ${t.classstudent_id} Phase ${t.phase}: ` +
          `${row.program_enrollment_status}` +
          (row.removed_ymd ? ` (removed ${row.removed_ymd})` : '') +
          ` → ${t.status}`
      );
    }

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    const cancelledInv = await client.query(
      `UPDATE invoicestbl
       SET status = 'Cancelled',
           remarks = CASE
             WHEN remarks ILIKE $3 THEN remarks
             ELSE TRIM(BOTH ';' FROM CONCAT(COALESCE(remarks, ''), ';', $3))
           END
       WHERE installmentinvoiceprofiles_id = $1
         AND COALESCE(status, '') IN ('Unpaid', 'Pending', 'Overdue')
         AND invoice_id <> $2
       RETURNING invoice_id, substring(remarks from 'TARGET_PHASE:([0-9]+)') AS phase`,
      [PROFILE_ID, CONVERSION_INVOICE_ID, REPAIR_NOTE]
    );
    console.log(`Cancelled invoices: ${cancelledInv.rowCount}`);
    if (cancelledInv.rows.length) console.table(cancelledInv.rows);

    await client.query(
      `UPDATE installmentinvoicestbl
       SET status = 'Cancelled'
       WHERE installmentinvoiceprofiles_id = $1
         AND COALESCE(status, '') IN ('Pending', 'Scheduled')`,
      [PROFILE_ID]
    );

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET is_active = false
       WHERE installmentinvoiceprofiles_id = $1
         AND student_id = $2
         AND class_id = $3`,
      [PROFILE_ID, STUDENT_ID, CLASS_ID]
    );

    for (const t of TARGETS) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1,
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL,
             enrolled_by = COALESCE(enrolled_by, $2)
         WHERE classstudent_id = $3
           AND student_id = $4
           AND class_id = $5
           AND phase_number = $6`,
        [t.status, REPAIR_NOTE, t.classstudent_id, STUDENT_ID, CLASS_ID, t.phase]
      );
    }

    const dropSync = await syncInstallmentDelinquencyDropsForProfile(client, PROFILE_ID);
    console.log('Delinquency sync after repair:', dropSync);
    if (Number(dropSync.dropsApplied) > 0) {
      throw new Error(
        `Delinquency sync still applied ${dropSync.dropsApplied} drop(s) — aborting commit`
      );
    }

    await client.query('COMMIT');
    console.log('\n✅ Billing cancel + enrollment labels committed.');

    const after = await loadRows(client);
    console.log('\nAFTER classstudent rows:');
    console.table(after);

    for (const t of TARGETS) {
      const row = after.find((r) => Number(r.classstudent_id) === t.classstudent_id);
      if (!row || String(row.program_enrollment_status) !== t.status || row.removed_at != null) {
        throw new Error(
          `Validation failed Phase ${t.phase}: got ${row?.program_enrollment_status} removed=${row?.removed_ymd}`
        );
      }
    }

    const stillOpen = await loadOpenInvoices(client);
    if (stillOpen.length) {
      throw new Error(`Still have open invoices: ${stillOpen.map((r) => r.invoice_id).join(',')}`);
    }

    const afterMatrix = await previewMonthMatrix(query);
    console.log('\nAFTER month matrix:');
    console.table(afterMatrix);
    const augAfter = afterMatrix.find((c) => c.month === '2026-08');
    console.log(
      'August 2026 active after:',
      augAfter ? `${augAfter.label} (active=${augAfter.active})` : '— (missing / inactive)'
    );
    if (!augAfter?.active) {
      console.warn('⚠️ August is still not Active — investigate matrix mapping.');
    }
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
