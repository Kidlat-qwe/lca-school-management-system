/**
 * Jaliyah Callie Almendras — set installment plan phase_start to 2 so the plan
 * begins at class Phase 2 (Phase 1 row hidden from the installment plan table).
 *
 * Scope (--apply):
 *   - installmentinvoiceprofilestbl.phase_start → 2
 *   - program_enrollment_status per class phase: 1=new, 2–4=re_enrolled
 *
 * Attendance: dry-run always previews shifting class-phase 1 → 2 (and cascade)
 * if any rows exist. Use --shift-attendance with --apply to move attendance
 * (optional; not part of the minimal phase_start change).
 *
 * Run:
 *   node backend/scripts/setJaliyahAlmendrasInstallmentPhaseStart2.js
 *   node backend/scripts/setJaliyahAlmendrasInstallmentPhaseStart2.js --dry-run
 *   node backend/scripts/setJaliyahAlmendrasInstallmentPhaseStart2.js --apply
 *   node backend/scripts/setJaliyahAlmendrasInstallmentPhaseStart2.js --apply --shift-attendance
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { resolveProfilePhaseStart } from '../utils/phaseInstallmentUtils.js';

const STUDENT_EMAIL = 'rinadeleon713@gmail.com';
const STUDENT_ID = 353;
const CLASS_ID = 47;
const PROFILE_ID = 150;
const TARGET_PHASE_START = 2;

/** Active enrollment rows: phase 1 = new; phases 2–4 = re_enrolled. */
const TARGET_ENROLLMENT_BY_PHASE = {
  1: 'new',
  2: 're_enrolled',
  3: 're_enrolled',
  4: 're_enrolled',
};

const REPAIR_NOTE = 'Ops repair — Jaliyah Almendras phase_start set to 2';

const args = new Set(process.argv.slice(2));
const isApply = args.has('--apply');
const isDryRun = !isApply || args.has('--dry-run');
const shiftAttendance = args.has('--shift-attendance');

/** Higher phase first so session numbers do not collide. */
const ATTENDANCE_PHASE_SHIFTS = [
  { fromPhase: 3, toPhase: 4 },
  { fromPhase: 2, toPhase: 3 },
  { fromPhase: 1, toPhase: 2 },
];

async function buildPhaseSessionMap(client, classId, phaseNumber) {
  const r = await client.query(
    `SELECT classsession_id, phase_session_number
     FROM classsessionstbl
     WHERE class_id = $1
       AND phase_number = $2
       AND COALESCE(status, 'Scheduled') != 'Cancelled'
     ORDER BY phase_session_number`,
    [classId, phaseNumber]
  );
  const map = new Map();
  for (const row of r.rows) {
    map.set(Number(row.phase_session_number), Number(row.classsession_id));
  }
  return map;
}

async function previewAttendanceShift(client, { studentId, classId, fromPhase, toPhase }) {
  const fromMap = await buildPhaseSessionMap(client, classId, fromPhase);
  const toMap = await buildPhaseSessionMap(client, classId, toPhase);

  const attRows = await client.query(
    `SELECT a.attendance_id, a.classsession_id, a.status, cs.phase_session_number,
            cs.scheduled_date::text AS scheduled_date
     FROM attendancetbl a
     INNER JOIN classsessionstbl cs ON cs.classsession_id = a.classsession_id
     WHERE a.student_id = $1
       AND cs.class_id = $2
       AND cs.phase_number = $3
     ORDER BY cs.phase_session_number`,
    [studentId, classId, fromPhase]
  );

  const moves = [];
  for (const row of attRows.rows) {
    const sessionNum = Number(row.phase_session_number);
    const targetSessionId = toMap.get(sessionNum);
    if (!targetSessionId) {
      moves.push({
        attendance_id: row.attendance_id,
        from_phase: fromPhase,
        to_phase: toPhase,
        phase_session_number: sessionNum,
        scheduled_date: row.scheduled_date,
        note: 'SKIP — no matching target session',
      });
      continue;
    }

    const conflict = await client.query(
      `SELECT attendance_id FROM attendancetbl
       WHERE student_id = $1 AND classsession_id = $2`,
      [studentId, targetSessionId]
    );
    const conflictId = conflict.rows[0]?.attendance_id;
    moves.push({
      attendance_id: row.attendance_id,
      from_phase: fromPhase,
      to_phase: toPhase,
      phase_session_number: sessionNum,
      scheduled_date: row.scheduled_date,
      note:
        conflictId != null && Number(conflictId) !== Number(row.attendance_id)
          ? `CONFLICT with attendance_id ${conflictId}`
          : 'OK',
    });
  }
  return moves;
}

