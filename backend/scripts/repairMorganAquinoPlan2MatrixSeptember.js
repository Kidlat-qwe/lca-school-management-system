/**
 * Morgan Atlas Milag Aquino — restore Month Re-enrollment cells + September Active.
 *
 * Root cause: Plan 2 profile **525** (created after Plan 1 profile 296) has
 *   phase_start=10, total_phases=1
 * Matrix uses the *latest* profile for phase_start / package-complete, so:
 *   - Phases 1–9 are excluded (pre phase_start)
 *   - Only Phase 10 remains → Aug "completed" (single-phase) → September blank
 *   - Plan 2 looks "missing" and student drops out of September Total Active
 *
 * Fix:
 *   1. Profile 525 → phase_start=1, total_phases=10, first_billing=2026-04-01
 *      (keeps INV-2782 TARGET_PHASE:10; stops false package_complete)
 *   2. Remove duplicate / orphan enrollment rows (extra P7, P8, P9, extra P10)
 *   3. Keep Plan 1 history + Plan 2 Phase 10 on the same Playgroup track
 *
 * Expected: Apr new … Jul dropped … Aug rejoin … Sep re-enrolled (Active for Malolos)
 *
 * Run (from backend/):
 *   node scripts/repairMorganAquinoPlan2MatrixSeptember.js --production
 *   node scripts/repairMorganAquinoPlan2MatrixSeptember.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import {
  buildMonthMatrixActiveTrackRows,
  loadStudentMonthEnrollmentMatrix,
} from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 514;
const STUDENT_EMAIL = 'kimberlymilag@gmail.com';
const CLASS_ID = 89;
const BRANCH_ID = 1;
const PLAN1_PROFILE_ID = 296;
const PLAN2_PROFILE_ID = 525;
const PLAN2_INVOICE_ID = 2782;

/** Keep these enrollment rows */
const KEEP_CLASSSTUDENT_IDS = new Set([
  569, // P1 new
  638, // P2 re_enrolled
  1064, // P3 re_enrolled
  1937, // P4 dropped
  1938, // P5 rejoin
  2322, // P6 re_enrolled
  2489, // P7 completed (Sep)
  2488, // P10 completed (Plan 2)
]);

const REPAIR_NOTE =
  'Ops repair 2026-09-05 — Morgan Plan 2 profile phase_start/total_phases; restore matrix Sep Active';

const isApply = process.argv.includes('--apply');

async function previewMatrix(queryFn) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year: 2026,
    branchId: BRANCH_ID,
    classId: CLASS_ID,
  });
  const track = (matrix.students || []).find(
    (s) => Number(s.student_id) === STUDENT_ID && Number(s.class_id) === CLASS_ID
  );
  if (!track) return { cells: [], meta: null };
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
  return {
    cells,
    meta: {
      installment_plan_total_phases: track.installment_plan_total_phases,
      installment_package_complete: track.installment_package_complete,
      package_complete_month_key: track.package_complete_month_key,
      first_enrolled_month_key: track.first_enrolled_month_key,
    },
  };
}

