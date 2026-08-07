/**
 * Kendra Rafferty Dinoy (keel.arcee@gmail.com) — late-start at Phase 2.
 *
 * Class: 92 VMM_Playgroup_SS_11:00-12:00PM | Profile: 325 | Branch: VMM (1)
 * Student user_id: 536
 *
 * Intent:
 *   - Phase 1 is NOT displayed (late_start_gap — never billable / no invoice)
 *   - Paid INV-867  (was Phase 1) → TARGET_PHASE 2  + enrollment "new"
 *   - Paid INV-1334 (was Phase 2) → TARGET_PHASE 3  + enrollment "re_enrolled"
 *   - Unpaid INV-1723/2301/2338 shift 3→4, 4→5, 5→6
 *   - Phase 4 enrollment → dropped
 *
 * Run:
 *   node backend/scripts/repairKendraDinoyEnrollmentPhases.js --production
 *   node backend/scripts/repairKendraDinoyEnrollmentPhases.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import {
  attachEnrollmentToInstallmentPhaseRows,
  loadEnrollmentStatusByAbsolutePhase,
} from '../utils/installmentPhaseRowMapping.js';

const STUDENT_EMAIL = 'keel.arcee@gmail.com';
const STUDENT_ID = 536;
const CLASS_ID = 92;
const PROFILE_ID = 325;

const PHASE1_ID = 759;
const PHASE2_ID = 1168;

/** Invoice TARGET_PHASE shifts (absolute class phase). */
const INVOICE_PHASE_SHIFTS = [
  { invoiceId: 867, from: 1, to: 2 }, // paid → Phase 2 new
  { invoiceId: 1334, from: 2, to: 3 }, // paid → Phase 3 re_enrolled
  { invoiceId: 1723, from: 3, to: 4 }, // unpaid overdue on dropped phase
  { invoiceId: 2301, from: 4, to: 5 },
  { invoiceId: 2338, from: 5, to: 6 },
];

const PHASE2_ENROLLED_AT = '2026-05-09 12:00:00';
const PHASE3_ENROLLED_AT = '2026-06-06 12:00:00';
const PHASE4_ENROLLED_AT = '2026-07-25 12:00:00';
const PHASE4_REMOVED_AT = '2026-07-25 12:00:00';
const PHASE1_REMOVED_AT = '2026-05-09 12:00:00';

const REPAIR_NOTE =
  'Ops repair 2026-08-03 — Kendra Dinoy late-start Phase2: shift INV 1→2, 2→3; P2 new, P3 re_enrolled, P4 dropped; hide P1';

const isApply = process.argv.includes('--apply');

async function previewHistoryEnrollment(queryFn) {
  const enrollmentByPhase = await loadEnrollmentStatusByAbsolutePhase(
    queryFn,
    STUDENT_ID,
    CLASS_ID
  );

  const invoices = (
    await queryFn(
      `SELECT invoice_id, status,
              SUBSTRING(remarks FROM 'TARGET_PHASE:([0-9]+)') AS phase
       FROM invoicestbl
       WHERE installmentinvoiceprofiles_id = $1
         AND remarks ILIKE '%TARGET_PHASE:%'
       ORDER BY invoice_id`,
      [PROFILE_ID]
    )
  ).rows;

  const phaseRows = [];
  for (let absolutePhase = 1; absolutePhase <= 6; absolutePhase += 1) {
    const inv = invoices.find((r) => Number(r.phase) === absolutePhase);
    const hasLater = invoices.some((r) => Number(r.phase) > absolutePhase);
    const enroll = enrollmentByPhase.get(absolutePhase);
    const isDropped =
      String(enroll?.program_enrollment_status || '').toLowerCase() === 'dropped';
    const isLateStart =
      !inv &&
      !isDropped &&
      hasLater &&
      !(enroll && enroll.removed_at == null);

    phaseRows.push({
      phase_number: absolutePhase,
      status: inv?.status || (isLateStart ? null : 'Not Generated'),
      is_generated: Boolean(inv),
      invoice_id: inv?.invoice_id ?? null,
      billing_kind: isLateStart ? 'late_start_gap' : null,
    });
  }

  const attached = attachEnrollmentToInstallmentPhaseRows(phaseRows, {
    phaseStart: 1,
    enrollmentByAbsolutePhase: enrollmentByPhase,
    totalPhases: 10,
  });

  return attached.map((row) => ({
    phase: row.phase_number,
    invoice_id: row.invoice_id,
    invoice_status: row.status,
    billing_kind: row.billing_kind || '—',
    enrollment: row.program_enrollment_status || '—',
    display: row.billing_kind === 'late_start_gap' ? 'HIDDEN' : 'visible',
  }));
}

