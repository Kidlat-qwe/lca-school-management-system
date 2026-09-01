/**
 * CHLOE SOFIA M. EVANGELISTA — shift enrollment/billing start Phase 4 → Phase 3.
 *
 * Student: 270 · jhec292000@yahoo.com
 * Profile: 448 · class 53 VMP_NURSERY_TThS_11:00 AM · Nursery Installment Plan 3
 *
 * Today:
 *   phase_start 4 · generated_count 4 · total_phases 7
 *   Enrollments: P4 new, P5–P7 re_enrolled (CS 1306–1309)
 *   INV-1533 Paid (PHASE_START:4, first phase / AR 261198)
 *   INV-1534/1535 Phase 5 · INV-1536 Phase 6 · INV-1537 Phase 7
 *   INV-1538/1539 Phase 8 Partially Paid
 *
 * Target:
 *   phase_start 3
 *   Enrollments: P3 new, P4–P6 re_enrolled (phases 3–6 only)
 *   Invoices: shift TARGET_PHASE / PHASE_START down by 1 (4→3 … 8→7)
 *
 * Run:
 *   node backend/scripts/repairChloeEvangelistaShiftPhase4To3.js
 *   node backend/scripts/repairChloeEvangelistaShiftPhase4To3.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 270;
const STUDENT_EMAIL = 'jhec292000@yahoo.com';
const PROFILE_ID = 448;
const CLASS_ID = 53;
const CLASS_NAME = 'VMP_NURSERY_TThS_11:00 AM';

const REPAIR_NOTE =
  'Ops repair 2026-08-28 — Chloe Evangelista shift P4–7 enroll → P3–6; invoice phases −1';

const isApply = process.argv.includes('--apply');

/** @type {Array<{ invoiceId: number, fromPhase: number, toPhase: number, rewritePhaseStart?: boolean }>} */
const INVOICE_SHIFTS = [
  { invoiceId: 1538, fromPhase: 8, toPhase: 7 },
  { invoiceId: 1539, fromPhase: 8, toPhase: 7 },
  { invoiceId: 1537, fromPhase: 7, toPhase: 6 },
  { invoiceId: 1536, fromPhase: 6, toPhase: 5 },
  { invoiceId: 1535, fromPhase: 5, toPhase: 4 },
  { invoiceId: 1534, fromPhase: 5, toPhase: 4 },
  { invoiceId: 1533, fromPhase: 4, toPhase: 3, rewritePhaseStart: true },
];

/** @type {Array<{ classstudentId: number, fromPhase: number, toPhase: number, enrollmentStatus: string }>} */
const ENROLLMENT_SHIFTS = [
  { classstudentId: 1309, fromPhase: 7, toPhase: 6, enrollmentStatus: 're_enrolled' },
  { classstudentId: 1308, fromPhase: 6, toPhase: 5, enrollmentStatus: 're_enrolled' },
  { classstudentId: 1307, fromPhase: 5, toPhase: 4, enrollmentStatus: 're_enrolled' },
  { classstudentId: 1306, fromPhase: 4, toPhase: 3, enrollmentStatus: 'new' },
];

function rewritePhaseStartInRemarks(remarks, phase) {
  const text = String(remarks || '');
  if (/PHASE_START:\d+/i.test(text)) {
    return text.replace(/PHASE_START:\d+/i, `PHASE_START:${phase}`);
  }
  return text;
}

function rewriteAdvancePaymentLabel(remarks, absolutePhase) {
  let next = String(remarks || '');
  if (/Advance payment\s*[—\-]\s*Phase\s*\d+/i.test(next)) {
    next = next.replace(
      /Advance payment\s*[—\-]\s*Phase\s*\d+/i,
      `Advance payment — Phase ${absolutePhase}`
    );
  }
  return next;
}

function appendRepairNote(remarks) {
  const text = String(remarks || '');
  if (text.includes(REPAIR_NOTE)) return text;
  return text ? `${text};${REPAIR_NOTE}` : REPAIR_NOTE;
}

async function loadInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_id, status, amount, invoice_ar_number, remarks,
            installmentinvoiceprofiles_id AS profile_id,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
            TO_CHAR(due_date, 'YYYY-MM-DD') AS due
     FROM invoicestbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const row = r.rows[0] || null;
  if (row) row.phase = parseTargetPhase(row.remarks);
  return row;
}

async function loadProfile(client) {
  const r = await client.query(
    `SELECT ip.installmentinvoiceprofiles_id AS profile_id, ip.student_id,
            ip.class_id, c.class_name, ip.phase_start, ip.generated_count, ip.total_phases,
            TO_CHAR(ii.next_generation_date, 'YYYY-MM-DD') AS next_gen,
            TO_CHAR(ii.next_invoice_month, 'YYYY-MM-DD') AS next_month,
            TO_CHAR(ii.scheduled_date, 'YYYY-MM-DD') AS scheduled
     FROM installmentinvoiceprofilestbl ip
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     LEFT JOIN installmentinvoicestbl ii
       ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
     WHERE ip.installmentinvoiceprofiles_id = $1 AND ip.student_id = $2`,
    [PROFILE_ID, STUDENT_ID]
  );
  return r.rows[0] || null;
}