async function main() {
  console.log(
    `\nMorgan Aquino — Plan 2 matrix / Sep Active${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  console.log(`Note: ${REPAIR_NOTE}\n`);

  const client = await getClient();
  try {
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
        `SELECT installmentinvoiceprofiles_id AS pid, phase_start, total_phases, generated_count, is_active,
                TO_CHAR(TIMEZONE('Asia/Manila', first_billing_month), 'YYYY-MM-DD') AS first_bill
         FROM installmentinvoiceprofilestbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY installmentinvoiceprofiles_id`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;
    console.log('BEFORE profiles:');
    console.table(profiles);

    const plan2 = profiles.find((p) => Number(p.pid) === PLAN2_PROFILE_ID);
    if (!plan2) throw new Error(`Plan 2 profile ${PLAN2_PROFILE_ID} not found`);

    const inv = (
      await client.query(
        `SELECT invoice_id, installmentinvoiceprofiles_id, status, remarks
         FROM invoicestbl WHERE invoice_id = $1`,
        [PLAN2_INVOICE_ID]
      )
    ).rows[0];
    if (!inv || Number(inv.installmentinvoiceprofiles_id) !== PLAN2_PROFILE_ID) {
      throw new Error(`INV-${PLAN2_INVOICE_ID} not on profile ${PLAN2_PROFILE_ID}`);
    }
    if (!String(inv.remarks || '').includes('TARGET_PHASE:10')) {
      throw new Error(`INV-${PLAN2_INVOICE_ID} missing TARGET_PHASE:10`);
    }

    const enrollments = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY phase_number, classstudent_id`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;
    console.log('BEFORE enrollments:');
    console.table(enrollments);

    const toDelete = enrollments.filter((e) => !KEEP_CLASSSTUDENT_IDS.has(Number(e.classstudent_id)));
    console.log(
      'Will delete classstudent ids:',
      toDelete.map((e) => `${e.classstudent_id}(p${e.phase_number}/${e.program_enrollment_status})`)
    );

    const before = await previewMatrix(query);
    console.log('BEFORE matrix meta:', before.meta);
    console.log('BEFORE matrix:');
    console.table(before.cells);

    const activeBefore = buildMonthMatrixActiveTrackRows(
      (
        await loadStudentMonthEnrollmentMatrix(query, {
          year: 2026,
          branchId: BRANCH_ID,
        })
      ).students || [],
      '2026-09'
    ).filter((r) => Number(r.student_id) === STUDENT_ID);
    console.log('BEFORE Sep Active tracks:', activeBefore);

    console.log('\nPlanned:');
    console.log(
      `  1. Profile ${PLAN2_PROFILE_ID}: phase_start ${plan2.phase_start}→1, total_phases ${plan2.total_phases}→10, first_billing→2026-04-01`
    );
    console.log(`  2. Delete ${toDelete.length} orphan/duplicate classstudent rows`);
    console.log('  3. Expect Sep re-enrolled (or Active label) so Malolos Total Active includes Morgan');
    console.log(`  4. Plan 1 profile ${PLAN1_PROFILE_ID} left as-is; INV-${PLAN2_INVOICE_ID} stays on Plan 2`);

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET phase_start = 1,
           total_phases = 10,
           first_billing_month = DATE '2026-04-01'
       WHERE installmentinvoiceprofiles_id = $1
         AND student_id = $2`,
      [PLAN2_PROFILE_ID, STUDENT_ID]
    );
    console.log('✅ Profile 525 → phase_start=1, total_phases=10, first_billing=2026-04-01');

    for (const row of toDelete) {
      await client.query(
        `DELETE FROM classstudentstbl
         WHERE classstudent_id = $1 AND student_id = $2 AND class_id = $3`,
        [row.classstudent_id, STUDENT_ID, CLASS_ID]
      );
      console.log(`✅ Deleted classstudent ${row.classstudent_id} (phase ${row.phase_number})`);
    }

    // Keep Plan 2 phase 10 as completed; align enrolled_at to payment month for clarity
    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'completed',
           enrolled_at = '2026-08-31 12:00:00'::timestamp,
           removed_at = NULL
       WHERE classstudent_id = 2488
         AND student_id = $1
         AND class_id = $2`,
      [STUDENT_ID, CLASS_ID]
    );
    console.log('✅ Phase 10 CS 2488 kept as completed');

    await client.query('COMMIT');
    console.log('\n✅ Committed.');

    const after = await previewMatrix(query);
    console.log('AFTER matrix meta:', after.meta);
    console.log('AFTER matrix:');
    console.table(after.cells);

    const activeAfter = buildMonthMatrixActiveTrackRows(
      (
        await loadStudentMonthEnrollmentMatrix(query, {
          year: 2026,
          branchId: BRANCH_ID,
        })
      ).students || [],
      '2026-09'
    ).filter((r) => Number(r.student_id) === STUDENT_ID);
    console.log('AFTER Sep Active tracks:', activeAfter);

    const sep = after.cells.find((c) => c.month === '2026-09');
    if (!sep || !['re-enrolled', 're_enrolled', 'new', 'rejoin', 'upsell', 'completed'].includes(sep.label)) {
      console.warn('⚠️ September cell not an Active-capable label:', sep);
    } else if (!activeAfter.length && sep.label === 'completed') {
      console.warn('⚠️ September is completed but not in Active index (check multi-phase rules)');
    } else if (!activeAfter.length) {
      console.warn('⚠️ Morgan still not in September Active tracks');
    } else {
      console.log('Matrix OK: Morgan counts toward September Active.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
