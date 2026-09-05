/**
 * Morgan Atlas Milag Aquino — Student History should show **one** installment plan only
 * (Plan 1 / profile 296, phases 1–7). Remove erroneous Plan 2 (profile 525 / phase 10).
 *
 * Keeps: profile 296 · class 89 · phases 1–7
 * Removes: profile 525 · INV-2782 (cancel + detach) · phase 10 enrollment · Plan 2 queue
 *
 * Run (from backend/):
 *   node scripts/repairMorganAquinoRemovePlan2KeepPlan1.js --production
 *   node scripts/repairMorganAquinoRemovePlan2KeepPlan1.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import {
  buildMonthMatrixActiveTrackRows,
  loadStudentMonthEnrollmentMatrix,
} from '../lib/enrollmentRateMetrics.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';

const STUDENT_ID = 514;
const STUDENT_EMAIL = 'kimberlymilag@gmail.com';
const CLASS_ID = 89;
const BRANCH_ID = 1;
const KEEP_PROFILE_ID = 296;
const REMOVE_PROFILE_ID = 525;
const PLAN2_INVOICE_ID = 2782;

const REPAIR_NOTE =
  'Ops repair 2026-09-05 — Morgan remove Plan2 profile 525; keep Plan1 profile 296 phases 1-7';

const isApply = process.argv.includes('--apply');

async function previewSepActive(queryFn) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year: 2026,
    branchId: BRANCH_ID,
    classId: CLASS_ID,
  });
  const track = (matrix.students || []).find(
    (s) => Number(s.student_id) === STUDENT_ID && Number(s.class_id) === CLASS_ID
  );
  const cells = [];
  for (const m of matrix.months || []) {
    const c = track?.months?.[m.key];
    if (c && (c.mark === '1' || c.mark === '✓' || c.mark === 'X' || c.label)) {
      cells.push({ month: m.key, label: c.label, phase: c.phase_number });
    }
  }
  const active = buildMonthMatrixActiveTrackRows(matrix.students || [], '2026-09').filter(
    (r) => Number(r.student_id) === STUDENT_ID
  );
  return { cells, active };
}

async function main() {
  console.log(
    `\nMorgan Aquino — remove Plan 2, keep Plan 1 (phases 1–7)` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  console.log(`Note: ${REPAIR_NOTE}\n`);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error(`Student ${STUDENT_ID} / ${STUDENT_EMAIL} not found`);
    console.log('Student:', student.full_name, student.email);

    const profiles = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id AS profile_id, class_id, phase_start, total_phases,
                generated_count, is_active, description
         FROM installmentinvoiceprofilestbl
         WHERE student_id = $1
         ORDER BY installmentinvoiceprofiles_id`,
        [STUDENT_ID]
      )
    ).rows;
    console.log('Profiles BEFORE:');
    console.table(profiles);

    const remove = profiles.find((p) => Number(p.profile_id) === REMOVE_PROFILE_ID);
    const keep = profiles.find((p) => Number(p.profile_id) === KEEP_PROFILE_ID);
    if (!remove) {
      console.log(`\nProfile ${REMOVE_PROFILE_ID} already gone — nothing to do.`);
      await client.query('ROLLBACK');
      return;
    }
    if (!keep || Number(keep.class_id) !== CLASS_ID) {
      throw new Error(`Keep profile ${KEEP_PROFILE_ID} / class ${CLASS_ID} missing — abort`);
    }
    if (Number(keep.total_phases) !== 7 && Number(keep.phase_start) !== 1) {
      console.warn(
        `⚠ Plan 1 meta: phase_start=${keep.phase_start} total_phases=${keep.total_phases} (expected 1 / 7)`
      );
    }

    const invoices = (
      await client.query(
        `SELECT invoice_id, status, amount, remarks, installmentinvoiceprofiles_id AS profile_id,
                TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
         ORDER BY invoice_id`,
        [REMOVE_PROFILE_ID]
      )
    ).rows.map((r) => ({ ...r, phase: parseTargetPhase(r.remarks) }));
    console.log('Plan 2 invoices:');
    console.table(invoices);

    if (!invoices.some((i) => Number(i.invoice_id) === PLAN2_INVOICE_ID)) {
      console.warn(`⚠ INV-${PLAN2_INVOICE_ID} not on profile ${REMOVE_PROFILE_ID}`);
    }

    const phase10Enroll = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND phase_number >= 8
         ORDER BY phase_number, classstudent_id`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;
    console.log('Enrollments phase ≥8 (will delete):');
    console.table(phase10Enroll);

    const queue = (
      await client.query(
        `SELECT installmentinvoicedtl_id, status,
                TO_CHAR(TIMEZONE('Asia/Manila', scheduled_date), 'YYYY-MM-DD') AS scheduled
         FROM installmentinvoicestbl
         WHERE installmentinvoiceprofiles_id = $1`,
        [REMOVE_PROFILE_ID]
      )
    ).rows;
    console.log('Plan 2 queue:', queue);

    console.log('\nBEFORE matrix / Sep Active:');
    console.table((await previewSepActive(query)).cells);

    console.log('\nPlanned:');
    console.log(`  1. Cancel + detach invoices on profile ${REMOVE_PROFILE_ID} (incl. INV-${PLAN2_INVOICE_ID})`);
    console.log(`  2. Delete queue + program_payment_status for profile ${REMOVE_PROFILE_ID}`);
    console.log(`  3. DELETE profile ${REMOVE_PROFILE_ID}`);
    console.log(`  4. DELETE classstudent rows phase ≥ 8 on class ${CLASS_ID}`);
    console.log(`  5. KEEP profile ${KEEP_PROFILE_ID} (phases 1–7)`);
    console.log('  6. Expect Student History → one plan only; Sep still Active');

    // Cancel + detach Plan 2 invoices (retain payment audit; status Cancelled)
    for (const inv of invoices) {
      const cur = String(inv.remarks || '');
      const nextRemarks = cur.toLowerCase().includes(REPAIR_NOTE.toLowerCase())
        ? cur
        : [cur, REPAIR_NOTE].filter(Boolean).join(';').slice(0, 2000);
      await client.query(
        `UPDATE invoicestbl
         SET status = CASE
               WHEN LOWER(TRIM(COALESCE(status, ''))) IN ('cancelled', 'canceled') THEN status
               ELSE 'Cancelled'
             END,
             installmentinvoiceprofiles_id = NULL,
             remarks = $1
         WHERE invoice_id = $2`,
        [nextRemarks, inv.invoice_id]
      );
      console.log(`✅ INV-${inv.invoice_id} cancelled + detached (was ${inv.status})`);
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET downpayment_invoice_id = NULL
       WHERE installmentinvoiceprofiles_id = $1`,
      [REMOVE_PROFILE_ID]
    );

    await client.query(
      `DELETE FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1`,
      [REMOVE_PROFILE_ID]
    );
    console.log('✅ Deleted Plan 2 queue rows');

    await client
      .query(`DELETE FROM program_payment_statustbl WHERE installmentinvoiceprofiles_id = $1`, [
        REMOVE_PROFILE_ID,
      ])
      .catch(() => {});

    await client.query(
      `DELETE FROM installmentinvoiceprofilestbl
       WHERE installmentinvoiceprofiles_id = $1
         AND student_id = $2`,
      [REMOVE_PROFILE_ID, STUDENT_ID]
    );
    console.log(`✅ Deleted profile ${REMOVE_PROFILE_ID}`);

    for (const row of phase10Enroll) {
      await client.query(
        `DELETE FROM classstudentstbl
         WHERE classstudent_id = $1 AND student_id = $2 AND class_id = $3`,
        [row.classstudent_id, STUDENT_ID, CLASS_ID]
      );
      console.log(`✅ Deleted classstudent ${row.classstudent_id} (phase ${row.phase_number})`);
    }

    // Ensure Plan 1 stays phases 1–7
    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET phase_start = 1,
           total_phases = 7,
           is_active = true
       WHERE installmentinvoiceprofiles_id = $1
         AND student_id = $2`,
      [KEEP_PROFILE_ID, STUDENT_ID]
    );
    console.log('✅ Plan 1 profile 296 confirmed phase_start=1, total_phases=7');

    const afterProfiles = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id AS profile_id, class_id, phase_start, total_phases, is_active
         FROM installmentinvoiceprofilestbl WHERE student_id = $1
         ORDER BY installmentinvoiceprofiles_id`,
        [STUDENT_ID]
      )
    ).rows;
    console.log('\nProfiles AFTER (in txn):');
    console.table(afterProfiles);

    if (afterProfiles.some((p) => Number(p.profile_id) === REMOVE_PROFILE_ID)) {
      throw new Error('Plan 2 profile still exists');
    }
    if (afterProfiles.length !== 1 || Number(afterProfiles[0].profile_id) !== KEEP_PROFILE_ID) {
      throw new Error(`Expected only profile ${KEEP_PROFILE_ID}, got ${JSON.stringify(afterProfiles)}`);
    }

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nRolled back (dry run). Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\n✅ Committed.');

    const after = await previewSepActive(query);
    console.log('AFTER matrix:');
    console.table(after.cells);
    console.log('AFTER Sep Active:', after.active);
    if (!after.active.length) {
      console.warn('⚠️ Morgan not in September Active after Plan 2 removal — review matrix');
    } else {
      console.log('OK: one plan (296); September still Active.');
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\n❌ Repair failed:', err?.message || err);
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
