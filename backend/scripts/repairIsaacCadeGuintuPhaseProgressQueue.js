/**
 * Isaac Cade Guintu — Installment Invoice Logs: phase progress 8→7 + queue Aug 25 / Sep 1.
 *
 * Student: 359 · Profile: 159 · Class: 67 · Queue row: 152
 *
 * Cause:
 *   Phase 8 matrix-bridge enrollment (classstudent 2197) makes
 *   last_enrolled_phase_number = 8 → Phase Progress 8/10, and the logs UI
 *   prefers schedule current_generation_date (Sep 25) over the stored queue
 *   next_generation_date (Aug 25).
 *
 * Fix:
 *   - DELETE phase 8 bridge enrollment 2197
 *   - Ensure queue next_generation_date = 2026-08-25, next_invoice_month = 2026-09-01
 *   - generated_count stays 4 (paid phases 4–7) → progress shows 7 / 10
 *
 * Note: Removing the Phase 8 bridge returns the month matrix Active cell to August
 * (Jul re-enrolled → Aug Active). Phase 7 due Aug 5 is unchanged.
 *
 * Run:
 *   node backend/scripts/repairIsaacCadeGuintuPhaseProgressQueue.js --production
 *   node backend/scripts/repairIsaacCadeGuintuPhaseProgressQueue.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';

const STUDENT_ID = 359;
const STUDENT_EMAIL = 'jershey_decenanuguid@yahoo.com';
const CLASS_ID = 67;
const PROFILE_ID = 159;
const QUEUE_ID = 152;
const PHASE8_BRIDGE_CLASSSTUDENT_ID = 2197;

const TARGET_NEXT_GEN = '2026-08-25';
const TARGET_NEXT_MONTH = '2026-09-01';
const EXPECTED_GENERATED_COUNT = 4;

const REPAIR_NOTE =
  'Ops repair 2026-08-07 — Isaac Cade Guintu remove phase 8 matrix bridge so Installment Logs progress 7/10 and queue Aug 25 / Sep 1';

const isApply = process.argv.includes('--apply');

async function loadSnapshot(client) {
  const profile = (
    await client.query(
      `SELECT installmentinvoiceprofiles_id, phase_start, total_phases, generated_count, is_active
       FROM installmentinvoiceprofilestbl
       WHERE installmentinvoiceprofiles_id = $1 AND student_id = $2`,
      [PROFILE_ID, STUDENT_ID]
    )
  ).rows[0];

  const queue = (
    await client.query(
      `SELECT installmentinvoicedtl_id, status,
              TO_CHAR(next_generation_date, 'YYYY-MM-DD') AS next_gen,
              TO_CHAR(next_invoice_month, 'YYYY-MM-DD') AS next_month,
              TO_CHAR(scheduled_date, 'YYYY-MM-DD') AS scheduled
       FROM installmentinvoicestbl
       WHERE installmentinvoicedtl_id = $1
         AND installmentinvoiceprofiles_id = $2`,
      [QUEUE_ID, PROFILE_ID]
    )
  ).rows[0];

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

  const lastEnrolled = enrollments.reduce(
    (max, row) => Math.max(max, Number(row.phase_number) || 0),
    0
  );
  const phaseStart = Number(profile?.phase_start) || 1;
  const totalPhases = Number(profile?.total_phases) || 0;
  const generatedCount = Number(profile?.generated_count) || 0;
  const phaseStartOffset = Math.max(0, phaseStart - 1);
  const lastEnrolledRelative = Math.max(0, lastEnrolled - phaseStartOffset);
  const displayProgress = Math.min(
    Math.max(generatedCount, lastEnrolledRelative),
    totalPhases || Number.POSITIVE_INFINITY
  );
  const numerator = displayProgress + phaseStartOffset;
  const denominator = totalPhases ? totalPhases + phaseStartOffset : null;

  return {
    profile,
    queue,
    enrollments,
    progress: {
      last_enrolled_phase: lastEnrolled,
      generated_count: generatedCount,
      display_like: denominator != null ? `${numerator} / ${denominator}` : String(numerator),
    },
  };
}

async function main() {
  console.log(
    `\nIsaac Cade Guintu — phase progress + queue${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
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
    if (!student) {
      throw new Error(`Student ${STUDENT_ID} / ${STUDENT_EMAIL} not found`);
    }
    console.log('Student:', student.full_name, student.email);

    const before = await loadSnapshot(client);
    if (!before.profile) throw new Error(`Profile ${PROFILE_ID} not found`);
    if (!before.queue) throw new Error(`Queue ${QUEUE_ID} not found`);

    console.log('\nBEFORE profile:');
    console.table([before.profile]);
    console.log('BEFORE queue:');
    console.table([before.queue]);
    console.log('BEFORE enrollments:');
    console.table(before.enrollments);
    console.log('BEFORE progress (approx):', before.progress.display_like);

    const phase8 = before.enrollments.find(
      (e) => Number(e.classstudent_id) === PHASE8_BRIDGE_CLASSSTUDENT_ID
    );
    const needsDeletePhase8 = Boolean(phase8) && Number(phase8.phase_number) === 8;
    const needsQueue =
      before.queue.next_gen !== TARGET_NEXT_GEN ||
      before.queue.next_month !== TARGET_NEXT_MONTH;
    const needsGenerated =
      Number(before.profile.generated_count) !== EXPECTED_GENERATED_COUNT;

    console.log('\nPlanned:');
    if (needsDeletePhase8) {
      console.log(
        `  1. DELETE classstudent ${PHASE8_BRIDGE_CLASSSTUDENT_ID} (phase 8 matrix bridge)`
      );
      console.log(
        '     → Phase Progress 8/10 → 7/10; logs Next Generation uses stored Aug 25 again'
      );
      console.log(
        '     → Month matrix Aug returns to Active (tradeoff vs earlier Aug re-enrolled bridge)'
      );
    } else {
      console.log('  1. Phase 8 bridge already absent');
    }
    if (needsQueue) {
      console.log(
        `  2. Queue ${QUEUE_ID}: ${before.queue.next_gen}/${before.queue.next_month} → ${TARGET_NEXT_GEN}/${TARGET_NEXT_MONTH}`
      );
    } else {
      console.log(
        `  2. Queue already ${TARGET_NEXT_GEN} / ${TARGET_NEXT_MONTH}`
      );
    }
    if (needsGenerated) {
      console.log(
        `  3. generated_count ${before.profile.generated_count} → ${EXPECTED_GENERATED_COUNT}`
      );
    } else {
      console.log(`  3. generated_count already ${EXPECTED_GENERATED_COUNT}`);
    }
    console.log('  4. Expect Installment Logs: Next Gen Aug 25, Next Month Sep 1, Progress 7/10');

    if (!needsDeletePhase8 && !needsQueue && !needsGenerated) {
      console.log('\nNo changes needed.');
      return;
    }

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    if (needsDeletePhase8) {
      await client.query(
        `DELETE FROM classstudentstbl
         WHERE classstudent_id = $1
           AND student_id = $2
           AND class_id = $3
           AND phase_number = 8`,
        [PHASE8_BRIDGE_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
      );
      console.log(`✅ Deleted phase 8 bridge classstudent ${PHASE8_BRIDGE_CLASSSTUDENT_ID}`);
    }

    if (needsQueue) {
      await client.query(
        `UPDATE installmentinvoicestbl
         SET next_generation_date = $1::date,
             next_invoice_month = $2::date
         WHERE installmentinvoicedtl_id = $3
           AND installmentinvoiceprofiles_id = $4`,
        [TARGET_NEXT_GEN, TARGET_NEXT_MONTH, QUEUE_ID, PROFILE_ID]
      );
      console.log(`✅ Queue → ${TARGET_NEXT_GEN} / ${TARGET_NEXT_MONTH}`);
    }

    if (needsGenerated) {
      await client.query(
        `UPDATE installmentinvoiceprofilestbl
         SET generated_count = $1
         WHERE installmentinvoiceprofiles_id = $2
           AND student_id = $3`,
        [EXPECTED_GENERATED_COUNT, PROFILE_ID, STUDENT_ID]
      );
      console.log(`✅ generated_count → ${EXPECTED_GENERATED_COUNT}`);
    }

    // Audit note on profile description is optional; keep enroll_by trail elsewhere.
    console.log(`Note: ${REPAIR_NOTE}`);

    await client.query('COMMIT');

    const after = await loadSnapshot(query);
    console.log('\nAFTER queue:');
    console.table([after.queue]);
    console.log('AFTER enrollments:');
    console.table(after.enrollments);
    console.log('AFTER progress (approx):', after.progress.display_like);

    if (after.progress.display_like !== '7 / 10') {
      console.warn(
        `\n⚠ Expected progress 7 / 10, got ${after.progress.display_like}`
      );
    } else {
      console.log('\n✅ Progress approx 7 / 10.');
    }
    console.log('\nRefresh Manage Invoice → Installment Invoice Logs.');
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