async function applyAttendanceShift(client, { studentId, classId, fromPhase, toPhase }) {
  const moves = await previewAttendanceShift(client, { studentId, classId, fromPhase, toPhase });
  const applied = [];

  for (const move of moves) {
    if (String(move.note || '').startsWith('SKIP') || String(move.note || '').startsWith('CONFLICT')) {
      throw new Error(
        `Cannot shift attendance_id ${move.attendance_id} from phase ${fromPhase}: ${move.note}`
      );
    }

    const toMap = await buildPhaseSessionMap(client, classId, toPhase);
    const targetSessionId = toMap.get(Number(move.phase_session_number));

    await client.query(
      `UPDATE attendancetbl
       SET classsession_id = $1,
           notes = RTRIM(COALESCE(notes, '') || E'\\n[${REPAIR_NOTE}] Moved from class phase ${fromPhase} session ${move.phase_session_number} to phase ${toPhase}.')
       WHERE attendance_id = $2`,
      [targetSessionId, move.attendance_id]
    );
    applied.push(move);
  }

  return applied;
}

async function loadAttendanceSummary(client, studentId, classId) {
  const r = await client.query(
    `SELECT cs.phase_number, COUNT(a.attendance_id)::int AS attendance_rows
     FROM classsessionstbl cs
     INNER JOIN attendancetbl a ON a.classsession_id = cs.classsession_id AND a.student_id = $1
     WHERE cs.class_id = $2
     GROUP BY cs.phase_number
     ORDER BY cs.phase_number`,
    [studentId, classId]
  );
  return r.rows;
}

function describePlanAfterPhaseStart(profile, installmentInvoices) {
  const phaseStart = TARGET_PHASE_START;
  const activeInvoices = installmentInvoices.filter(
    (inv) => !['cancelled', 'canceled'].includes(String(inv.status || '').toLowerCase())
  );

  console.log('\nExpected installment plan display after phase_start = 2:');
  console.log(`  • Plan local slots 1..${profile.total_phases} map to class phases ${phaseStart}..${phaseStart + Number(profile.total_phases) - 1}`);
  console.log('  • Class phase 1 is outside the plan (no row for curriculum phase 1).');
  console.log('  • First visible plan row label: Phase 2');
  console.log('  • Phase 1 enrollment row remains in classstudentstbl but is not shown on the plan grid.');

  const withTarget = activeInvoices
    .filter((inv) => inv.invoice_id !== profile.downpayment_invoice_id)
    .map((inv, idx) => ({
      invoice_id: inv.invoice_id,
      status: inv.status,
      target_phase: parseTargetPhase(inv.remarks),
      billing_order: idx + 1,
    }));

  if (withTarget.length > 0) {
    console.log('\n  Installment invoices (billing order, excluding downpayment):');
    console.table(withTarget);
    console.log(
      '  Note: invoices without TARGET_PHASE stay in billing order on plan slots 1, 2, 3… ' +
        '(first slot displays as Phase 2).'
    );
  }
}

