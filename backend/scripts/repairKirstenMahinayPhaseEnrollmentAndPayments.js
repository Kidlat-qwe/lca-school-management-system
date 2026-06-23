/**
 * Kirsten Celesse J. Mahinay (cherryjaodmd@gmail.com) — realign installment phases
 * by reusing earlier invoice + AR numbers for later phase slots (cascade).
 *
 * Target layout:
 *   Phase 1 — not enrolled (no invoice on this slot)
 *   Phase 2 — INV-311 (was phase 1), no AR, paid (PAY-209); issue 2026-03-25, due 2026-04-05
 *   Phase 3 — INV-571 (was phase 2), AR 260224, paid (PAY-681); issue 2026-04-25, due 2026-05-05
 *   Phase 4 — INV-1012 (was phase 3), AR 260674, unpaid; issue 2026-05-25, due 2026-06-05
 *
 * INV-1511 (old phase 4) is cancelled — superseded by INV-1012 on the phase 4 slot.
 * Payments are NOT moved; only TARGET_PHASE, dates, statuses, enrollment, and cancel orphan.
 *
 * Attendance: rows on class sessions in curriculum phase N are reassigned to the session
 * with the same phase_session_number in phase N+1 (phase 2→3 first, then 1→2) so Student
 * History / class attendance align with enrollment phases 2 and 3.
 *
 * Run:
 *   node backend/scripts/repairKirstenMahinayPhaseEnrollmentAndPayments.js --dry-run
 *   node backend/scripts/repairKirstenMahinayPhaseEnrollmentAndPayments.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { deriveInvoiceStatusForInvoice } from '../utils/invoicePaymentStatus.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'cherryjaodmd@gmail.com';
const STUDENT_ID = 109;
const CLASS_ID = 47;
const PROFILE_ID = 123;

const DOWNPAYMENT_INVOICE_ID = 310;

/** Cascade: profile-local phase slot → physical invoice row */
const PHASE_SLOT_INVOICES = {
  2: { invoice_id: 311, issue_date: '2026-03-25', due_date: '2026-04-05', payment_id: 209 },
  3: { invoice_id: 571, issue_date: '2026-04-25', due_date: '2026-05-05', payment_id: 681 },
  4: { invoice_id: 1012, issue_date: '2026-05-25', due_date: '2026-06-05', payment_id: null },
};

const ORPHAN_INVOICE_ID = 1511;

const PHASE1_ENROLLMENT_ROW_ID = 251;
const PHASE2_ENROLLMENT_ROW_ID = 702;

const REPAIR_NOTE = 'Ops repair 2026-06-18 — Kirsten Mahinay invoice/AR cascade + enrollment';

/** Shift attendance between adjacent class curriculum phases (higher first). */
const ATTENDANCE_PHASE_SHIFTS = [
  { fromPhase: 2, toPhase: 3 },
  { fromPhase: 1, toPhase: 2 },
];

const isDryRun = !process.argv.includes('--apply');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function setRemarksTargetPhase(remarks, absolutePhase) {
  const base = String(remarks || '')
    .replace(/;?\s*TARGET_PHASE:\d+/gi, '')
    .trim();
  const suffix = `TARGET_PHASE:${absolutePhase}`;
  if (!base) return suffix;
  return `${base};${suffix}`;
}

