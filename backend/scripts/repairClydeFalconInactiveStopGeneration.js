/**
 * CLYDE WESLEY Q. FALCON (user_id 81) — Cavite
 *
 * Problem:
 *   - Month matrix May stayed Active (✓) with no due date because unpaid
 *     installment invoices lacked TARGET_PHASE remarks, so the lifecycle
 *     overlay could not map them to a billing month.
 *   - Both installment profiles remain is_active=true even though the student
 *     was dropped for delinquency and generation should stop.
 *
 * Fix (code + data):
 *   1) enrollmentRateMetrics lifecycle loader now falls back to issue_date
 *      phase ranking when TARGET_PHASE is missing (matrix May → Inactive).
 *   2) This script deactivates profiles 55 (Pre-Kinder) and 58 (Playgroup),
 *      clears next_generation_date, and keeps queue status = Generated so the
 *      nightly generator will not create further invoices.
 *
 * Run (from backend/):
 *   node scripts/repairClydeFalconInactiveStopGeneration.js --production
 *   node scripts/repairClydeFalconInactiveStopGeneration.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { todayYmdManila } from '../utils/dateUtils.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 81;
const BRANCH_ID = 3;
const PROFILE_IDS = [55, 58];
const REPAIR_NOTE =
  'Ops repair — Clyde Falcon Inactive May + stop installment generation (delinquency)';

const isApply = process.argv.includes('--apply');

async function previewMatrix(queryFn) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year: 2026,
    branchId: BRANCH_ID,
  });
  const tracks = (matrix.students || []).filter((s) => Number(s.student_id) === STUDENT_ID);
  const cells = [];
  for (const track of tracks) {
    for (const key of ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07']) {
      const c = track?.months?.[key];
      if (!c) continue;
      if (c.mark === '1' || c.mark === '✓' || c.mark === 'X' || c.label) {
        cells.push({
          class_id: track.class_id,
          class_name: track.class_name,
          month: key,
          label: c.label,
          status: c.status,
          phase: c.phase_number ?? null,
          mark: c.mark,
          due: c.invoice_due_date || null,
        });
      }
    }
  }
  return cells;
}

async function main() {
  console.log(
    `\nClyde Falcon — Inactive + stop generation${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`Manila today: ${todayYmdManila()}\n`);

  const client = await getClient();
  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1`,
        [STUDENT_ID]
      )
    ).rows[0];
    if (!student) throw new Error(`Student ${STUDENT_ID} not found`);

    const profiles = (
      await client.query(
        `SELECT ip.installmentinvoiceprofiles_id AS pid, ip.class_id, c.class_name,
                ip.is_active, ip.generated_count, ip.total_phases,
                ii.installmentinvoicedtl_id AS iid,
                TO_CHAR(ii.next_generation_date, 'YYYY-MM-DD') AS next_gen,
                TO_CHAR(ii.next_invoice_month, 'YYYY-MM-DD') AS next_month,
                ii.status AS ii_status
         FROM installmentinvoiceprofilestbl ip
         LEFT JOIN installmentinvoicestbl ii
           ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
         LEFT JOIN classestbl c ON c.class_id = ip.class_id
         WHERE ip.installmentinvoiceprofiles_id = ANY($1::int[])
         ORDER BY ip.installmentinvoiceprofiles_id`,
        [PROFILE_IDS]
      )
    ).rows;

    const status = (
      await client.query(
        `SELECT status, updated_reason FROM student_statustbl WHERE student_id = $1`,
        [STUDENT_ID]
      )
    ).rows[0];

    console.log('Student:', student.full_name, student.email);
    console.log('student_statustbl:', status);
    console.log('\nProfiles BEFORE:');
    console.table(profiles);
    console.log('\nMatrix BEFORE (code fix already applied for lifecycle):');
    console.table(await previewMatrix(query));

    const needsDeactivate = profiles.filter((p) => p.is_active !== false);
    console.log('\nPlanned:');
    if (needsDeactivate.length) {
      for (const p of needsDeactivate) {
        console.log(
          `  • Profile ${p.pid} (${p.class_name}): is_active true → false; next_gen cleared; status=Generated`
        );
      }
    } else {
      console.log('  • Profiles already inactive');
    }

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to write.');
      return;
    }

    await client.query('BEGIN');

    for (const p of profiles) {
      await client.query(
        `UPDATE installmentinvoiceprofilestbl
         SET is_active = false
         WHERE installmentinvoiceprofiles_id = $1`,
        [p.pid]
      );

      if (p.iid) {
        await client.query(
          `UPDATE installmentinvoicestbl
           SET status = 'Generated',
               next_generation_date = NULL,
               next_invoice_month = NULL
           WHERE installmentinvoicedtl_id = $1`,
          [p.iid]
        );
      }
      console.log(`✅ Profile ${p.pid} deactivated; queue generation stopped`);
    }

    await client.query('COMMIT');

    const afterProfiles = (
      await client.query(
        `SELECT ip.installmentinvoiceprofiles_id AS pid, ip.class_id, c.class_name,
                ip.is_active, ip.generated_count,
                TO_CHAR(ii.next_generation_date, 'YYYY-MM-DD') AS next_gen,
                ii.status AS ii_status
         FROM installmentinvoiceprofilestbl ip
         LEFT JOIN installmentinvoicestbl ii
           ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
         LEFT JOIN classestbl c ON c.class_id = ip.class_id
         WHERE ip.installmentinvoiceprofiles_id = ANY($1::int[])
         ORDER BY ip.installmentinvoiceprofiles_id`,
        [PROFILE_IDS]
      )
    ).rows;

    console.log('\nProfiles AFTER:');
    console.table(afterProfiles);
    console.log('\nMatrix AFTER:');
    console.table(await previewMatrix(query));
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
