/**
 * JOHNZEL MAURU G. DE JESUS (jezreelgarcia09@gmail.com, user 75) —
 * fix enrollment labels after Phase 2 drop so Month Re-enrollment matches:
 *   May = rejoin, June = re_enrolled, July = re_enrolled
 *
 * Production · class 50 SOMO_Playgroup_SS_11:00-12:00PM · profile 49
 *
 * Current gap: no Phase 3 classstudent row (May blank). Phases 4–5 are rejoin.
 *
 * Desired:
 *   INSERT Phase 3 → rejoin @ 2026-05-04 (INV 615 paid)
 *   CS 1085 Phase 4 → re_enrolled
 *   CS 1478 Phase 5 → re_enrolled
 *   Phase 1 new / Phase 2 dropped / Phase 6–7 re_enrolled unchanged
 *
 * Run (from backend/):
 *   node scripts/repairJohnzelDeJesusEnrollmentMayJunJul.js --production
 *   node scripts/repairJohnzelDeJesusEnrollmentMayJunJul.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const STUDENT_ID = 75;
const STUDENT_EMAIL = 'jezreelgarcia09@gmail.com';
const CLASS_ID = 50;
const PROFILE_ID = 49;

const PHASE3_INVOICE_ID = 615;
const PHASE4_CS_ID = 1085;
const PHASE5_CS_ID = 1478;
const PHASE3_ENROLLED_AT = '2026-05-04 12:00:00';

const REPAIR_NOTE =
  'Ops — Johnzel De Jesus: insert P3 rejoin (May); P4/P5 rejoin→re_enrolled (Jun/Jul)';

const isApply = process.argv.includes('--apply');

async function loadRows(client) {
  const res = await client.query(
    `SELECT classstudent_id, phase_number, program_enrollment_status,
            TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled_ymd,
            removed_at, removed_reason
     FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2
     ORDER BY COALESCE(phase_number, 0), classstudent_id`,
    [STUDENT_ID, CLASS_ID]
  );
  return res.rows;
}

async function main() {
  console.log(
    `\nJohnzel De Jesus — May rejoin / Jun–Jul re_enrolled${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );
  console.log(`Note: ${REPAIR_NOTE}\n`);

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

    const inv3 = (
      await client.query(
        `SELECT invoice_id, status,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd
         FROM invoicestbl
         WHERE invoice_id = $1 AND installmentinvoiceprofiles_id = $2`,
        [PHASE3_INVOICE_ID, PROFILE_ID]
      )
    ).rows[0];
    if (!inv3) throw new Error(`Invoice ${PHASE3_INVOICE_ID} not found on profile ${PROFILE_ID}`);
    if (String(inv3.status).toLowerCase() !== 'paid') {
      throw new Error(`Phase 3 invoice ${PHASE3_INVOICE_ID} is not Paid`);
    }

    const before = await loadRows(client);
    console.log('Student:', user);
    console.log('Phase 3 invoice:', inv3);
    console.log('\nBEFORE classstudent rows:');
    console.table(before);

    const existingP3 = before.find((r) => Number(r.phase_number) === 3);
    const p4 = before.find((r) => Number(r.classstudent_id) === PHASE4_CS_ID);
    const p5 = before.find((r) => Number(r.classstudent_id) === PHASE5_CS_ID);

    if (!p4 || Number(p4.phase_number) !== 4) {
      throw new Error(`Phase 4 CS ${PHASE4_CS_ID} missing/mismatch`);
    }
    if (!p5 || Number(p5.phase_number) !== 5) {
      throw new Error(`Phase 5 CS ${PHASE5_CS_ID} missing/mismatch`);
    }

    console.log('\nPlanned:');
    if (existingP3) {
      console.log(
        `  1. Phase 3 CS ${existingP3.classstudent_id}: ${existingP3.program_enrollment_status} → rejoin (update)`
      );
    } else {
      console.log(
        `  1. INSERT Phase 3 rejoin @ ${PHASE3_ENROLLED_AT} (May matrix = rejoin)`
      );
    }
    console.log(
      `  2. CS ${PHASE4_CS_ID} Phase 4: ${p4.program_enrollment_status} → re_enrolled (June)`
    );
    console.log(
      `  3. CS ${PHASE5_CS_ID} Phase 5: ${p5.program_enrollment_status} → re_enrolled (July)`
    );

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    if (existingP3) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 'rejoin',
             enrolled_at = COALESCE(enrolled_at, TIMEZONE('Asia/Manila', $1::timestamp)),
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL
         WHERE classstudent_id = $2
           AND student_id = $3
           AND class_id = $4
           AND phase_number = 3`,
        [PHASE3_ENROLLED_AT, existingP3.classstudent_id, STUDENT_ID, CLASS_ID]
      );
    } else {
      await client.query(
        `INSERT INTO classstudentstbl
           (student_id, class_id, enrolled_by, phase_number,
            program_enrollment_status, enrolled_at)
         VALUES ($1, $2, $3, 3, 'rejoin', TIMEZONE('Asia/Manila', $4::timestamp))`,
        [
          STUDENT_ID,
          CLASS_ID,
          'System (Ops repair — Phase 3 rejoin after drop)',
          PHASE3_ENROLLED_AT,
        ]
      );
    }

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 're_enrolled',
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL
       WHERE classstudent_id = $1
         AND student_id = $2
         AND class_id = $3
         AND phase_number = 4`,
      [PHASE4_CS_ID, STUDENT_ID, CLASS_ID]
    );

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 're_enrolled',
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL
       WHERE classstudent_id = $1
         AND student_id = $2
         AND class_id = $3
         AND phase_number = 5`,
      [PHASE5_CS_ID, STUDENT_ID, CLASS_ID]
    );

    // Tag Phase 3 invoice for clearer Student History phase mapping
    await client.query(
      `UPDATE invoicestbl
       SET remarks = CASE
             WHEN remarks ILIKE '%TARGET_PHASE:3%' THEN remarks
             ELSE TRIM(BOTH ';' FROM COALESCE(remarks, '')) || ';TARGET_PHASE:3'
           END
           || CASE
                WHEN remarks ILIKE $2 THEN ''
                ELSE ';' || $1
              END
       WHERE invoice_id = $3`,
      [REPAIR_NOTE, `%${REPAIR_NOTE}%`, PHASE3_INVOICE_ID]
    );

    await client.query('COMMIT');
    console.log('\n✅ Applied.');

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
