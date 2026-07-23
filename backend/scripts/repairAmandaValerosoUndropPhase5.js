/**
 * Undrop Amanda Elisse M. Valeroso (user 397) — accidental manual class drop.
 *
 * Context:
 *   Manual drop on 2026-07-21 (reason "already done") set removed_at on phases 1–4
 *   and inserted Phase 5 drop marker. Profile 180 was deactivated.
 *   Phases 1–4 invoices remain Paid; Phase 5 was never generated.
 *
 * Fix:
 *   1. DELETE Phase 5 dropped marker (classstudent_id 1900)
 *   2. Clear removed_at / removed_reason / removed_by on phases 1–4
 *   3. Reactivate installment profile 180 (is_active = true)
 *
 * Expected UI:
 *   - Phase 5 Enrollment: — (not dropped)
 *   - Phase 5 Action: Pay Now (or generate when due)
 *   - Plan Status: Active
 *
 * Usage:
 *   node scripts/repairAmandaValerosoUndropPhase5.js
 *   node scripts/repairAmandaValerosoUndropPhase5.js --apply
 */
import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';

const STUDENT_ID = 397;
const CLASS_ID = 69;
const PROFILE_ID = 180;
const DROP_MARKER_ID = 1900;
const HISTORICAL_ENROLLMENT_IDS = [386, 649, 1009, 1476];

const REPAIR_NOTE =
  'Ops repair — undo accidental manual drop (reason "already done"); reinstate Pre-K plan';

const isApply = process.argv.includes('--apply');

async function loadState(client) {
  const student = (
    await client.query(
      `SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1`,
      [STUDENT_ID]
    )
  ).rows[0];

  const enrollments = (
    await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status,
              TO_CHAR(enrolled_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI') AS enrolled,
              TO_CHAR(removed_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI') AS removed,
              removed_reason, removed_by, enrolled_by
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number NULLS LAST, classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    )
  ).rows;

  const profile = (
    await client.query(
      `SELECT installmentinvoiceprofiles_id, class_id, is_active, generated_count,
              total_phases, phase_start,
              TO_CHAR(next_invoice_due_date AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS next_due,
              TO_CHAR(bill_invoice_due_date AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS bill_due
       FROM installmentinvoiceprofilestbl
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    )
  ).rows[0];

  return { student, enrollments, profile };
}

async function main() {
  const client = await getClient();
  try {
    const before = await loadState(client);
    if (!before.student) throw new Error(`Student ${STUDENT_ID} not found`);
    if (!before.profile) throw new Error(`Profile ${PROFILE_ID} not found`);

    const dropMarker = before.enrollments.find(
      (e) => e.classstudent_id === DROP_MARKER_ID
    );
    const historical = before.enrollments.filter((e) =>
      HISTORICAL_ENROLLMENT_IDS.includes(e.classstudent_id)
    );

    console.log('============================================================');
    console.log(isApply ? 'APPLY' : 'DRY RUN — no data will change');
    console.log('============================================================');
    console.log(
      `Student: ${before.student.full_name} <${before.student.email}> (user_id=${STUDENT_ID})`
    );
    console.log(`Class ${CLASS_ID} | Profile ${PROFILE_ID}`);
    console.log(`Note: ${REPAIR_NOTE}`);

    console.log('\nBEFORE enrollments:');
    console.table(before.enrollments);
    console.log('BEFORE profile:', before.profile);

    console.log('\nPlanned fixes:');
    console.table([
      {
        step: '1_delete_drop_marker',
        detail: dropMarker
          ? `DELETE classstudent_id ${DROP_MARKER_ID} (phase ${dropMarker.phase_number}, ${dropMarker.program_enrollment_status})`
          : 'drop marker already absent',
      },
      {
        step: '2_clear_removed_on_phases_1_4',
        detail: historical
          .map(
            (e) =>
              `P${e.phase_number} id=${e.classstudent_id} clear removed_at (${e.removed || 'null'})`
          )
          .join('; '),
      },
      {
        step: '3_reactivate_profile',
        detail: `is_active ${before.profile.is_active} → true (generated_count stays ${before.profile.generated_count})`,
      },
    ]);

    if (!dropMarker) {
      console.warn(
        `\nWARNING: Expected drop marker ${DROP_MARKER_ID} not found — check data before --apply.`
      );
    }
    if (historical.length !== HISTORICAL_ENROLLMENT_IDS.length) {
      console.warn(
        `\nWARNING: Expected ${HISTORICAL_ENROLLMENT_IDS.length} historical rows, found ${historical.length}.`
      );
    }

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to commit.');
      process.exit(0);
    }

    await client.query('BEGIN');

    if (dropMarker) {
      const del = await client.query(
        `DELETE FROM classstudentstbl
         WHERE classstudent_id = $1
           AND student_id = $2
           AND class_id = $3
           AND program_enrollment_status = 'dropped'
         RETURNING classstudent_id, phase_number`,
        [DROP_MARKER_ID, STUDENT_ID, CLASS_ID]
      );
      if (!del.rows.length) {
        throw new Error(`Failed to delete drop marker ${DROP_MARKER_ID}`);
      }
      console.log('✅ Deleted Phase 5 drop marker:', del.rows[0]);
    }

    const cleared = await client.query(
      `UPDATE classstudentstbl
       SET removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL
       WHERE classstudent_id = ANY($1::int[])
         AND student_id = $2
         AND class_id = $3
       RETURNING classstudent_id, phase_number, program_enrollment_status`,
      [HISTORICAL_ENROLLMENT_IDS, STUDENT_ID, CLASS_ID]
    );
    console.log('✅ Cleared removed_* on historical phases:');
    console.table(cleared.rows);

    const profileUpd = await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET is_active = true
       WHERE installmentinvoiceprofiles_id = $1
         AND student_id = $2
       RETURNING installmentinvoiceprofiles_id, is_active, generated_count`,
      [PROFILE_ID, STUDENT_ID]
    );
    console.log('✅ Reactivated profile:', profileUpd.rows[0]);

    await client.query('COMMIT');
    console.log('\nCommitted.');

    const after = await loadState(query);
    console.log('\nAFTER enrollments:');
    console.table(after.enrollments);
    console.log('AFTER profile:', after.profile);
    console.log(
      '\nRefresh Student history → Invoices. Phase 5 should no longer show dropped; plan Active.'
    );
    process.exit(0);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('Repair failed:', err?.message || err);
    process.exit(1);
  } finally {
    client.release();
  }
}

main();
