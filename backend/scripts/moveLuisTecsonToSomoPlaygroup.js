/**
 * Move Azikiel F. Tecson (luis.tecson.ph@gmail.com) to SOMO_Playgroup_TTh_9:30-10:30AM
 * (class_id 47, Rhea Mae — the 8/8 full class), and raise that class max_students to 10.
 *
 * Context (production):
 *   Student user_id 643
 *   Source: class 114 SOMO_Playgroup_TTH_9:30-10:30AM — pending_enrollment phase 6
 *   Target: class 47  SOMO_Playgroup_TTh_9:30-10:30AM — currently 8/8 active
 *   Installment profile 472 is tied to class 114 (phase_start 6)
 *
 * Note: Built-in move-student API only moves active enrollments (new/re_enrolled/…),
 * not pending_enrollment — this script moves the pending row + profile explicitly.
 *
 * Usage (from backend/):
 *   node scripts/moveLuisTecsonToSomoPlaygroup.js --production
 *   node scripts/moveLuisTecsonToSomoPlaygroup.js --production --apply
 */
import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';

const STUDENT_EMAIL = 'luis.tecson.ph@gmail.com';
const STUDENT_ID = 643;
const SOURCE_CLASS_ID = 114;
const TARGET_CLASS_ID = 47;
const TARGET_CLASS_NAME = 'SOMO_Playgroup_TTh_9:30-10:30AM';
const NEW_MAX_STUDENTS = 10;
const PROFILE_ID = 472;
const ENROLLMENT_ID = 1519;

const isApply = process.argv.includes('--apply');
const REPAIR_NOTE =
  'Ops repair — raise SOMO Playgroup TTh max to 10; move Luis Tecson from class 114 → 47';

async function loadSnapshot() {
  const student = (
    await query(
      `SELECT user_id, full_name, email, branch_id
       FROM userstbl WHERE user_id = $1`,
      [STUDENT_ID]
    )
  ).rows[0];

  const source = (
    await query(
      `SELECT class_id, class_name, branch_id, program_id, max_students, status
       FROM classestbl WHERE class_id = $1`,
      [SOURCE_CLASS_ID]
    )
  ).rows[0];

  const target = (
    await query(
      `SELECT class_id, class_name, branch_id, program_id, max_students, status,
              TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
              TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date
       FROM classestbl WHERE class_id = $1`,
      [TARGET_CLASS_ID]
    )
  ).rows[0];

  const enrollment = (
    await query(
      `SELECT classstudent_id, class_id, phase_number, program_enrollment_status, removed_at
       FROM classstudentstbl WHERE classstudent_id = $1`,
      [ENROLLMENT_ID]
    )
  ).rows[0];

  const profile = (
    await query(
      `SELECT installmentinvoiceprofiles_id, class_id, is_active, generated_count,
              total_phases, phase_start
       FROM installmentinvoiceprofilestbl
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    )
  ).rows[0];

  const targetActive = (
    await query(
      `SELECT COUNT(DISTINCT student_id)::int AS n
       FROM classstudentstbl
       WHERE class_id = $1
         AND removed_at IS NULL
         AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')`,
      [TARGET_CLASS_ID]
    )
  ).rows[0]?.n;

  return { student, source, target, enrollment, profile, targetActive };
}

