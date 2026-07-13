/**
 * Jianna Mirabuenos + Ciandrei Maclang — false "rejoin" after pending DP placeholder drop.
 *
 * Pattern: pending_enrollment row dropped same day Phase 1 paid → determineRejoin*
 * sees that drop and labels the real enrollment as rejoin.
 *
 * Expected:
 *   Jianna 1487: rejoin → new
 *   Ciandrei 1709: rejoin → new; 1710: rejoin → re_enrolled
 *
 * Run:
 *   node backend/scripts/repairJiannaCiandreiFalseRejoin.js
 *   node backend/scripts/repairJiannaCiandreiFalseRejoin.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const isApply = process.argv.includes('--apply');

const REPAIRS = [
  {
    name: 'Jianna Mavelle Mirabuenos',
    studentId: 642,
    branchId: 1,
    classId: 92,
    updates: [{ classstudentId: 1487, toStatus: 'new' }],
  },
  {
    name: 'Ciandrei Lui Maclang',
    studentId: 153,
    branchId: 1,
    classId: 141,
    updates: [
      { classstudentId: 1709, toStatus: 'new' },
      { classstudentId: 1710, toStatus: 're_enrolled' },
    ],
  },
];

async function preview(studentId, branchId, classId) {
  const matrix = await loadStudentMonthEnrollmentMatrix(query, {
    year: 2026,
    branchId,
    classId,
  });
  const track = (matrix.students || []).find(
    (s) => s.student_id === studentId && s.class_id === classId
  );
  const cells = [];
  for (const m of matrix.months || []) {
    const c = track?.months?.[m.key];
    if (c && (c.mark === '1' || c.mark === '✓' || c.mark === 'X' || c.label)) {
      cells.push({ month: m.key, label: c.label, status: c.status, phase: c.phase_number });
    }
  }
  return cells;
}

async function main() {
  console.log(`\nFalse rejoin repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`);
  const client = await getClient();
  try {
    for (const r of REPAIRS) {
      console.log(`\n--- ${r.name} ---`);
      const before = (
        await client.query(
          `SELECT classstudent_id, phase_number, program_enrollment_status,
                  TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled
           FROM classstudentstbl
           WHERE student_id = $1 AND class_id = $2
           ORDER BY COALESCE(phase_number,0), classstudent_id`,
          [r.studentId, r.classId]
        )
      ).rows;
      console.log('Enrollment BEFORE:');
      console.table(before);
      console.log('Matrix BEFORE:');
      console.table(await preview(r.studentId, r.branchId, r.classId));

      if (!isApply) continue;

      await client.query('BEGIN');
      for (const u of r.updates) {
        await client.query(
          `UPDATE classstudentstbl
           SET program_enrollment_status = $1,
               enrolled_by = COALESCE(enrolled_by, '') || $2
           WHERE classstudent_id = $3
             AND program_enrollment_status = 'rejoin'`,
          [
            u.toStatus,
            ` | Ops repair — false rejoin after pending DP drop → ${u.toStatus}`,
            u.classstudentId,
          ]
        );
      }
      await client.query('COMMIT');

      const after = (
        await client.query(
          `SELECT classstudent_id, phase_number, program_enrollment_status,
                  TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled
           FROM classstudentstbl
           WHERE student_id = $1 AND class_id = $2
           ORDER BY COALESCE(phase_number,0), classstudent_id`,
          [r.studentId, r.classId]
        )
      ).rows;
      console.log('Enrollment AFTER:');
      console.table(after);
      console.log('Matrix AFTER:');
      console.table(await preview(r.studentId, r.branchId, r.classId));
    }

    if (!isApply) console.log('\nDRY RUN — re-run with --apply');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('Repair failed:', err.message);
  process.exit(1);
});