async function sumCompletedSettlement(client, invoiceId) {
  const r = await client.query(
    `SELECT COALESCE(SUM(COALESCE(payable_amount, 0) + COALESCE(discount_amount, 0)), 0) AS total
     FROM paymenttbl
     WHERE invoice_id = $1
       AND status = 'Completed'
       AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
    [invoiceId]
  );
  return parseFloat(r.rows[0]?.total) || 0;
}

async function recomputeInvoiceAmountFromItems(client, invoiceId) {
  const sumResult = await client.query(
    `SELECT
       COALESCE(SUM(amount), 0) AS item_amount,
       COALESCE(SUM(discount_amount), 0) AS total_discount,
       COALESCE(SUM(penalty_amount), 0) AS total_penalty,
       COALESCE(SUM(amount * COALESCE(tax_percentage, 0) / 100), 0) AS total_tax
     FROM invoiceitemstbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const row = sumResult.rows[0];
  return round2(
    (parseFloat(row?.item_amount) || 0) -
      (parseFloat(row?.total_discount) || 0) +
      (parseFloat(row?.total_penalty) || 0) +
      (parseFloat(row?.total_tax) || 0)
  );
}

async function removePenaltyFromInvoice(client, invoiceId) {
  const itemsResult = await client.query(
    `SELECT invoice_item_id FROM invoiceitemstbl
     WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
    [invoiceId]
  );
  for (const item of itemsResult.rows) {
    await client.query(
      `UPDATE invoiceitemstbl SET amount = 0, penalty_amount = 0 WHERE invoice_item_id = $1`,
      [item.invoice_item_id]
    );
  }
  if (itemsResult.rows.length > 0) {
    await client.query(
      `UPDATE invoicestbl SET late_penalty_applied_for_due_date = NULL WHERE invoice_id = $1`,
      [invoiceId]
    );
  }
  return itemsResult.rows.length;
}

async function refreshInvoiceAfterPaymentChange(client, invoiceId) {
  const invRes = await client.query(`SELECT * FROM invoicestbl WHERE invoice_id = $1`, [invoiceId]);
  const invoice = invRes.rows[0];
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  const originalFromItems = await recomputeInvoiceAmountFromItems(client, invoiceId);
  const totalSettled = await sumCompletedSettlement(client, invoiceId);
  const remaining = round2(Math.max(0, originalFromItems - totalSettled));

  const newStatus = await deriveInvoiceStatusForInvoice(client, invoiceId, {
    totalSettled,
    originalInvoiceAmount: originalFromItems,
    previousStatus: invoice.status,
  });

  await client.query(`UPDATE invoicestbl SET amount = $1, status = $2 WHERE invoice_id = $3`, [
    remaining,
    newStatus,
    invoiceId,
  ]);

  await syncProgramPaymentStatusForInvoice(client, invoiceId);

  return {
    invoiceId,
    invoice_ar_number: invoice.invoice_ar_number,
    originalFromItems,
    totalSettled,
    remaining,
    newStatus,
  };
}

async function loadPhaseInvoiceSnapshot(client) {
  const ids = [
    ...Object.values(PHASE_SLOT_INVOICES).map((x) => x.invoice_id),
    ORPHAN_INVOICE_ID,
  ];
  const inv = await client.query(
    `SELECT invoice_id, status, issue_date::text AS issue_date, due_date::text AS due_date,
            invoice_ar_number, remarks
     FROM invoicestbl
     WHERE invoice_id = ANY($1::int[])
     ORDER BY invoice_id`,
    [ids]
  );
  const pays = await client.query(
    `SELECT payment_id, invoice_id, payable_amount, issue_date::text AS payment_date
     FROM paymenttbl
     WHERE payment_id = ANY($1::int[]) OR invoice_id = ANY($2::int[])
     ORDER BY payment_id`,
    [[209, 681], ids]
  );
  return { invoices: inv.rows, payments: pays.rows };
}

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
    `SELECT a.attendance_id, a.classsession_id, a.status, cs.phase_session_number
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
        from_classsession_id: row.classsession_id,
        to_classsession_id: null,
        status: row.status,
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
      from_classsession_id: row.classsession_id,
      to_classsession_id: targetSessionId,
      status: row.status,
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
    if (!move.to_classsession_id || String(move.note || '').startsWith('CONFLICT')) {
      throw new Error(
        `Cannot shift attendance_id ${move.attendance_id} from phase ${fromPhase} session ${move.phase_session_number}: ${move.note}`
      );
    }

    await client.query(
      `UPDATE attendancetbl
       SET classsession_id = $1,
           notes = RTRIM(COALESCE(notes, '') || E'\\n[${REPAIR_NOTE}] Moved from class phase ${fromPhase} session ${move.phase_session_number} to phase ${toPhase}.')
       WHERE attendance_id = $2`,
      [move.to_classsession_id, move.attendance_id]
    );
    applied.push(move);
  }

  return applied;
}

async function loadAttendanceSummary(client) {
  const r = await client.query(
    `SELECT cs.phase_number, COUNT(a.attendance_id)::int AS attendance_rows
     FROM classsessionstbl cs
     INNER JOIN attendancetbl a ON a.classsession_id = cs.classsession_id AND a.student_id = $1
     WHERE cs.class_id = $2
     GROUP BY cs.phase_number
     ORDER BY cs.phase_number`,
    [STUDENT_ID, CLASS_ID]
  );
  return r.rows;
}

function printTargetMapping() {
  console.log('\nTarget phase → invoice / AR mapping:');
  console.table(
    Object.entries(PHASE_SLOT_INVOICES).map(([slot, cfg]) => ({
      phase_slot: Number(slot),
      invoice_id: cfg.invoice_id,
      ar: { 311: '—', 571: '260224', 1012: '260674' }[cfg.invoice_id] || '—',
      payment_id: cfg.payment_id ?? '—',
      issue_date: cfg.issue_date,
      due_date: cfg.due_date,
      enrollment: Number(slot) === 2 ? 'new (paid)' : Number(slot) === 3 ? 're_enrolled (paid)' : 'generated, unpaid',
    }))
  );
  console.log(`Orphan INV-${ORPHAN_INVOICE_ID} (old phase 4) → Cancelled`);
}

async function assertPreconditions(client) {
  const userRes = await client.query(
    `SELECT user_id, full_name, email FROM userstbl
     WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
    [STUDENT_EMAIL]
  );
  if (userRes.rows.length === 0 || Number(userRes.rows[0].user_id) !== STUDENT_ID) {
    throw new Error(`Student ${STUDENT_EMAIL} not found`);
  }

  for (const [slot, cfg] of Object.entries(PHASE_SLOT_INVOICES)) {
    if (!cfg.payment_id) continue;
    const pay = await client.query(`SELECT payment_id, invoice_id, student_id FROM paymenttbl WHERE payment_id = $1`, [
      cfg.payment_id,
    ]);
    if (Number(pay.rows[0]?.invoice_id) !== cfg.invoice_id) {
      throw new Error(
        `Payment ${cfg.payment_id} must stay on INV-${cfg.invoice_id} (phase ${slot}); found INV-${pay.rows[0]?.invoice_id}`
      );
    }
    if (Number(pay.rows[0]?.student_id) !== STUDENT_ID) {
      throw new Error(`Payment ${cfg.payment_id} must belong to student ${STUDENT_ID}`);
    }
  }

  return userRes.rows[0];
}

async function main() {
  console.log(
    `\nRepair Kirsten Mahinay — invoice/AR cascade + enrollment${isDryRun ? ' (DRY RUN)' : ' (APPLY)'}\n`
  );
  printTargetMapping();

  const client = await getClient();
  try {
    const student = await assertPreconditions(client);
    console.log('\nStudent:', student);

    const before = await loadPhaseInvoiceSnapshot(client);
    console.log('\nBefore — cascade invoices:');
    console.table(before.invoices);
    console.log('Before — payments:');
    console.table(before.payments);

    const beforeAtt = await loadAttendanceSummary(client);
    console.log('\nBefore — attendance rows by class session phase:');
    console.table(beforeAtt.length ? beforeAtt : [{ phase_number: '(none)', attendance_rows: 0 }]);

    const attendancePlans = [];
    for (const shift of ATTENDANCE_PHASE_SHIFTS) {
      const moves = await previewAttendanceShift(client, {
        studentId: STUDENT_ID,
        classId: CLASS_ID,
        fromPhase: shift.fromPhase,
        toPhase: shift.toPhase,
      });
      attendancePlans.push({ shift, moves });
    }

    console.log('\nAttendance shift plan (matched by phase_session_number):');
    for (const { shift, moves } of attendancePlans) {
      console.log(`  Phase ${shift.fromPhase} → ${shift.toPhase}: ${moves.length} row(s)`);
      if (moves.length > 0) console.table(moves);
    }

    if (isDryRun) {
      console.log('\nWould:');
      for (const [slot, cfg] of Object.entries(PHASE_SLOT_INVOICES)) {
        console.log(
          `  • Phase ${slot}: INV-${cfg.invoice_id} — set TARGET_PHASE:${slot}, issue ${cfg.issue_date}, due ${cfg.due_date}`
        );
      }
      console.log(`  • Cancel INV-${ORPHAN_INVOICE_ID}`);
      console.log(`  • Refresh statuses for INV-311, 571, 1012, 1511`);
      console.log(`  • Soft-remove phase 1 enrollment (classstudent_id ${PHASE1_ENROLLMENT_ROW_ID})`);
      console.log(`  • Phase 2 enrollment: new (classstudent_id ${PHASE2_ENROLLMENT_ROW_ID})`);
      console.log('  • Phase 3 enrollment: re_enrolled (insert if missing)');
      for (const { shift, moves } of attendancePlans) {
        console.log(
          `  • Move ${moves.filter((m) => m.note === 'OK').length} attendance row(s): class phase ${shift.fromPhase} → ${shift.toPhase}`
        );
      }
      console.log('\nDry run complete. Re-run with --apply to write changes.');
      return;
    }

    await client.query('BEGIN');

    for (const [slot, cfg] of Object.entries(PHASE_SLOT_INVOICES)) {
      const cur = await client.query(`SELECT remarks FROM invoicestbl WHERE invoice_id = $1`, [cfg.invoice_id]);
      const nextRemarks = setRemarksTargetPhase(cur.rows[0]?.remarks, Number(slot));
      await client.query(
        `UPDATE invoicestbl
         SET issue_date = $1::date,
             due_date = $2::date,
             remarks = $3
         WHERE invoice_id = $4
           AND installmentinvoiceprofiles_id = $5`,
        [cfg.issue_date, cfg.due_date, nextRemarks, cfg.invoice_id, PROFILE_ID]
      );
    }

    await client.query(
      `UPDATE invoicestbl
       SET status = 'Cancelled',
           remarks = REGEXP_REPLACE(
             COALESCE(remarks, '') || '; ${REPAIR_NOTE} — superseded by INV-1012 on phase 4 slot',
             ';?TARGET_PHASE:\\d+',
             '',
             'g'
           ),
           installmentinvoiceprofiles_id = NULL
       WHERE invoice_id = $1
         AND installmentinvoiceprofiles_id = $2`,
      [ORPHAN_INVOICE_ID, PROFILE_ID]
    );

    const refreshResults = [];
    for (const invoiceId of [
      PHASE_SLOT_INVOICES[2].invoice_id,
      PHASE_SLOT_INVOICES[3].invoice_id,
      PHASE_SLOT_INVOICES[4].invoice_id,
      ORPHAN_INVOICE_ID,
    ]) {
      refreshResults.push(await refreshInvoiceAfterPaymentChange(client, invoiceId));
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = $1
       WHERE installmentinvoiceprofiles_id = $2`,
      [3, PROFILE_ID]
    );

    const pay209Date = (
      await client.query(`SELECT issue_date FROM paymenttbl WHERE payment_id = $1`, [209])
    ).rows[0]?.issue_date;
    const pay681Date = (
      await client.query(`SELECT issue_date FROM paymenttbl WHERE payment_id = $1`, [681])
    ).rows[0]?.issue_date;

    await client.query(
      `UPDATE classstudentstbl
       SET removed_at = CURRENT_TIMESTAMP,
           removed_reason = $1,
           removed_by = 'System'
       WHERE classstudent_id = $2 AND student_id = $3 AND class_id = $4 AND removed_at IS NULL`,
      [REPAIR_NOTE, PHASE1_ENROLLMENT_ROW_ID, STUDENT_ID, CLASS_ID]
    );

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'new',
           enrolled_by = $1,
           enrolled_at = COALESCE($2::timestamp, enrolled_at)
       WHERE classstudent_id = $3 AND student_id = $4 AND class_id = $5 AND removed_at IS NULL`,
      [`System (${REPAIR_NOTE})`, pay209Date, PHASE2_ENROLLMENT_ROW_ID, STUDENT_ID, CLASS_ID]
    );

    const phase3Existing = await client.query(
      `SELECT classstudent_id FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = 3 AND removed_at IS NULL`,
      [STUDENT_ID, CLASS_ID]
    );

    if (phase3Existing.rows.length === 0) {
      await client.query(
        `INSERT INTO classstudentstbl
           (student_id, class_id, enrolled_by, phase_number, program_enrollment_status, enrolled_at)
         VALUES ($1, $2, $3, 3, 're_enrolled', COALESCE($4::timestamp, CURRENT_TIMESTAMP))`,
        [STUDENT_ID, CLASS_ID, `System (${REPAIR_NOTE})`, pay681Date]
      );
    } else {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 're_enrolled',
             enrolled_by = $1,
             enrolled_at = COALESCE($2::timestamp, enrolled_at)
         WHERE classstudent_id = $3`,
        [`System (${REPAIR_NOTE})`, pay681Date, phase3Existing.rows[0].classstudent_id]
      );
    }

    const attendanceApplied = [];
    for (const shift of ATTENDANCE_PHASE_SHIFTS) {
      const applied = await applyAttendanceShift(client, {
        studentId: STUDENT_ID,
        classId: CLASS_ID,
        fromPhase: shift.fromPhase,
        toPhase: shift.toPhase,
      });
      attendanceApplied.push({ shift, applied });
    }

    await client.query('COMMIT');

    const after = await loadPhaseInvoiceSnapshot(client);
    const enrollAfter = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status, enrolled_at::text, removed_at::text
       FROM classstudentstbl WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number, classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    );

    console.log('\n✅ Committed.');
    console.log('\nInvoice refresh:');
    console.table(refreshResults);
    console.log('\nAttendance shifts applied:');
    for (const { shift, applied } of attendanceApplied) {
      console.log(`  Phase ${shift.fromPhase} → ${shift.toPhase}: ${applied.length} row(s)`);
      if (applied.length > 0) console.table(applied);
    }
    const afterAtt = await loadAttendanceSummary(client);
    console.log('\nAfter — attendance rows by class session phase:');
    console.table(afterAtt.length ? afterAtt : [{ phase_number: '(none)', attendance_rows: 0 }]);
    console.log('\nAfter — cascade invoices:');
    console.table(after.invoices);
    console.log('\nAfter — enrollments:');
    console.table(enrollAfter.rows);
    printTargetMapping();
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