async function loadEnrollments(client) {
  const r = await client.query(
    `SELECT cs.classstudent_id, cs.phase_number,
            cs.program_enrollment_status AS status,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD') AS enrolled
     FROM classstudentstbl cs
     WHERE cs.student_id = $1 AND cs.class_id = $2 AND cs.removed_at IS NULL
     ORDER BY cs.phase_number, cs.classstudent_id`,
    [STUDENT_ID, CLASS_ID]
  );
  return r.rows;
}

async function loadProfileInvoices(client) {
  const r = await client.query(
    `SELECT invoice_id, status, invoice_ar_number,
            SUBSTRING(remarks FROM 'TARGET_PHASE:([0-9]+)') AS target_phase,
            SUBSTRING(remarks FROM 'PHASE_START:([0-9]+)') AS phase_start_remark,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
            TO_CHAR(due_date, 'YYYY-MM-DD') AS due
     FROM invoicestbl
     WHERE installmentinvoiceprofiles_id = $1
       AND COALESCE(status, '') NOT IN ('Cancelled', 'Canceled')
     ORDER BY invoice_id`,
    [PROFILE_ID]
  );
  return r.rows;
}

function assertInvoicePhase(inv, cfg) {
  const phase = inv.phase ?? parseTargetPhase(inv.remarks);
  const ok =
    phase === cfg.fromPhase ||
    phase === cfg.toPhase ||
    (cfg.rewritePhaseStart && /PHASE_START:4/i.test(String(inv.remarks || '')));
  if (!ok) {
    throw new Error(
      `INV-${cfg.invoiceId} phase ${phase}, expected ${cfg.fromPhase} or ${cfg.toPhase}`
    );
  }
}

