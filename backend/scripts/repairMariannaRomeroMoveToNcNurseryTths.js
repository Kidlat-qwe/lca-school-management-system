/**
 * Marianna Agatha Romero — move from NC Nursery MWF 11:00 to TThS 11:00.
 *
 * Student: 560 · amgromero1987@gmail.com · Branch NC Guiguinto (5)
 * From: class 56 NC_Nursery_MWF_11:00-12:00PM
 * To:   class 55 NC_NURSERY_TThS_11:00-12:00PM
 *
 * Why a script (not UI Move Student):
 *   Profile 400 is inactive (delinquency). POST /classes/move-student only
 *   updates installment profiles with is_active = true, so billing would stay
 *   on class 56 even if enrollments moved.
 *
 * Scope (--apply):
 *   1. Move ALL class 56 classstudent rows to class 55 (phase + status kept)
 *      - 1208 phase 4 new
 *      - 1753 phase 5 re_enrolled
 *      - 2099 phase 6 dropped (delinquency history follows the student)
 *   2. Profile 400 class_id 56 → 55 (leave is_active = false)
 *   3. Retag invoice remarks CLASS_ID:56 → CLASS_ID:55
 *
 * Does NOT: reactivate the profile, change unpaid invoices, payments,
 *           attendance (none), or rebuild installment dates.
 *
 * Run:
 *   node backend/scripts/repairMariannaRomeroMoveToNcNurseryTths.js --production
 *   node backend/scripts/repairMariannaRomeroMoveToNcNurseryTths.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const STUDENT_ID = 560;
const STUDENT_EMAIL = 'amgromero1987@gmail.com';
const PROFILE_ID = 400;
const FROM_CLASS_ID = 56;
const TO_CLASS_ID = 55;
const FROM_CLASS_NAME = 'NC_Nursery_MWF_11:00-12:00PM';
const TO_CLASS_NAME = 'NC_NURSERY_TThS_11:00-12:00PM';

const EXPECTED_ROWS = [
  { classstudent_id: 1208, phase_number: 4, program_enrollment_status: 'new' },
  { classstudent_id: 1753, phase_number: 5, program_enrollment_status: 're_enrolled' },
  { classstudent_id: 2099, phase_number: 6, program_enrollment_status: 'dropped' },
];

const REPAIR_NOTE =
  'Ops repair 2026-08-12 — Marianna Romero move NC_Nursery_MWF 11:00 (56) → NC_NURSERY_TThS 11:00 (55)';

const isApply = process.argv.includes('--apply');

async function loadEnrollments(client, studentId) {
  const r = await client.query(
    `SELECT cs.classstudent_id, cs.class_id, c.class_name, cs.phase_number,
            cs.program_enrollment_status,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM-DD HH24:MI') AS removed
     FROM classstudentstbl cs
     LEFT JOIN classestbl c ON c.class_id = cs.class_id
     WHERE cs.student_id = $1
     ORDER BY cs.class_id, cs.phase_number, cs.classstudent_id`,
    [studentId]
  );
  return r.rows;
}

async function loadProfile(client) {
  const r = await client.query(
    `SELECT ip.installmentinvoiceprofiles_id AS profile_id, ip.student_id,
            ip.class_id, c.class_name, ip.is_active, ip.phase_start,
            ip.total_phases, ip.generated_count
     FROM installmentinvoiceprofilestbl ip
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     WHERE ip.installmentinvoiceprofiles_id = $1`,
    [PROFILE_ID]
  );
  return r.rows[0] || null;
}

async function loadClassTaggedInvoices(client, studentId, classId) {
  const r = await client.query(
    `SELECT i.invoice_id, i.status, i.amount,
            i.installmentinvoiceprofiles_id AS profile_id,
            LEFT(COALESCE(i.remarks, ''), 160) AS remarks
     FROM invoicestbl i
     JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
     WHERE ist.student_id = $1
       AND i.remarks ILIKE '%' || $2 || '%'
     ORDER BY i.invoice_id`,
    [studentId, `CLASS_ID:${classId}`]
  );
  return r.rows;
}

async function loadTargetHeadcount(client, classId) {
  const r = await client.query(
    `SELECT COUNT(DISTINCT student_id)::int AS n
     FROM classstudentstbl
     WHERE class_id = $1
       AND removed_at IS NULL
       AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')`,
    [classId]
  );
  return r.rows[0]?.n ?? 0;
}

async function main() {
  console.log(
    `\nMarianna Romero — move MWF 11:00 → TThS 11:00` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email, branch_id
         FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error('Student not found');
    console.log('Student:', student.full_name, student.email, `branch ${student.branch_id}`);

    const fromClass = (
      await client.query(
        `SELECT class_id, class_name, status, branch_id, program_id, max_students
         FROM classestbl WHERE class_id = $1`,
        [FROM_CLASS_ID]
      )
    ).rows[0];
    const toClass = (
      await client.query(
        `SELECT class_id, class_name, status, branch_id, program_id, max_students
         FROM classestbl WHERE class_id = $1`,
        [TO_CLASS_ID]
      )
    ).rows[0];

    if (!fromClass || fromClass.class_name !== FROM_CLASS_NAME) {
      throw new Error(
        `Source class ${FROM_CLASS_ID} name mismatch: ${fromClass?.class_name}`
      );
    }
    if (!toClass || toClass.class_name !== TO_CLASS_NAME) {
      throw new Error(
        `Target class ${TO_CLASS_ID} name mismatch: ${toClass?.class_name}`
      );
    }
    if (Number(fromClass.program_id) !== Number(toClass.program_id)) {
      throw new Error('Source and target program_id differ');
    }
    if (Number(fromClass.branch_id) !== Number(toClass.branch_id)) {
      throw new Error('Source and target branch_id differ');
    }
    if (toClass.status !== 'Active') {
      throw new Error(`Target class is ${toClass.status}, expected Active`);
    }

    const profile = await loadProfile(client);
    if (!profile || Number(profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found for student`);
    }
    if (Number(profile.class_id) !== FROM_CLASS_ID) {
      throw new Error(
        `Profile ${PROFILE_ID} class_id=${profile.class_id}, expected ${FROM_CLASS_ID}`
      );
    }

    const enrollments = await loadEnrollments(client, STUDENT_ID);
    const fromRows = enrollments.filter((r) => Number(r.class_id) === FROM_CLASS_ID);
    const toRows = enrollments.filter((r) => Number(r.class_id) === TO_CLASS_ID);

    if (toRows.length > 0) {
      throw new Error(
        `Student already has classstudent rows on target class ${TO_CLASS_ID}`
      );
    }

    for (const expected of EXPECTED_ROWS) {
      const found = fromRows.find(
        (r) => Number(r.classstudent_id) === expected.classstudent_id
      );
      if (!found) {
        throw new Error(`Missing classstudent ${expected.classstudent_id} on class ${FROM_CLASS_ID}`);
      }
      if (Number(found.phase_number) !== expected.phase_number) {
        throw new Error(
          `classstudent ${expected.classstudent_id} phase ${found.phase_number}, expected ${expected.phase_number}`
        );
      }
      if (found.program_enrollment_status !== expected.program_enrollment_status) {
        throw new Error(
          `classstudent ${expected.classstudent_id} status ${found.program_enrollment_status}, expected ${expected.program_enrollment_status}`
        );
      }
    }
    if (fromRows.length !== EXPECTED_ROWS.length) {
      throw new Error(
        `Expected ${EXPECTED_ROWS.length} class 56 rows, found ${fromRows.length}`
      );
    }

    const taggedInvoices = await loadClassTaggedInvoices(
      client,
      STUDENT_ID,
      FROM_CLASS_ID
    );
    const targetHeadcount = await loadTargetHeadcount(client, TO_CLASS_ID);
    const maxStudents = toClass.max_students != null ? Number(toClass.max_students) : null;
    if (maxStudents != null && targetHeadcount + 1 > maxStudents) {
      throw new Error(
        `Target class is full (${targetHeadcount}/${maxStudents})`
      );
    }

    console.log('\nSource:', fromClass.class_id, fromClass.class_name, fromClass.status);
    console.log('Target:', toClass.class_id, toClass.class_name, toClass.status);
    console.log(`Target headcount: ${targetHeadcount} / ${maxStudents ?? '∞'} (room for 1)`);
    console.log('Profile BEFORE:', profile);

    console.log('\nEnrollments BEFORE:');
    console.table(enrollments);

    console.log('\nInvoices with CLASS_ID:56:');
    console.table(taggedInvoices.length ? taggedInvoices : [{ note: '(none)' }]);

    console.log('\nPlanned:');
    console.log(
      `  1. classstudent ${EXPECTED_ROWS.map((r) => r.classstudent_id).join(', ')} class_id ${FROM_CLASS_ID} → ${TO_CLASS_ID} (phase/status unchanged)`
    );
    console.log(
      `  2. Profile ${PROFILE_ID} class_id ${FROM_CLASS_ID} → ${TO_CLASS_ID} (keep is_active=${profile.is_active})`
    );
    console.log(
      taggedInvoices.length
        ? `  3. Retag CLASS_ID:${FROM_CLASS_ID} → CLASS_ID:${TO_CLASS_ID} on INV ${taggedInvoices.map((i) => i.invoice_id).join(', ')}`
        : `  3. No invoices with CLASS_ID:${FROM_CLASS_ID} to retag`
    );
    console.log('  Leave unpaid INV-1953 (phase 6) / INV-2153 (phase 7) unchanged.');
    console.log('  Leave profile inactive (delinquency). Not reactivating.');

    if (!isApply) {
      console.log('\nDry run only — no writes. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    const moved = await client.query(
      `UPDATE classstudentstbl
       SET class_id = $1
       WHERE student_id = $2
         AND class_id = $3
         AND classstudent_id = ANY($4::int[])
       RETURNING classstudent_id, phase_number, program_enrollment_status`,
      [
        TO_CLASS_ID,
        STUDENT_ID,
        FROM_CLASS_ID,
        EXPECTED_ROWS.map((r) => r.classstudent_id),
      ]
    );
    if (moved.rows.length !== EXPECTED_ROWS.length) {
      throw new Error(
        `Expected to move ${EXPECTED_ROWS.length} enrollments, moved ${moved.rows.length}`
      );
    }
    console.log('✅ Moved enrollments:');
    console.table(moved.rows);

    const profUpd = await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET class_id = $1
       WHERE installmentinvoiceprofiles_id = $2
         AND student_id = $3
         AND class_id = $4
       RETURNING installmentinvoiceprofiles_id, class_id, is_active`,
      [TO_CLASS_ID, PROFILE_ID, STUDENT_ID, FROM_CLASS_ID]
    );
    if (!profUpd.rows.length) {
      throw new Error(`Failed to update profile ${PROFILE_ID}`);
    }
    console.log('✅ Profile:', profUpd.rows[0]);

    if (taggedInvoices.length) {
      const invUpd = await client.query(
        `UPDATE invoicestbl i
         SET remarks = regexp_replace(COALESCE(i.remarks, ''), 'CLASS_ID:\\d+', 'CLASS_ID:' || $1)
         FROM invoicestudentstbl ist
         WHERE ist.invoice_id = i.invoice_id
           AND ist.student_id = $2
           AND i.remarks ILIKE '%' || $3 || '%'
         RETURNING i.invoice_id`,
        [String(TO_CLASS_ID), STUDENT_ID, `CLASS_ID:${FROM_CLASS_ID}`]
      );
      console.log(
        `✅ Retagged CLASS_ID on INV ${invUpd.rows.map((r) => r.invoice_id).join(', ')}`
      );
    }

    await client.query('COMMIT');

    console.log('\nEnrollments AFTER:');
    console.table(await loadEnrollments(client, STUDENT_ID));
    console.log('Profile AFTER:', await loadProfile(client));
    console.log('Invoices with CLASS_ID:55:');
    console.table(await loadClassTaggedInvoices(client, STUDENT_ID, TO_CLASS_ID));
    console.log('\n✅ Apply complete. Refresh Classes / Student history.');
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
