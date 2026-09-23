/**
 * Selah Amelia V. Ercilla (scgercilla@gmail.com) — fix enrollment statuses
 * for Phase 2 and Phase 3 on SOMO Nursery TThS 1:00–2:00PM.
 *
 * Student History showed:
 *   Phase 1 → new          (keep)
 *   Phase 2 → new          → should be re_enrolled  (INV 233 paid)
 *   Phase 3 → new          → should be re_enrolled  (INV 636 paid)
 *   Phase 4–6 → re_enrolled (already correct)
 *
 * Does NOT change invoices, payments, or dates.
 *
 * Run (dry-run):
 *   node backend/scripts/repairSelahErcillaPhase2And3Enrollment.js --production
 *
 * Apply:
 *   node backend/scripts/repairSelahErcillaPhase2And3Enrollment.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const STUDENT_EMAIL = 'scgercilla@gmail.com';
const STUDENT_ID = 64;
const CLASS_ID = 33;
const CLASS_NAME = 'SOMO_Nursery_TThS_1:00-2:00PM';

const REPAIR_NOTE =
  'Ops repair 2026-09-19 — Selah Ercilla Phase 2–3 enrollment new → re_enrolled';

const PHASES = [
  {
    classstudent_id: 360,
    phase: 2,
    currentStatus: 'new',
    targetStatus: 're_enrolled',
  },
  {
    classstudent_id: 535,
    phase: 3,
    currentStatus: 'new',
    targetStatus: 're_enrolled',
  },
];

const isApply = process.argv.includes('--apply');

async function loadEnrollments(client) {
  const r = await client.query(
    `SELECT cs.classstudent_id, cs.class_id, cs.phase_number,
            cs.program_enrollment_status AS status,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM-DD HH24:MI') AS removed
     FROM classstudentstbl cs
     WHERE cs.student_id = $1 AND cs.class_id = $2
     ORDER BY cs.phase_number, cs.classstudent_id`,
    [STUDENT_ID, CLASS_ID]
  );
  return r.rows;
}

async function main() {
  console.log(
    `\nSelah Ercilla — Phase 2 & 3 enrollment → re_enrolled` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

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
    if (!student) {
      throw new Error(`Student not found: id=${STUDENT_ID} email=${STUDENT_EMAIL}`);
    }
    console.log('Student:', student.full_name, student.email, `(id ${student.user_id})`);

    const klass = (
      await client.query(
        `SELECT class_id, class_name, branch_id FROM classestbl WHERE class_id = $1`,
        [CLASS_ID]
      )
    ).rows[0];
    if (!klass) {
      throw new Error(`Class ${CLASS_ID} not found`);
    }
    if (String(klass.class_name) !== CLASS_NAME) {
      throw new Error(
        `Class ${CLASS_ID} name mismatch: got "${klass.class_name}", expected "${CLASS_NAME}"`
      );
    }
    console.log('Class:', klass.class_name, `(id ${klass.class_id}, branch ${klass.branch_id})`);

    const before = await loadEnrollments(client);
    console.log('\nBEFORE enrollments:');
    console.table(before);

    for (const row of PHASES) {
      const existing = before.find((r) => Number(r.classstudent_id) === row.classstudent_id);
      if (!existing) {
        throw new Error(
          `Enrollment CS ${row.classstudent_id} (phase ${row.phase}) not found`
        );
      }
      if (Number(existing.phase_number) !== row.phase) {
        throw new Error(
          `CS ${row.classstudent_id} phase ${existing.phase_number} ≠ expected ${row.phase}`
        );
      }
      const status = String(existing.status || '');
      if (status !== row.currentStatus && status !== row.targetStatus) {
        throw new Error(
          `CS ${row.classstudent_id} status "${status}" is not "${row.currentStatus}" or already "${row.targetStatus}"`
        );
      }

      if (status === row.targetStatus) {
        console.log(
          `⏭️  Phase ${row.phase} CS ${row.classstudent_id}: already ${row.targetStatus}`
        );
        continue;
      }

      const upd = await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1
         WHERE classstudent_id = $2
           AND student_id = $3
           AND class_id = $4
           AND phase_number = $5
         RETURNING classstudent_id, phase_number, program_enrollment_status`,
        [row.targetStatus, row.classstudent_id, STUDENT_ID, CLASS_ID, row.phase]
      );
      if (upd.rows.length !== 1) {
        throw new Error(`Update failed for CS ${row.classstudent_id}`);
      }
      console.log(
        `✅ Phase ${row.phase} CS ${row.classstudent_id}: ${row.currentStatus} → ${row.targetStatus}`
      );
    }

    const after = await loadEnrollments(client);
    console.log('\nAFTER enrollments (in transaction):');
    console.table(after);

    const expectedByPhase = {
      1: 'new',
      2: 're_enrolled',
      3: 're_enrolled',
      4: 're_enrolled',
      5: 're_enrolled',
      6: 're_enrolled',
    };
    for (const [phaseStr, expectedStatus] of Object.entries(expectedByPhase)) {
      const phase = Number(phaseStr);
      const row = after.find((r) => Number(r.phase_number) === phase);
      if (!row) {
        throw new Error(`Validation: missing phase ${phase}`);
      }
      if (String(row.status) !== expectedStatus) {
        throw new Error(
          `Validation: phase ${phase} status=${row.status}, expected ${expectedStatus}`
        );
      }
    }
    console.log('\n✅ Validation OK (phases 1–6 statuses match expected).');

    if (isApply) {
      await client.query('COMMIT');
      console.log('\n✅ COMMITTED.');
    } else {
      await client.query('ROLLBACK');
      console.log('\n↩️  DRY RUN — rolled back. Re-run with --apply to commit.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
