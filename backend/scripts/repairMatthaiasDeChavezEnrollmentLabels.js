/**
 * Matthaias Sabino De Chavez (sabinomira000@gmail.com, user 147) —
 * fix installment enrollment labels for continuous paid phases 1–5.
 *
 * Production class 92 · VMM_Playgroup_SS_11:00-12:00PM · profile 281
 *
 * Desired (always paid path):
 *   Phase 1 → new
 *   Phase 2–5 → re_enrolled
 *
 * Current bad state:
 *   P1 dropped (false delinquency after paid)
 *   P2 new (should be re_enrolled)
 *   P3 dropped (false delinquency after paid)
 *   P4 re_enrolled (ok)
 *   P5 rejoin (should be re_enrolled)
 *
 * Run (from backend/):
 *   node scripts/repairMatthaiasDeChavezEnrollmentLabels.js --production
 *   node scripts/repairMatthaiasDeChavezEnrollmentLabels.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const STUDENT_ID = 147;
const STUDENT_EMAIL = 'sabinomira000@gmail.com';
const CLASS_ID = 92;
const PROFILE_ID = 281;

/** @type {Array<{ classstudent_id: number, phase: number, status: string }>} */
const TARGETS = [
  { classstudent_id: 522, phase: 1, status: 'new' },
  { classstudent_id: 622, phase: 2, status: 're_enrolled' },
  { classstudent_id: 996, phase: 3, status: 're_enrolled' },
  { classstudent_id: 1437, phase: 4, status: 're_enrolled' },
  { classstudent_id: 2044, phase: 5, status: 're_enrolled' },
];

const isApply = process.argv.includes('--apply');

async function loadRows(client) {
  const res = await client.query(
    `SELECT cs.classstudent_id, cs.phase_number, cs.program_enrollment_status,
            cs.removed_at, cs.removed_reason, cs.removed_by,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD') AS enrolled_ymd
     FROM classstudentstbl cs
     WHERE cs.student_id = $1
       AND cs.class_id = $2
       AND cs.phase_number BETWEEN 1 AND 5
     ORDER BY cs.phase_number, cs.classstudent_id`,
    [STUDENT_ID, CLASS_ID]
  );
  return res.rows;
}

async function main() {
  console.log(
    `\nMatthaias De Chavez — enrollment labels P1–5${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );

  const client = await getClient();
  try {
    const user = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1`,
        [STUDENT_ID]
      )
    ).rows[0];
    if (!user) throw new Error(`Student ${STUDENT_ID} not found`);
    if (user.email?.toLowerCase() !== STUDENT_EMAIL.toLowerCase()) {
      throw new Error(`Email mismatch (expected ${STUDENT_EMAIL})`);
    }

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, is_active, generated_count, total_phases
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND student_id = $2
           AND class_id = $3`,
        [PROFILE_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found for student/class`);

    const paidPhases = (
      await client.query(
        `SELECT substring(remarks from 'TARGET_PHASE:([0-9]+)') AS phase, status
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND remarks ILIKE '%TARGET_PHASE:%'
         ORDER BY invoice_id`,
        [PROFILE_ID]
      )
    ).rows;

    console.log('Student:', user);
    console.log('Profile:', profile);
    console.log('\nInvoices (phase/status):');
    console.table(paidPhases);

    const before = await loadRows(client);
    console.log('\nBEFORE classstudent rows:');
    console.table(before);

    for (const t of TARGETS) {
      const row = before.find((r) => Number(r.classstudent_id) === t.classstudent_id);
      if (!row) throw new Error(`Missing classstudent_id ${t.classstudent_id}`);
      if (Number(row.phase_number) !== t.phase) {
        throw new Error(
          `classstudent ${t.classstudent_id} phase mismatch (expected ${t.phase}, got ${row.phase_number})`
        );
      }
    }

    for (const phase of [1, 2, 3, 4, 5]) {
      const inv = paidPhases.find((p) => Number(p.phase) === phase);
      if (!inv || String(inv.status).toLowerCase() !== 'paid') {
        throw new Error(`Phase ${phase} invoice is not Paid — aborting`);
      }
    }

    console.log('\nPlanned updates:');
    for (const t of TARGETS) {
      const row = before.find((r) => Number(r.classstudent_id) === t.classstudent_id);
      console.log(
        `  CS ${t.classstudent_id} Phase ${t.phase}: ` +
          `${row.program_enrollment_status}` +
          (row.removed_at ? ' (removed)' : '') +
          ` → ${t.status} (removed_at cleared)`
      );
    }

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');
    for (const t of TARGETS) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1,
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL
         WHERE classstudent_id = $2
           AND student_id = $3
           AND class_id = $4
           AND phase_number = $5`,
        [t.status, t.classstudent_id, STUDENT_ID, CLASS_ID, t.phase]
      );
    }
    await client.query('COMMIT');
    console.log('\n✅ Enrollment labels updated.');

    const after = await loadRows(client);
    console.log('\nAFTER classstudent rows:');
    console.table(after);
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