async function main() {
  console.log(
    `\nJaliyah Almendras — set installment phase_start = ${TARGET_PHASE_START}${
      isDryRun ? ' (DRY RUN)' : ' (APPLY)'
    }\n`
  );

  const client = await getClient();
  const changes = [];

  try {
    const userRes = await client.query(
      `SELECT user_id, full_name, email FROM userstbl
       WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
      [STUDENT_EMAIL]
    );
    const student = userRes.rows[0];
    if (!student || Number(student.user_id) !== STUDENT_ID) {
      throw new Error(`Student ${STUDENT_EMAIL} (id ${STUDENT_ID}) not found`);
    }
    console.log('Student:', student);

    const profileRes = await client.query(
      `SELECT ip.*, c.class_name
       FROM installmentinvoiceprofilestbl ip
       LEFT JOIN classestbl c ON c.class_id = ip.class_id
       WHERE ip.installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );
    const profile = profileRes.rows[0];
    if (!profile || Number(profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found for student ${STUDENT_ID}`);
    }
    if (Number(profile.class_id) !== CLASS_ID) {
      throw new Error(`Profile class_id ${profile.class_id} does not match expected ${CLASS_ID}`);
    }

    const currentStart = resolveProfilePhaseStart(profile);
    console.log('\nProfile:', {
      installmentinvoiceprofiles_id: profile.installmentinvoiceprofiles_id,
      class_id: profile.class_id,
      class_name: profile.class_name,
      phase_start: profile.phase_start,
      resolved_phase_start: currentStart,
      total_phases: profile.total_phases,
      generated_count: profile.generated_count,
      downpayment_paid: profile.downpayment_paid,
      is_active: profile.is_active,
    });

    const enrollRows = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status, removed_at,
                TO_CHAR(enrolled_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS enrolled_date
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY phase_number, classstudent_id`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;
    console.log('\nEnrollment rows (class phases):');
    console.table(enrollRows.length ? enrollRows : [{ note: '(none)' }]);

    const invRows = (
      await client.query(
        `SELECT i.invoice_id, i.status, i.invoice_ar_number, i.remarks,
                i.issue_date::text AS issue_date, i.due_date::text AS due_date
         FROM invoicestbl i
         WHERE i.installmentinvoiceprofiles_id = $1
         ORDER BY i.issue_date NULLS LAST, i.invoice_id`,
        [PROFILE_ID]
      )
    ).rows;
    console.log('\nProfile invoices:');
    console.table(invRows);

    const attBefore = await loadAttendanceSummary(client, STUDENT_ID, CLASS_ID);
    console.log('\nAttendance rows by class session phase:');
    console.table(attBefore.length ? attBefore : [{ phase_number: '(none)', attendance_rows: 0 }]);

    const attendancePlans = [];
    for (const shift of ATTENDANCE_PHASE_SHIFTS) {
      const moves = await previewAttendanceShift(client, {
        studentId: STUDENT_ID,
        classId: CLASS_ID,
        fromPhase: shift.fromPhase,
        toPhase: shift.toPhase,
      });
      if (moves.length > 0) {
        attendancePlans.push({ shift, moves });
      }
    }

    if (attendancePlans.length > 0) {
      console.log('\nAttendance shift preview (only if you run --apply --shift-attendance):');
      for (const { shift, moves } of attendancePlans) {
        console.log(`  Phase ${shift.fromPhase} → ${shift.toPhase}: ${moves.length} row(s)`);
        console.table(moves);
      }
    } else {
      console.log('\nAttendance: no rows to shift (student has no attendance on class phases 1–3).');
    }

    describePlanAfterPhaseStart(profile, invRows);

    if (currentStart === TARGET_PHASE_START) {
      console.log(`\nphase_start is already ${TARGET_PHASE_START}.`);
    } else {
      changes.push(
        `installmentinvoiceprofilestbl.phase_start: ${profile.phase_start ?? 'NULL'} → ${TARGET_PHASE_START}`
      );
    }

    const activeEnrollRows = enrollRows.filter((r) => r.removed_at == null);
    for (const [phaseStr, targetStatus] of Object.entries(TARGET_ENROLLMENT_BY_PHASE)) {
      const phase = Number(phaseStr);
      const row = activeEnrollRows.find((r) => Number(r.phase_number) === phase);
      if (!row) {
        changes.push(`MISSING active enrollment row for class phase ${phase} (expected ${targetStatus})`);
        continue;
      }
      const current = String(row.program_enrollment_status || '').trim().toLowerCase();
      if (current !== targetStatus) {
        changes.push(
          `classstudent_id ${row.classstudent_id} phase ${phase}: program_enrollment_status ${row.program_enrollment_status} → ${targetStatus}`
        );
      }
    }

    if (shiftAttendance && attendancePlans.length > 0) {
      changes.push(
        `Shift ${attendancePlans.reduce((n, p) => n + p.moves.filter((m) => m.note === 'OK').length, 0)} attendance row(s) (phases 1→2, 2→3, 3→4)`
      );
    }

    if (changes.length === 0) {
      console.log('\nNo changes to apply.');
      return;
    }

    console.log('\nPlanned changes:');
    changes.forEach((c) => console.log(`  • ${c}`));

    if (isDryRun) {
      console.log('\nRe-run with --apply to write changes.');
      if (attendancePlans.length > 0) {
        console.log('Add --shift-attendance with --apply to move attendance rows as previewed.');
      }
      return;
    }

    await client.query('BEGIN');

    if (currentStart !== TARGET_PHASE_START) {
      await client.query(
        `UPDATE installmentinvoiceprofilestbl
         SET phase_start = $1
         WHERE installmentinvoiceprofiles_id = $2`,
        [TARGET_PHASE_START, PROFILE_ID]
      );
    }

    for (const [phaseStr, targetStatus] of Object.entries(TARGET_ENROLLMENT_BY_PHASE)) {
      const phase = Number(phaseStr);
      const row = activeEnrollRows.find((r) => Number(r.phase_number) === phase);
      if (!row) continue;
      const current = String(row.program_enrollment_status || '').trim().toLowerCase();
      if (current === targetStatus) continue;
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1
         WHERE classstudent_id = $2`,
        [targetStatus, row.classstudent_id]
      );
    }

    if (shiftAttendance) {
      for (const { shift } of attendancePlans) {
        await applyAttendanceShift(client, {
          studentId: STUDENT_ID,
          classId: CLASS_ID,
          fromPhase: shift.fromPhase,
          toPhase: shift.toPhase,
        });
      }
    }

    await client.query('COMMIT');
    console.log('\n✅ Changes applied. Refresh Student History → Invoices to verify.');
    if (!shiftAttendance && attBefore.length > 0) {
      console.log(
        '   Attendance was not moved. Re-run with --apply --shift-attendance if needed.'
      );
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\nFailed:', err.message || err);
    process.exit(1);
  } finally {
    client.release();
  }
}

main().then(() => process.exit(0));