async function main() {
  console.log(
    `\nKendra Dinoy — late-start Phase 2 (shift payments)` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const student = (
      await client.query(
        `SELECT user_id, full_name, email
         FROM userstbl
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
        [STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student || Number(student.user_id) !== STUDENT_ID) {
      throw new Error(`Student ${STUDENT_EMAIL} (id ${STUDENT_ID}) not found`);
    }
    console.log('Student:', student.full_name, student.email, `(id ${student.user_id})`);

    const beforeInv = await client.query(
      `SELECT invoice_id, status,
              SUBSTRING(remarks FROM 'TARGET_PHASE:([0-9]+)') AS phase,
              TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
              TO_CHAR(due_date, 'YYYY-MM-DD') AS due,
              invoice_ar_number
       FROM invoicestbl
       WHERE installmentinvoiceprofiles_id = $1
         AND remarks ILIKE '%TARGET_PHASE:%'
       ORDER BY invoice_id`,
      [PROFILE_ID]
    );
    console.log('\nBEFORE invoices:');
    console.table(beforeInv.rows);

    const beforeCs = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status,
              TO_CHAR(enrolled_at, 'YYYY-MM-DD HH24:MI') AS enrolled,
              TO_CHAR(removed_at, 'YYYY-MM-DD HH24:MI') AS removed
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number, classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    );
    console.log('\nBEFORE classstudents:');
    console.table(beforeCs.rows);

    console.log('\nBEFORE history (approx):');
    console.table(await previewHistoryEnrollment(query));

    // --- 1) Retarget invoices (high→low then low→high avoid unique collisions) ---
    // Clear phases first by rewriting to temporary high numbers, then to final.
    for (const { invoiceId, from, to } of [...INVOICE_PHASE_SHIFTS].reverse()) {
      const row = (
        await client.query(`SELECT remarks FROM invoicestbl WHERE invoice_id = $1`, [
          invoiceId,
        ])
      ).rows[0];
      if (!row) throw new Error(`Invoice ${invoiceId} not found`);
      const current = parseTargetPhase(row.remarks);
      if (current != null && current !== from && current !== to) {
        console.warn(
          `⚠ INV-${invoiceId}: TARGET_PHASE:${current} (expected ${from} or already ${to})`
        );
      }
      // Park at 100+invoiceId to avoid collisions during multi-shift
      const parked = rewriteTargetPhaseInRemarks(row.remarks, 1000 + invoiceId);
      await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
        parked,
        invoiceId,
      ]);
    }

    for (const { invoiceId, to } of INVOICE_PHASE_SHIFTS) {
      const row = (
        await client.query(`SELECT remarks FROM invoicestbl WHERE invoice_id = $1`, [
          invoiceId,
        ])
      ).rows[0];
      const next = rewriteTargetPhaseInRemarks(row.remarks, to);
      const withNote = next.includes(REPAIR_NOTE) ? next : `${next};${REPAIR_NOTE}`;
      await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
        withNote,
        invoiceId,
      ]);
      console.log(`✅ INV-${invoiceId} → TARGET_PHASE:${to}`);
    }

    // --- 2) Phase 1: soft-remove WITHOUT dropped (so late_start_gap, not skipped_gap) ---
    const p1 = beforeCs.rows.find((r) => Number(r.classstudent_id) === PHASE1_ID);
    if (!p1 || Number(p1.phase_number) !== 1) {
      throw new Error(`Phase 1 enrollment ${PHASE1_ID} not found`);
    }
    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'new',
           removed_at = $1::timestamp,
           removed_reason = $2::text,
           removed_by = NULL,
           enrolled_by = $2::text
       WHERE classstudent_id = $3
         AND student_id = $4
         AND class_id = $5
         AND phase_number = 1`,
      [PHASE1_REMOVED_AT, REPAIR_NOTE, PHASE1_ID, STUDENT_ID, CLASS_ID]
    );
    console.log(`✅ Phase 1 (id ${PHASE1_ID}) soft-removed (not dropped → late_start hidden)`);

    // --- 3) Phase 2: new ---
    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'new',
           enrolled_at = $1::timestamp,
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL,
           enrolled_by = $2::text
       WHERE classstudent_id = $3
         AND student_id = $4
         AND class_id = $5
         AND phase_number = 2`,
      [PHASE2_ENROLLED_AT, REPAIR_NOTE, PHASE2_ID, STUDENT_ID, CLASS_ID]
    );
    console.log(`✅ Phase 2 (id ${PHASE2_ID}) → new`);

    // --- 4) Phase 3: re_enrolled ---
    const existingP3 = (
      await client.query(
        `SELECT classstudent_id FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND phase_number = 3
         ORDER BY classstudent_id DESC LIMIT 1`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows[0];

    if (existingP3) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 're_enrolled',
             enrolled_at = $1::timestamp,
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL,
             enrolled_by = $2::text
         WHERE classstudent_id = $3`,
        [PHASE3_ENROLLED_AT, REPAIR_NOTE, existingP3.classstudent_id]
      );
      console.log(`✅ Phase 3 (id ${existingP3.classstudent_id}) → re_enrolled`);
    } else {
      const ins = await client.query(
        `INSERT INTO classstudentstbl
           (student_id, class_id, enrolled_by, phase_number,
            program_enrollment_status, enrolled_at)
         VALUES ($1, $2, $3::text, 3, 're_enrolled', $4::timestamp)
         RETURNING classstudent_id`,
        [STUDENT_ID, CLASS_ID, REPAIR_NOTE, PHASE3_ENROLLED_AT]
      );
      console.log(`✅ Phase 3 inserted (id ${ins.rows[0].classstudent_id}) → re_enrolled`);
    }

    // --- 5) Phase 4: dropped ---
    const existingP4 = (
      await client.query(
        `SELECT classstudent_id FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND phase_number = 4
         ORDER BY classstudent_id DESC LIMIT 1`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows[0];

    if (existingP4) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 'dropped',
             enrolled_at = $1::timestamp,
             removed_at = $2::timestamp,
             removed_reason = $3::text,
             removed_by = NULL,
             enrolled_by = $3::text
         WHERE classstudent_id = $4`,
        [PHASE4_ENROLLED_AT, PHASE4_REMOVED_AT, REPAIR_NOTE, existingP4.classstudent_id]
      );
      console.log(`✅ Phase 4 (id ${existingP4.classstudent_id}) → dropped`);
    } else {
      const ins = await client.query(
        `INSERT INTO classstudentstbl
           (student_id, class_id, enrolled_by, phase_number,
            program_enrollment_status, enrolled_at, removed_at, removed_reason, removed_by)
         VALUES ($1, $2, $3::text, 4, 'dropped', $4::timestamp, $5::timestamp, $3::text, NULL)
         RETURNING classstudent_id`,
        [STUDENT_ID, CLASS_ID, REPAIR_NOTE, PHASE4_ENROLLED_AT, PHASE4_REMOVED_AT]
      );
      console.log(`✅ Phase 4 inserted (id ${ins.rows[0].classstudent_id}) → dropped`);
    }

    // Clear any stray phase 5+ active enrollments (should be none)
    await client.query(
      `UPDATE classstudentstbl
       SET removed_at = COALESCE(removed_at, $1::timestamp),
           removed_reason = COALESCE(removed_reason, $2::text)
       WHERE student_id = $3
         AND class_id = $4
         AND phase_number >= 5
         AND removed_at IS NULL
         AND program_enrollment_status <> 'dropped'`,
      [PHASE4_REMOVED_AT, REPAIR_NOTE, STUDENT_ID, CLASS_ID]
    );

    const afterInv = await client.query(
      `SELECT invoice_id, status,
              SUBSTRING(remarks FROM 'TARGET_PHASE:([0-9]+)') AS phase,
              TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
              TO_CHAR(due_date, 'YYYY-MM-DD') AS due,
              invoice_ar_number
       FROM invoicestbl
       WHERE installmentinvoiceprofiles_id = $1
         AND remarks ILIKE '%TARGET_PHASE:%'
       ORDER BY SUBSTRING(remarks FROM 'TARGET_PHASE:([0-9]+)')::int, invoice_id`,
      [PROFILE_ID]
    );
    console.log('\nAFTER invoices:');
    console.table(afterInv.rows);

    const afterCs = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status,
              TO_CHAR(enrolled_at, 'YYYY-MM-DD HH24:MI') AS enrolled,
              TO_CHAR(removed_at, 'YYYY-MM-DD HH24:MI') AS removed
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number, classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    );
    console.log('\nAFTER classstudents:');
    console.table(afterCs.rows);

    const historyPreview = await previewHistoryEnrollment(async (sql, params) =>
      client.query(sql, params)
    );
    console.log('\nAFTER history (approx):');
    console.table(historyPreview);

    // Validations
    const byInv = Object.fromEntries(
      afterInv.rows.map((r) => [Number(r.invoice_id), Number(r.phase)])
    );
    for (const { invoiceId, to } of INVOICE_PHASE_SHIFTS) {
      if (byInv[invoiceId] !== to) {
        throw new Error(`INV-${invoiceId} expected phase ${to}, got ${byInv[invoiceId]}`);
      }
    }

    const p2 = afterCs.rows.find((r) => Number(r.phase_number) === 2 && r.removed == null);
    const p3 = afterCs.rows.find((r) => Number(r.phase_number) === 3 && r.removed == null);
    const p4 = afterCs.rows.find((r) => Number(r.phase_number) === 4);
    const p1After = afterCs.rows.find((r) => Number(r.classstudent_id) === PHASE1_ID);

    if (!p2 || p2.program_enrollment_status !== 'new') {
      throw new Error('Phase 2 must be active new');
    }
    if (!p3 || p3.program_enrollment_status !== 're_enrolled') {
      throw new Error('Phase 3 must be active re_enrolled');
    }
    if (!p4 || p4.program_enrollment_status !== 'dropped' || p4.removed == null) {
      throw new Error('Phase 4 must be dropped with removed_at');
    }
    if (!p1After?.removed || p1After.program_enrollment_status === 'dropped') {
      throw new Error('Phase 1 must be soft-removed and NOT status=dropped (for late_start hide)');
    }

    const h1 = historyPreview.find((r) => r.phase === 1);
    const h2 = historyPreview.find((r) => r.phase === 2);
    const h3 = historyPreview.find((r) => r.phase === 3);
    const h4 = historyPreview.find((r) => r.phase === 4);
    if (h1?.display !== 'HIDDEN' || h1?.billing_kind !== 'late_start_gap') {
      throw new Error(`Phase 1 should be HIDDEN late_start_gap, got ${JSON.stringify(h1)}`);
    }
    if (h2?.enrollment !== 'new' || Number(h2?.invoice_id) !== 867) {
      throw new Error(`Phase 2 expected new + INV-867, got ${JSON.stringify(h2)}`);
    }
    if (h3?.enrollment !== 're_enrolled' || Number(h3?.invoice_id) !== 1334) {
      throw new Error(`Phase 3 expected re_enrolled + INV-1334, got ${JSON.stringify(h3)}`);
    }
    if (h4?.enrollment !== 'dropped' || Number(h4?.invoice_id) !== 1723) {
      throw new Error(`Phase 4 expected dropped + INV-1723, got ${JSON.stringify(h4)}`);
    }

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nRolled back (dry run). Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted.');
    console.log('✅ Refresh Student history → Invoices. Phase 1 should be hidden.');
    console.log('   Visible: Phase 2 new (paid), Phase 3 re enrolled (paid), Phase 4 dropped.');
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
