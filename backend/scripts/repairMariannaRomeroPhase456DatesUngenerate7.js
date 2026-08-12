/**
 * Marianna Agatha Romero — shift Phase 4–6 issue/due dates; un-generate Phase 7.
 *
 * Student: 560 · amgromero1987@gmail.com
 * Profile: 400 · class 55 NC_NURSERY_TThS_11:00-12:00PM
 *
 *   Phase 4 INV-1354  Apr 25 / May 5  → May 25 / Jun 5   (Paid, keep payment)
 *   Phase 5 INV-1948  May 25 / Jun 5  → Jun 25 / Jul 5   (Paid, keep payment)
 *   Phase 6 INV-1953  Jun 25 / Jul 5  → Jul 25 / Aug 5   (Unpaid)
 *   Phase 7 INV-2153  cancel + detach → Not Generated
 *
 * Queue after: generated_count 3, next_gen 2026-08-25, next_month 2026-09-01,
 * scheduled 2026-09-05 (Phase 7 will generate on Aug 25).
 *
 * Phase 6 enrollment: restore dropped → re_enrolled (due Aug 5 is not yet
 * 30 days unpaid). Reactivate profile so the plan is Active / Overdue.
 *
 * Run:
 *   node backend/scripts/repairMariannaRomeroPhase456DatesUngenerate7.js --production
 *   node backend/scripts/repairMariannaRomeroPhase456DatesUngenerate7.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 560;
const STUDENT_EMAIL = 'amgromero1987@gmail.com';
const PROFILE_ID = 400;
const CLASS_ID = 55;
const PHASE7_INVOICE_ID = 2153;
const PHASE6_CLASSSTUDENT_ID = 2099;
const EXPECTED_GENERATED_COUNT = 3;

const NEXT_GEN = '2026-08-25';
const NEXT_MONTH = '2026-09-01';
const SCHEDULED_DUE = '2026-09-05';

const DATE_UPDATES = [
  {
    invoiceId: 1354,
    phase: 4,
    expectedStatus: 'paid',
    currentIssue: '2026-04-25',
    currentDue: '2026-05-05',
    targetIssue: '2026-05-25',
    targetDue: '2026-06-05',
  },
  {
    invoiceId: 1948,
    phase: 5,
    expectedStatus: 'paid',
    currentIssue: '2026-05-25',
    currentDue: '2026-06-05',
    targetIssue: '2026-06-25',
    targetDue: '2026-07-05',
  },
  {
    invoiceId: 1953,
    phase: 6,
    expectedStatus: 'unpaid',
    currentIssue: '2026-06-25',
    currentDue: '2026-07-05',
    targetIssue: '2026-07-25',
    targetDue: '2026-08-05',
  },
];

const REPAIR_NOTE =
  'Ops repair 2026-08-12 — Marianna Romero Phase 4–6 dates + un-generate Phase 7 + undrop Phase 6';

const isApply = process.argv.includes('--apply');

async function loadInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_id, status, amount, invoice_ar_number,
            installmentinvoiceprofiles_id AS profile_id,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
            TO_CHAR(due_date, 'YYYY-MM-DD') AS due,
            remarks
     FROM invoicestbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const row = r.rows[0] || null;
  if (row) row.phase = parseTargetPhase(row.remarks);
  return row;
}

async function loadProfileQueue(client) {
  const r = await client.query(
    `SELECT ip.installmentinvoiceprofiles_id, ip.class_id, c.class_name,
            ip.is_active, ip.generated_count, ip.phase_start,
            ii.installmentinvoicedtl_id,
            TO_CHAR(ii.next_generation_date, 'YYYY-MM-DD') AS next_gen,
            TO_CHAR(ii.next_invoice_month, 'YYYY-MM-DD') AS next_month,
            TO_CHAR(ii.scheduled_date, 'YYYY-MM-DD') AS scheduled
     FROM installmentinvoiceprofilestbl ip
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     LEFT JOIN installmentinvoicestbl ii
       ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
     WHERE ip.installmentinvoiceprofiles_id = $1
       AND ip.student_id = $2`,
    [PROFILE_ID, STUDENT_ID]
  );
  return r.rows[0] || null;
}

async function loadEnrollments(client) {
  const r = await client.query(
    `SELECT cs.classstudent_id, cs.class_id, cs.phase_number,
            cs.program_enrollment_status AS status,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM-DD HH24:MI') AS removed,
            LEFT(COALESCE(cs.removed_reason, ''), 70) AS removed_reason
     FROM classstudentstbl cs
     WHERE cs.student_id = $1 AND cs.class_id = $2
     ORDER BY cs.phase_number, cs.classstudent_id`,
    [STUDENT_ID, CLASS_ID]
  );
  return r.rows;
}

async function loadProfileInvoices(client) {
  const r = await client.query(
    `SELECT invoice_id, status, amount,
            SUBSTRING(remarks FROM 'TARGET_PHASE:([0-9]+)') AS phase,
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

async function main() {
  console.log(
    `\nMarianna Romero — Phase 4–6 dates + un-generate Phase 7` +
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

    const profile = await loadProfileQueue(client);
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);
    if (Number(profile.class_id) !== CLASS_ID) {
      throw new Error(
        `Profile class_id=${profile.class_id}, expected ${CLASS_ID} (TThS). Run class-move apply first if still on MWF.`
      );
    }
    console.log('Profile/queue BEFORE:', profile);

    console.log('\nEnrollments BEFORE:');
    console.table(await loadEnrollments(client));

    console.log('\nProfile invoices BEFORE:');
    console.table(await loadProfileInvoices(client));

    const datePlan = [];
    for (const cfg of DATE_UPDATES) {
      const inv = await loadInvoice(client, cfg.invoiceId);
      if (!inv) throw new Error(`INV-${cfg.invoiceId} not found`);
      if (Number(inv.profile_id) !== PROFILE_ID) {
        throw new Error(`INV-${cfg.invoiceId} profile ${inv.profile_id} ≠ ${PROFILE_ID}`);
      }
      if (inv.phase !== cfg.phase) {
        throw new Error(
          `INV-${cfg.invoiceId} TARGET_PHASE:${inv.phase}, expected ${cfg.phase}`
        );
      }
      const status = String(inv.status || '').toLowerCase();
      if (status !== cfg.expectedStatus) {
        throw new Error(
          `INV-${cfg.invoiceId} status ${inv.status}, expected ${cfg.expectedStatus}`
        );
      }

      const alreadyTarget = inv.issue === cfg.targetIssue && inv.due === cfg.targetDue;
      const matchesCurrent = inv.issue === cfg.currentIssue && inv.due === cfg.currentDue;
      if (!alreadyTarget && !matchesCurrent) {
        throw new Error(
          `INV-${cfg.invoiceId} unexpected dates issue=${inv.issue} due=${inv.due}`
        );
      }

      datePlan.push({ cfg, inv, alreadyTarget });
    }

    const phase7 = await loadInvoice(client, PHASE7_INVOICE_ID);
    const phase7AlreadyCancelled =
      phase7 &&
      ['cancelled', 'canceled'].includes(String(phase7.status || '').toLowerCase()) &&
      phase7.profile_id == null;

    if (!phase7AlreadyCancelled) {
      if (!phase7) throw new Error(`INV-${PHASE7_INVOICE_ID} not found`);
      if (Number(phase7.profile_id) !== PROFILE_ID) {
        throw new Error(`INV-${PHASE7_INVOICE_ID} profile ${phase7.profile_id} ≠ ${PROFILE_ID}`);
      }
      if (phase7.phase !== 7) {
        throw new Error(`INV-${PHASE7_INVOICE_ID} TARGET_PHASE:${phase7.phase}, expected 7`);
      }
      if (String(phase7.status).toLowerCase() !== 'unpaid') {
        throw new Error(
          `INV-${PHASE7_INVOICE_ID} status ${phase7.status} — refuse to cancel (expected Unpaid)`
        );
      }

      const payments = (
        await client.query(
          `SELECT payment_id, status, approval_status, payable_amount
           FROM paymenttbl WHERE invoice_id = $1`,
          [PHASE7_INVOICE_ID]
        )
      ).rows;
      console.log('Phase 7 payments:', payments.length ? payments : '(none)');
      if (
        payments.some(
          (p) =>
            String(p.status) === 'Completed' &&
            String(p.approval_status || '') !== 'Rejected'
        )
      ) {
        throw new Error('Phase 7 has completed payments — refuse to cancel');
      }
    }

    console.log('\nPlanned:');
    for (const { cfg, alreadyTarget } of datePlan) {
      console.log(
        alreadyTarget
          ? `  • Phase ${cfg.phase} INV-${cfg.invoiceId} already ${cfg.targetIssue} / ${cfg.targetDue}`
          : `  • Phase ${cfg.phase} INV-${cfg.invoiceId} ${cfg.currentIssue}/${cfg.currentDue} → ${cfg.targetIssue}/${cfg.targetDue}`
      );
    }
    console.log(
      phase7AlreadyCancelled
        ? `  • Phase 7 INV-${PHASE7_INVOICE_ID} already cancelled/detached`
        : `  • Cancel + detach Phase 7 INV-${PHASE7_INVOICE_ID}`
    );
    console.log(
      `  • generated_count ${profile.generated_count} → ${EXPECTED_GENERATED_COUNT}`
    );
    console.log(
      `  • Queue → next_gen ${NEXT_GEN}, next_month ${NEXT_MONTH}, scheduled ${SCHEDULED_DUE}`
    );
    console.log(
      `  • Phase 6 CS ${PHASE6_CLASSSTUDENT_ID} dropped → re_enrolled (due Aug 5 is not 30 days unpaid)`
    );
    console.log('  • Profile is_active → true (plan Active; Phase 6 Overdue)');

    for (const { cfg, inv, alreadyTarget } of datePlan) {
      if (alreadyTarget) continue;
      const nextRemarks = String(inv.remarks || '').includes(REPAIR_NOTE)
        ? inv.remarks
        : [inv.remarks, REPAIR_NOTE].filter(Boolean).join(';');
      await client.query(
        `UPDATE invoicestbl
         SET issue_date = $1::date,
             due_date = $2::date,
             remarks = $3
         WHERE invoice_id = $4
           AND installmentinvoiceprofiles_id = $5`,
        [cfg.targetIssue, cfg.targetDue, nextRemarks, cfg.invoiceId, PROFILE_ID]
      );
      try {
        await syncProgramPaymentStatusForInvoice(client, cfg.invoiceId);
      } catch (e) {
        console.warn(`⚠ syncProgramPaymentStatus INV-${cfg.invoiceId}:`, e.message);
      }
      console.log(`✅ Updated INV-${cfg.invoiceId} dates`);
    }

    if (!phase7AlreadyCancelled) {
      const p7 = await loadInvoice(client, PHASE7_INVOICE_ID);
      const nextRemarks = [p7.remarks, REPAIR_NOTE].filter(Boolean).join(';');
      await client.query(
        `UPDATE invoicestbl
         SET status = 'Cancelled',
             installmentinvoiceprofiles_id = NULL,
             remarks = $1
         WHERE invoice_id = $2
           AND installmentinvoiceprofiles_id = $3`,
        [nextRemarks, PHASE7_INVOICE_ID, PROFILE_ID]
      );
      await client.query(
        `DELETE FROM program_payment_statustbl WHERE invoice_id = $1`,
        [PHASE7_INVOICE_ID]
      );
      console.log(`✅ Cancelled + detached INV-${PHASE7_INVOICE_ID}`);
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = $1
       WHERE installmentinvoiceprofiles_id = $2
         AND student_id = $3`,
      [EXPECTED_GENERATED_COUNT, PROFILE_ID, STUDENT_ID]
    );

    if (!profile.installmentinvoicedtl_id) {
      throw new Error('No installment queue row for profile 400');
    }
    await client.query(
      `UPDATE installmentinvoicestbl
       SET next_generation_date = $1::date,
           next_invoice_month = $2::date,
           scheduled_date = $3::date
       WHERE installmentinvoicedtl_id = $4
         AND installmentinvoiceprofiles_id = $5`,
      [NEXT_GEN, NEXT_MONTH, SCHEDULED_DUE, profile.installmentinvoicedtl_id, PROFILE_ID]
    );
    console.log('✅ Queue + generated_count updated');

    const restored = await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 're_enrolled',
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL,
           enrolled_by = CASE
             WHEN enrolled_by IS NULL OR TRIM(enrolled_by) = '' THEN $1::text
             WHEN enrolled_by ILIKE '%' || $1::text || '%' THEN enrolled_by
             ELSE enrolled_by || ' | ' || $1::text
           END
       WHERE classstudent_id = $2
         AND student_id = $3
         AND class_id = $4
         AND phase_number = 6
       RETURNING classstudent_id, phase_number, program_enrollment_status AS status,
                 removed_at`,
      [REPAIR_NOTE, PHASE6_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
    );
    if (!restored.rows.length) {
      throw new Error(
        `Failed to restore Phase 6 CS ${PHASE6_CLASSSTUDENT_ID} on class ${CLASS_ID}`
      );
    }
    if (restored.rows[0].status !== 're_enrolled' || restored.rows[0].removed_at) {
      throw new Error('Phase 6 still dropped after restore');
    }
    console.log(`✅ Phase 6 CS ${PHASE6_CLASSSTUDENT_ID} → re_enrolled`);

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET is_active = true
       WHERE installmentinvoiceprofiles_id = $1
         AND student_id = $2`,
      [PROFILE_ID, STUDENT_ID]
    );
    console.log('✅ Profile is_active → true');

    const afterDates = [];
    for (const cfg of DATE_UPDATES) {
      const after = await loadInvoice(client, cfg.invoiceId);
      afterDates.push(after);
      if (after.issue !== cfg.targetIssue || after.due !== cfg.targetDue) {
        throw new Error(
          `INV-${cfg.invoiceId} dates not applied: ${after.issue} / ${after.due}`
        );
      }
    }

    const afterP7 = await loadInvoice(client, PHASE7_INVOICE_ID);
    if (
      !['cancelled', 'canceled'].includes(String(afterP7.status || '').toLowerCase()) ||
      afterP7.profile_id != null
    ) {
      throw new Error('Phase 7 cancel/detach validation failed');
    }

    const afterProfile = await loadProfileQueue(client);
    if (Number(afterProfile.generated_count) !== EXPECTED_GENERATED_COUNT) {
      throw new Error(`generated_count=${afterProfile.generated_count}, expected 3`);
    }
    if (!afterProfile.is_active) {
      throw new Error('Profile not active after restore');
    }
    if (
      afterProfile.next_gen !== NEXT_GEN ||
      afterProfile.next_month !== NEXT_MONTH ||
      afterProfile.scheduled !== SCHEDULED_DUE
    ) {
      throw new Error(
        `Queue mismatch next_gen=${afterProfile.next_gen} next_month=${afterProfile.next_month} scheduled=${afterProfile.scheduled}`
      );
    }

    const remaining = await loadProfileInvoices(client);
    if (remaining.some((r) => Number(r.phase) === 7 || Number(r.invoice_id) === PHASE7_INVOICE_ID)) {
      throw new Error('Phase 7 still linked to profile');
    }

    console.log('\nAFTER dates (Phase 4–6):');
    console.table(
      afterDates.map((r) => ({
        invoice_id: r.invoice_id,
        phase: r.phase,
        issue: r.issue,
        due: r.due,
        status: r.status,
      }))
    );
    console.log('AFTER Phase 7:', {
      invoice_id: afterP7.invoice_id,
      status: afterP7.status,
      profile_id: afterP7.profile_id,
    });
    console.log('AFTER profile/queue:', afterProfile);
    console.log('\nEnrollments AFTER:');
    console.table(await loadEnrollments(client));
    console.log('Remaining profile invoices:');
    console.table(remaining);

    console.log('\nExpected UI:');
    console.log('  Plan status: Active');
    console.log('  Phase 4  Enrollment new          Issued May 25  Due Jun 5   Paid');
    console.log('  Phase 5  Enrollment re enrolled  Issued Jun 25  Due Jul 5   Paid');
    console.log('  Phase 6  Enrollment re enrolled  Issued Jul 25  Due Aug 5   Overdue');
    console.log('  Phase 7  Not Generated');

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
