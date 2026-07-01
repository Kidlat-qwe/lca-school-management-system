/**
 * Reinstate class enrollment rows that were auto-dropped by installment delinquency
 * when the student should remain enrolled (paid phases / partial payment on file).
 *
 * Usage:
 *   node scripts/reinstateStudentAfterDelinquencyDrop.js --email=djuannadeluna@yahoo.com
 *   node scripts/reinstateStudentAfterDelinquencyDrop.js --student-id=21
 *   node scripts/reinstateStudentAfterDelinquencyDrop.js --email=... --dry-run
 */
import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import {
  determineRejoinAwarePhaseStatus,
  PROGRAM_ENROLLMENT_STATUS,
} from '../utils/enrollmentStatus.js';
import { resolveProfilePhaseStart } from '../utils/phaseInstallmentUtils.js';

const dryRun = process.argv.includes('--dry-run');
const emailArg = process.argv.find((a) => a.startsWith('--email='));
const studentIdArg = process.argv.find((a) => a.startsWith('--student-id='));

const email = emailArg ? emailArg.split('=').slice(1).join('=').trim().toLowerCase() : null;
const studentIdFilter = studentIdArg ? parseInt(studentIdArg.split('=')[1], 10) : null;

if (!email && !Number.isFinite(studentIdFilter)) {
  console.error('Provide --email=... or --student-id=...');
  process.exit(1);
}

async function main() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    let studentId = studentIdFilter;
    let fullName = null;
    if (email) {
      const userRes = await client.query(
        `SELECT user_id, full_name FROM userstbl WHERE LOWER(TRIM(email)) = $1 AND user_type = 'Student'`,
        [email]
      );
      if (!userRes.rows.length) {
        throw new Error(`No student found for email: ${email}`);
      }
      studentId = userRes.rows[0].user_id;
      fullName = userRes.rows[0].full_name;
    } else {
      const userRes = await client.query(
        `SELECT user_id, full_name FROM userstbl WHERE user_id = $1`,
        [studentId]
      );
      if (!userRes.rows.length) throw new Error(`No user_id ${studentId}`);
      fullName = userRes.rows[0].full_name;
    }

    const rowsRes = await client.query(
      `SELECT cs.classstudent_id, cs.class_id, cs.phase_number, cs.program_enrollment_status,
              cs.removed_at, cs.removed_reason, c.class_name
       FROM classstudentstbl cs
       INNER JOIN classestbl c ON c.class_id = cs.class_id
       WHERE cs.student_id = $1
         AND cs.program_enrollment_status = 'dropped'
         AND cs.removed_reason ILIKE '%Installment delinquency%'
       ORDER BY cs.class_id, COALESCE(cs.phase_number, 1), cs.classstudent_id`,
      [studentId]
    );

    if (!rowsRes.rows.length) {
      console.log(`No delinquency-dropped rows for ${fullName} (user_id=${studentId}).`);
      await client.query('ROLLBACK');
      return;
    }

    console.log(
      `${dryRun ? '[dry-run] ' : ''}Reinstating ${rowsRes.rows.length} row(s) for ${fullName} (user_id=${studentId}):`
    );

    for (const row of rowsRes.rows) {
      const phase = parseInt(row.phase_number, 10) || 1;
      const profileRes = await client.query(
        `SELECT phase_start FROM installmentinvoiceprofilestbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY installmentinvoiceprofiles_id DESC LIMIT 1`,
        [studentId, row.class_id]
      );
      const phaseStart = resolveProfilePhaseStart(profileRes.rows[0] || {});
      const defaultStatus =
        phase === phaseStart
          ? PROGRAM_ENROLLMENT_STATUS.NEW
          : PROGRAM_ENROLLMENT_STATUS.RE_ENROLLED;
      const status = await determineRejoinAwarePhaseStatus({
        db: client,
        studentId,
        classId: row.class_id,
        phaseNumber: phase,
        defaultStatus,
      });
      console.log(
        `  classstudent_id=${row.classstudent_id} class=${row.class_name} phase=${phase} -> ${status}`
      );

      if (!dryRun) {
        await client.query(
          `UPDATE classstudentstbl
           SET program_enrollment_status = $1,
               removed_at = NULL,
               removed_reason = NULL,
               removed_by = NULL
           WHERE classstudent_id = $2`,
          [status, row.classstudent_id]
        );
      }
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('Dry run complete — no changes committed.');
    } else {
      await client.query('COMMIT');
      const statusRes = await client.query(
        `SELECT status, updated_reason FROM student_statustbl WHERE student_id = $1`,
        [studentId]
      );
      console.log('Done. student_statustbl:', statusRes.rows[0] || '(none)');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