async function main() {
  if (!process.argv.includes('--production') && !process.argv.includes('--development')) {
    console.log(
      'Tip: pass --production (this student lives on production) or --development.\n'
    );
  }

  const before = await loadSnapshot();

  console.log('============================================================');
  console.log(isApply ? 'APPLY' : 'DRY RUN — no data will change');
  console.log('============================================================');
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log('\nStudent:', before.student);
  console.log('Source class:', before.source);
  console.log('Target class:', before.target);
  console.log('Enrollment row:', before.enrollment);
  console.log('Installment profile:', before.profile);
  console.log(
    `Target active enrolled: ${before.targetActive} / max ${before.target?.max_students}`
  );

  if (!before.student || String(before.student.email || '').toLowerCase() !== STUDENT_EMAIL) {
    throw new Error(`Expected student ${STUDENT_EMAIL} (user_id ${STUDENT_ID})`);
  }
  if (!before.target || before.target.class_name !== TARGET_CLASS_NAME) {
    throw new Error(
      `Expected target class_id ${TARGET_CLASS_ID} named ${TARGET_CLASS_NAME}, got ${before.target?.class_name}`
    );
  }
  if (!before.source || before.source.class_id !== SOURCE_CLASS_ID) {
    throw new Error(`Source class ${SOURCE_CLASS_ID} not found`);
  }
  if (before.source.program_id !== before.target.program_id) {
    throw new Error('Source and target must share the same program_id');
  }
  if (before.source.branch_id !== before.target.branch_id) {
    throw new Error('Source and target must share the same branch_id');
  }
  if (!before.enrollment || before.enrollment.class_id !== SOURCE_CLASS_ID) {
    throw new Error(
      `Enrollment ${ENROLLMENT_ID} is not on source class ${SOURCE_CLASS_ID} (current class_id=${before.enrollment?.class_id})`
    );
  }
  if (!before.profile || before.profile.class_id !== SOURCE_CLASS_ID) {
    throw new Error(
      `Profile ${PROFILE_ID} is not on source class ${SOURCE_CLASS_ID} (current class_id=${before.profile?.class_id})`
    );
  }

  const afterMoveActive = before.targetActive; // pending does not count as active enrolled
  console.log('\nPlanned fixes:');
  console.table([
    {
      step: '1_raise_max',
      detail: `class ${TARGET_CLASS_ID} max_students ${before.target.max_students} → ${NEW_MAX_STUDENTS}`,
    },
    {
      step: '2_move_enrollment',
      detail: `classstudent ${ENROLLMENT_ID} (${before.enrollment.program_enrollment_status} P${before.enrollment.phase_number}) ${SOURCE_CLASS_ID} → ${TARGET_CLASS_ID}`,
    },
    {
      step: '3_move_profile',
      detail: `installment profile ${PROFILE_ID} ${SOURCE_CLASS_ID} → ${TARGET_CLASS_ID}`,
    },
    {
      step: 'capacity_after',
      detail: `active enrolled stays ~${afterMoveActive}/${NEW_MAX_STUDENTS} (Luis is pending_enrollment until Phase 6 is paid)`,
    },
  ]);

  if (!isApply) {
    console.log('\nDry run only. Re-run with --apply to commit.');
    process.exit(0);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const maxUpd = await client.query(
      `UPDATE classestbl
       SET max_students = $1
       WHERE class_id = $2
       RETURNING class_id, class_name, max_students`,
      [NEW_MAX_STUDENTS, TARGET_CLASS_ID]
    );
    console.log('✅ max_students updated:', maxUpd.rows[0]);

    // Re-check capacity for safety if enrollment were active
    const cap = await client.query(
      `SELECT COUNT(DISTINCT student_id)::int AS n
       FROM classstudentstbl
       WHERE class_id = $1
         AND removed_at IS NULL
         AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')`,
      [TARGET_CLASS_ID]
    );
    const activeCount = parseInt(cap.rows[0].n, 10) || 0;
    if (activeCount + 1 > NEW_MAX_STUDENTS) {
      throw new Error(
        `Target would exceed capacity after move (${activeCount}+1 > ${NEW_MAX_STUDENTS})`
      );
    }

    const enrUpd = await client.query(
      `UPDATE classstudentstbl
       SET class_id = $1
       WHERE classstudent_id = $2
         AND student_id = $3
         AND class_id = $4
       RETURNING classstudent_id, class_id, phase_number, program_enrollment_status`,
      [TARGET_CLASS_ID, ENROLLMENT_ID, STUDENT_ID, SOURCE_CLASS_ID]
    );
    if (!enrUpd.rows.length) {
      throw new Error('Failed to move enrollment row');
    }
    console.log('✅ Enrollment moved:', enrUpd.rows[0]);

    const profUpd = await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET class_id = $1
       WHERE installmentinvoiceprofiles_id = $2
         AND student_id = $3
         AND class_id = $4
       RETURNING installmentinvoiceprofiles_id, class_id, is_active, phase_start`,
      [TARGET_CLASS_ID, PROFILE_ID, STUDENT_ID, SOURCE_CLASS_ID]
    );
    if (!profUpd.rows.length) {
      throw new Error('Failed to move installment profile');
    }
    console.log('✅ Profile moved:', profUpd.rows[0]);

    await client.query('COMMIT');
    console.log('\nCommitted.');

    const after = await loadSnapshot();
    console.log('\nAFTER target class:', after.target);
    console.log('AFTER enrollment:', after.enrollment);
    console.log('AFTER profile:', after.profile);
    console.log(`AFTER active enrolled: ${after.targetActive} / ${after.target.max_students}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Move failed:', err?.message || err);
    process.exit(1);
  } finally {
    client.release();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