async function main() {
  console.log(
    `\nChloe Evangelista — shift Phase 4 start → Phase 3 (enroll P3–P6)` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

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
    if (!student) throw new Error('Student not found or email mismatch');
    console.log('Student:', student.full_name, student.email, `(id ${student.user_id})`);

    const klass = (
      await client.query(
        `SELECT class_id, class_name FROM classestbl WHERE class_id = $1`,
        [CLASS_ID]
      )
    ).rows[0];
    if (!klass || klass.class_name !== CLASS_NAME) {
      throw new Error(`Class ${CLASS_ID} mismatch: ${klass?.class_name}`);
    }

    const profile = await loadProfile(client);
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);
    if (Number(profile.class_id) !== CLASS_ID) {
      throw new Error(`Profile class_id ${profile.class_id} ≠ ${CLASS_ID}`);
    }
    if (Number(profile.phase_start) !== 4 && Number(profile.phase_start) !== 3) {
      throw new Error(`phase_start=${profile.phase_start}, expected 4 (or 3 if already repaired)`);
    }
    console.log('\nProfile BEFORE:', profile);

    const beforeCs = await loadEnrollments(client);
    console.log('\nBEFORE enrollments:');
    console.table(beforeCs);

    const beforeInv = await loadProfileInvoices(client);
    console.log('\nBEFORE profile invoices:');
    console.table(beforeInv);

    for (const cfg of INVOICE_SHIFTS) {
      const inv = await loadInvoice(client, cfg.invoiceId);
      if (!inv || Number(inv.profile_id) !== PROFILE_ID) {
        throw new Error(`INV-${cfg.invoiceId} not on profile ${PROFILE_ID}`);
      }
      assertInvoicePhase(inv, cfg);
    }

    for (const cfg of ENROLLMENT_SHIFTS) {
      const cs = beforeCs.find((r) => Number(r.classstudent_id) === cfg.classstudentId);
      if (!cs) throw new Error(`CS ${cfg.classstudentId} not found`);
      if (Number(cs.phase_number) !== cfg.fromPhase && Number(cs.phase_number) !== cfg.toPhase) {
        throw new Error(
          `CS ${cfg.classstudentId} phase ${cs.phase_number}, expected ${cfg.fromPhase} or ${cfg.toPhase}`
        );
      }
      if (String(cs.status) !== cfg.enrollmentStatus) {
        throw new Error(
          `CS ${cfg.classstudentId} status ${cs.status}, expected ${cfg.enrollmentStatus}`
        );
      }
    }

    console.log('\nPlanned:');
    console.log('  • phase_start 4 → 3');
    for (const cfg of ENROLLMENT_SHIFTS) {
      console.log(
        `  • CS ${cfg.classstudentId}: P${cfg.fromPhase}→P${cfg.toPhase} (${cfg.enrollmentStatus})`
      );
    }
    for (const cfg of INVOICE_SHIFTS) {
      console.log(
        `  • INV-${cfg.invoiceId}: P${cfg.fromPhase}→P${cfg.toPhase}` +
          (cfg.rewritePhaseStart ? ' + PHASE_START:3' : '')
      );
    }
    console.log('  • No enrollment at Phase 7 after repair');

    // Park TARGET_PHASE high → low to avoid collisions.
    for (const cfg of INVOICE_SHIFTS) {
      const inv = await loadInvoice(client, cfg.invoiceId);
      const parked = rewriteTargetPhaseInRemarks(inv.remarks || '', 1000 + cfg.invoiceId);
      await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
        parked,
        cfg.invoiceId,
      ]);
    }

    for (const cfg of INVOICE_SHIFTS) {
      const inv = await loadInvoice(client, cfg.invoiceId);
      let remarks = rewriteTargetPhaseInRemarks(inv.remarks || '', cfg.toPhase);
      remarks = rewriteAdvancePaymentLabel(remarks, cfg.toPhase);
      if (cfg.rewritePhaseStart) {
        remarks = rewritePhaseStartInRemarks(remarks, cfg.toPhase);
      }
      remarks = appendRepairNote(remarks);
      await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
        remarks,
        cfg.invoiceId,
      ]);
      try {
        await syncProgramPaymentStatusForInvoice(client, cfg.invoiceId);
      } catch (e) {
        console.warn(`⚠ sync INV-${cfg.invoiceId}:`, e.message);
      }
      console.log(`✅ INV-${cfg.invoiceId} → phase ${cfg.toPhase}`);
    }

    for (const cfg of ENROLLMENT_SHIFTS) {
      const upd = await client.query(
        `UPDATE classstudentstbl
         SET phase_number = $1,
             program_enrollment_status = $2
         WHERE classstudent_id = $3
           AND student_id = $4
           AND class_id = $5
         RETURNING classstudent_id, phase_number, program_enrollment_status`,
        [cfg.toPhase, cfg.enrollmentStatus, cfg.classstudentId, STUDENT_ID, CLASS_ID]
      );
      if (!upd.rows.length) throw new Error(`Failed CS ${cfg.classstudentId}`);
      console.log(`✅ CS ${cfg.classstudentId} → P${cfg.toPhase} ${cfg.enrollmentStatus}`);
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET phase_start = 3
       WHERE installmentinvoiceprofiles_id = $1 AND student_id = $2`,
      [PROFILE_ID, STUDENT_ID]
    );
    console.log('✅ Profile phase_start → 3');

    const afterProfile = await loadProfile(client);
    const afterCs = await loadEnrollments(client);
    const afterInv = await loadProfileInvoices(client);

    console.log('\nProfile AFTER:', afterProfile);
    console.log('\nAFTER enrollments:');
    console.table(afterCs);
    console.log('\nAFTER profile invoices:');
    console.table(afterInv);

    if (Number(afterProfile.phase_start) !== 3) {
      throw new Error(`phase_start ${afterProfile.phase_start} ≠ 3`);
    }

    const expectedCs = [
      { phase: 3, status: 'new' },
      { phase: 4, status: 're_enrolled' },
      { phase: 5, status: 're_enrolled' },
      { phase: 6, status: 're_enrolled' },
    ];
    for (const exp of expectedCs) {
      const row = afterCs.find((r) => Number(r.phase_number) === exp.phase);
      if (!row || String(row.status) !== exp.status) {
        throw new Error(`Phase ${exp.phase} enrollment missing or wrong status`);
      }
    }
    if (afterCs.some((r) => Number(r.phase_number) === 7)) {
      throw new Error('Phase 7 enrollment still present');
    }
    if (afterCs.length !== 4) {
      throw new Error(`Expected 4 enrollment rows, got ${afterCs.length}`);
    }

    const expectedInvPhases = [
      { id: 1533, phase: '3' },
      { id: 1534, phase: '4' },
      { id: 1535, phase: '4' },
      { id: 1536, phase: '5' },
      { id: 1537, phase: '6' },
      { id: 1538, phase: '7' },
      { id: 1539, phase: '7' },
    ];
    for (const exp of expectedInvPhases) {
      const row = afterInv.find((r) => Number(r.invoice_id) === exp.id);
      const tp = row?.target_phase || row?.phase_start_remark;
      if (!row || String(tp) !== exp.phase) {
        throw new Error(`INV-${exp.id} target phase ${tp} ≠ ${exp.phase}`);
      }
    }

    console.log('\nExpected UI:');
    console.log('  Plan starts at Phase 3');
    console.log('  Phase 3: new · INV-1533 · Paid');
    console.log('  Phase 4: re enrolled · INV-1534/1535');
    console.log('  Phase 5: re enrolled · INV-1536 · Paid');
    console.log('  Phase 6: re enrolled · INV-1537 · Paid');
    console.log('  Phase 7: billing only (INV-1538/1539 partial) · no enrollment row');
    console.log('  Phase 8: Not Generated / locked');

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDry run only — rolled back. Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted. Refresh Student History → Invoices.');
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
