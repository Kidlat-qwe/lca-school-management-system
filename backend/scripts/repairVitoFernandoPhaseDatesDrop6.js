/**
 * Vito Javier Fernando — realign Phase 2–5 issue/due to class cadence; drop Phase 6.
 *
 * Student: 527 · kret_26@yahoo.com
 * Profile: 310 · class 67 VMP_Playgroup_TTh_11:00AM · Branch VMP (6)
 * Plan phase_start = 2.
 *
 * Class Phase 5 starts 2026-05-26. Invoices were billed a month late, so the
 * month matrix painted paid Phase 5 on August (Active) while the plan is Inactive.
 *
 * Target (issue / due). Paymenttbl.issue_date is not changed.
 *   Phase 2 INV-771  Paid   2026-04-09 / 2026-03-03  enrollment new
 *   Phase 3 INV-1000 Paid   2026-03-25 / 2026-04-05  enrollment re_enrolled
 *   Phase 4 INV-1293 Paid   2026-04-25 / 2026-05-05  enrollment re_enrolled
 *   Phase 5 INV-1762 Paid   2026-05-25 / 2026-06-05  enrollment re_enrolled
 *   Phase 6 INV-2314 Unpaid keep; classstudent dropped; stop generation
 *   Phase 7 INV-2339 cancel + detach (same-day duplicate of Phase 6 cycle)
 *
 * enrolled_at aligned to class phase start so matrix months follow the calendar:
 *   P2 Mar new → P3 Apr re-enrolled → P4 May → P5 Jun → P6 Jul dropped → Aug Inactive
 *
 * Run:
 *   node backend/scripts/repairVitoFernandoPhaseDatesDrop6.js --production
 *   node backend/scripts/repairVitoFernandoPhaseDatesDrop6.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 527;
const STUDENT_EMAIL = 'kret_26@yahoo.com';
const PROFILE_ID = 310;
const CLASS_ID = 67;
const BRANCH_ID = 6;
const PHASE7_INVOICE_ID = 2339;

const REPAIR_NOTE =
  'Ops repair 2026-08-14 — Vito Fernando Phase 2–5 issue/due realign; Phase 6 dropped; stop generation';

const PHASES = [
  {
    phase: 2,
    invoiceId: 771,
    issue: '2026-04-09',
    due: '2026-03-03',
    enrollmentStatus: 'new',
    enrolledAt: '2026-03-03 12:00:00',
    expectedInvoiceStatus: 'Paid',
  },
  {
    phase: 3,
    invoiceId: 1000,
    issue: '2026-03-25',
    due: '2026-04-05',
    enrollmentStatus: 're_enrolled',
    enrolledAt: '2026-03-31 12:00:00',
    expectedInvoiceStatus: 'Paid',
  },
  {
    phase: 4,
    invoiceId: 1293,
    issue: '2026-04-25',
    due: '2026-05-05',
    enrollmentStatus: 're_enrolled',
    enrolledAt: '2026-04-28 12:00:00',
    expectedInvoiceStatus: 'Paid',
  },
  {
    phase: 5,
    invoiceId: 1762,
    issue: '2026-05-25',
    due: '2026-06-05',
    enrollmentStatus: 're_enrolled',
    enrolledAt: '2026-05-26 12:00:00',
    expectedInvoiceStatus: 'Paid',
  },
];

const PHASE6 = {
  phase: 6,
  invoiceId: 2314,
  enrollmentStatus: 'dropped',
  enrolledAt: '2026-06-23 12:00:00',
};

const EXPECTED_MATRIX = [
  ['2026-03', 'new'],
  ['2026-04', 're-enrolled'],
  ['2026-05', 're-enrolled'],
  ['2026-06', 're-enrolled'],
  ['2026-07', 'dropped'],
  ['2026-08', 'Inactive'],
];

const isApply = process.argv.includes('--apply');

async function loadInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_id, status, remarks, installmentinvoiceprofiles_id AS profile_id,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
            TO_CHAR(due_date, 'YYYY-MM-DD') AS due
     FROM invoicestbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const row = r.rows[0] || null;
  if (row) row.phase = parseTargetPhase(row.remarks);
  return row;
}

async function loadPayments(client, invoiceId) {
  const r = await client.query(
    `SELECT payment_id,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS paid_on,
            payable_amount, status, approval_status
     FROM paymenttbl
     WHERE invoice_id = $1
     ORDER BY payment_id`,
    [invoiceId]
  );
  return r.rows;
}

async function previewMatrix(queryFn) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year: 2026,
    branchId: BRANCH_ID,
    classId: CLASS_ID,
  });
  const track = (matrix.students || []).find(
    (s) => Number(s.student_id) === STUDENT_ID && Number(s.class_id) === CLASS_ID
  );
  if (!track) return [];
  const cells = [];
  for (const m of matrix.months || []) {
    const c = track.months?.[m.key];
    if (!c) continue;
    if (c.mark === '1' || c.mark === '✓' || c.mark === 'X' || c.label) {
      cells.push({
        month: m.key,
        label: c.label,
        status: c.status,
        phase: c.phase_number,
        mark: c.mark,
      });
    }
  }
  return cells;
}

function assertExpected(cells) {
  const byMonth = Object.fromEntries(cells.map((c) => [c.month, c]));
  const problems = [];
  for (const [month, label] of EXPECTED_MATRIX) {
    const got = String(byMonth[month]?.label || '').trim().toLowerCase();
    const want = String(label).toLowerCase();
    if (got !== want && !(want === 'dropped' && got === 'dropped/unenrolled')) {
      problems.push(`${month}: expected ${label}, got ${byMonth[month]?.label || '—'}`);
    }
  }
  return problems;
}

function appendNote(remarks) {
  const text = String(remarks || '');
  return text.includes(REPAIR_NOTE) ? text : [text, REPAIR_NOTE].filter(Boolean).join(';');
}

async function main() {
  console.log(
    `\nVito Fernando — Phase 2–5 dates + Phase 6 drop` +
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
    if (!student) throw new Error('Student not found');
    console.log('Student:', student.full_name, student.email);

    const profile = (
      await client.query(
        `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.class_id,
                ip.phase_start, ip.generated_count, ip.is_active,
                ii.installmentinvoicedtl_id,
                TO_CHAR(ii.next_generation_date, 'YYYY-MM-DD') AS next_gen,
                TO_CHAR(ii.next_invoice_month, 'YYYY-MM-DD') AS next_month
         FROM installmentinvoiceprofilestbl ip
         LEFT JOIN installmentinvoicestbl ii
           ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
         WHERE ip.installmentinvoiceprofiles_id = $1
           AND ip.student_id = $2
         ORDER BY ii.installmentinvoicedtl_id DESC
         LIMIT 1`,
        [PROFILE_ID, STUDENT_ID]
      )
    ).rows[0];
    if (!profile || Number(profile.class_id) !== CLASS_ID) {
      throw new Error(`Profile ${PROFILE_ID} / class ${CLASS_ID} mismatch`);
    }

    console.log('\nBEFORE payments (must stay):');
    for (const cfg of PHASES) {
      const pays = await loadPayments(client, cfg.invoiceId);
      console.table(
        pays.length
          ? pays.map((p) => ({
              inv: cfg.invoiceId,
              payment_id: p.payment_id,
              paid_on: p.paid_on,
              amount: p.payable_amount,
              status: p.status,
            }))
          : [{ inv: cfg.invoiceId, note: '(no payments)' }]
      );
    }

    console.log('\nBEFORE invoices:');
    for (const cfg of [...PHASES, PHASE6]) {
      const inv = await loadInvoice(client, cfg.invoiceId);
      if (!inv) throw new Error(`INV-${cfg.invoiceId} not found`);
      if (Number(inv.profile_id) !== PROFILE_ID) {
        throw new Error(`INV-${cfg.invoiceId} not on profile ${PROFILE_ID}`);
      }
      if (Number(inv.phase) !== cfg.phase) {
        throw new Error(`INV-${cfg.invoiceId} TARGET_PHASE ${inv.phase}, expected ${cfg.phase}`);
      }
      console.log(
        `  INV-${inv.invoice_id} P${inv.phase} ${inv.status} ${inv.issue}/${inv.due}`
      );
    }

    const phase7 = await loadInvoice(client, PHASE7_INVOICE_ID);
    if (!phase7) throw new Error(`INV-${PHASE7_INVOICE_ID} not found`);
    const phase7Paid = (
      await client.query(
        `SELECT COUNT(*)::int AS n FROM paymenttbl
         WHERE invoice_id = $1
           AND status = 'Completed'
           AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
        [PHASE7_INVOICE_ID]
      )
    ).rows[0]?.n;
    if (Number(phase7Paid) > 0) {
      throw new Error(`INV-${PHASE7_INVOICE_ID} has completed payments — refuse cancel`);
    }

    const enrollments = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status AS status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled,
                TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY phase_number, classstudent_id`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;
    console.log('\nBEFORE enrollments:');
    console.table(enrollments);
    console.log('BEFORE profile/queue:', {
      phase_start: profile.phase_start,
      generated_count: profile.generated_count,
      is_active: profile.is_active,
      next_gen: profile.next_gen,
      next_month: profile.next_month,
    });
    console.log('\nBEFORE matrix:');
    console.table(await previewMatrix(query));

    console.log('\nPlanned:');
    for (const cfg of PHASES) {
      console.log(
        `  • INV-${cfg.invoiceId} issue/due → ${cfg.issue} / ${cfg.due}; ` +
          `P${cfg.phase} enrollment ${cfg.enrollmentStatus} @ ${cfg.enrolledAt.slice(0, 10)}`
      );
    }
    console.log('  • Payments unchanged');
    console.log(`  • Phase 6 INV-${PHASE6.invoiceId} kept Unpaid; enrollment dropped`);
    console.log(`  • Cancel + detach Phase 7 INV-${PHASE7_INVOICE_ID}`);
    console.log('  • Profile is_active → false; queue next_generation_date → NULL');

    for (const cfg of PHASES) {
      const inv = await loadInvoice(client, cfg.invoiceId);
      let remarks = rewriteTargetPhaseInRemarks(inv.remarks || '', cfg.phase);
      remarks = appendNote(remarks);
      await client.query(
        `UPDATE invoicestbl
         SET issue_date = $1::date,
             due_date = $2::date,
             remarks = $3
         WHERE invoice_id = $4
           AND installmentinvoiceprofiles_id = $5`,
        [cfg.issue, cfg.due, remarks, cfg.invoiceId, PROFILE_ID]
      );
      try {
        await syncProgramPaymentStatusForInvoice(client, cfg.invoiceId);
      } catch (e) {
        console.warn(`⚠ sync INV-${cfg.invoiceId}:`, e.message);
      }

      const existing = enrollments.find(
        (e) => Number(e.phase_number) === cfg.phase && !e.removed
      );
      if (existing) {
        await client.query(
          `UPDATE classstudentstbl
           SET program_enrollment_status = $1,
               enrolled_at = $2::timestamp,
               removed_at = NULL,
               removed_reason = NULL,
               removed_by = NULL,
               enrolled_by = CASE
                 WHEN enrolled_by IS NULL OR TRIM(enrolled_by) = '' THEN $3::text
                 WHEN enrolled_by ILIKE '%' || $3::text || '%' THEN enrolled_by
                 ELSE enrolled_by || ' | ' || $3::text
               END
           WHERE classstudent_id = $4
             AND student_id = $5
             AND class_id = $6`,
          [
            cfg.enrollmentStatus,
            cfg.enrolledAt,
            REPAIR_NOTE,
            existing.classstudent_id,
            STUDENT_ID,
            CLASS_ID,
          ]
        );
        console.log(
          `✅ P${cfg.phase} INV-${cfg.invoiceId} ${cfg.issue}/${cfg.due}; ` +
            `CS ${existing.classstudent_id} → ${cfg.enrollmentStatus}`
        );
      } else {
        const inserted = await client.query(
          `INSERT INTO classstudentstbl (
             student_id, class_id, phase_number, program_enrollment_status,
             enrolled_at, enrolled_by
           ) VALUES ($1, $2, $3, $4, $5::timestamp, $6)
           RETURNING classstudent_id`,
          [
            STUDENT_ID,
            CLASS_ID,
            cfg.phase,
            cfg.enrollmentStatus,
            cfg.enrolledAt,
            REPAIR_NOTE,
          ]
        );
        console.log(
          `✅ P${cfg.phase} INV-${cfg.invoiceId} ${cfg.issue}/${cfg.due}; ` +
            `inserted CS ${inserted.rows[0].classstudent_id} ${cfg.enrollmentStatus}`
        );
      }
    }

    const p6Inv = await loadInvoice(client, PHASE6.invoiceId);
    await client.query(
      `UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`,
      [appendNote(p6Inv.remarks), PHASE6.invoiceId]
    );

    const p6Existing = enrollments.filter((e) => Number(e.phase_number) === 6);
    if (p6Existing.length) {
      for (const row of p6Existing) {
        await client.query(
          `UPDATE classstudentstbl
           SET program_enrollment_status = 'dropped',
               enrolled_at = $1::timestamp,
               removed_at = CURRENT_TIMESTAMP,
               removed_reason = $2,
               removed_by = 'System (Ops repair)'
           WHERE classstudent_id = $3
             AND student_id = $4
             AND class_id = $5`,
          [PHASE6.enrolledAt, REPAIR_NOTE, row.classstudent_id, STUDENT_ID, CLASS_ID]
        );
        console.log(`✅ Phase 6 CS ${row.classstudent_id} → dropped`);
      }
    } else {
      const inserted = await client.query(
        `INSERT INTO classstudentstbl (
           student_id, class_id, phase_number, program_enrollment_status,
           enrolled_at, enrolled_by, removed_at, removed_reason, removed_by
         ) VALUES (
           $1, $2, 6, 'dropped', $3::timestamp, $4::varchar,
           CURRENT_TIMESTAMP, $5::text, 'System (Ops repair)'
         )
         RETURNING classstudent_id`,
        [STUDENT_ID, CLASS_ID, PHASE6.enrolledAt, REPAIR_NOTE, REPAIR_NOTE]
      );
      console.log(`✅ Inserted Phase 6 dropped CS ${inserted.rows[0].classstudent_id}`);
    }

    const phase7Cancelled = /^cancell?ed$/i.test(String(phase7.status || ''));
    if (!phase7Cancelled || Number(phase7.profile_id) === PROFILE_ID) {
      await client.query(
        `UPDATE invoicestbl
         SET status = 'Cancelled',
             installmentinvoiceprofiles_id = NULL,
             remarks = $1
         WHERE invoice_id = $2`,
        [appendNote(phase7.remarks), PHASE7_INVOICE_ID]
      );
      await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [
        PHASE7_INVOICE_ID,
      ]);
      console.log(`✅ Cancelled + detached INV-${PHASE7_INVOICE_ID}`);
    } else {
      console.log(`  · INV-${PHASE7_INVOICE_ID} already cancelled/detached`);
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = 6,
           is_active = false
       WHERE installmentinvoiceprofiles_id = $1
         AND student_id = $2`,
      [PROFILE_ID, STUDENT_ID]
    );

    if (!profile.installmentinvoicedtl_id) {
      throw new Error('No installment queue row');
    }
    await client.query(
      `UPDATE installmentinvoicestbl
       SET next_generation_date = NULL,
           next_invoice_month = NULL,
           scheduled_date = NULL
       WHERE installmentinvoicedtl_id = $1
         AND installmentinvoiceprofiles_id = $2`,
      [profile.installmentinvoicedtl_id, PROFILE_ID]
    );
    console.log('✅ Profile Inactive; generation queue cleared');

    console.log('\nAFTER matrix:');
    const afterCells = await previewMatrix((text, params) => client.query(text, params));
    console.table(afterCells);
    const problems = assertExpected(afterCells);
    if (problems.length) {
      console.warn('Matrix not fully aligned:');
      problems.forEach((p) => console.warn('  -', p));
    } else {
      console.log('Matrix matches expected Mar–Jun enrolled, Jul dropped, Aug Inactive.');
    }

    if (isApply) {
      await client.query('COMMIT');
      console.log('\n✅ Applied.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run only — re-run with --apply to commit.');
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\n❌', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
