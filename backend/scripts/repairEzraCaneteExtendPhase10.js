/**
 * Ezra Gabrielle M. Cañete — extend installment plan to absolute Phase 10.
 *
 * Student: 599 · jericacanete01@gmail.com
 * Profile: 410 · class 162 VMP_Pre-Kindergarten_MWF 11AM
 *
 * Current:
 *   phase_start 3 · total_phases 7 (UI shows absolute phases 3–9)
 *   Invoices generated through Phase 9 (all paid)
 *   Phase 9 enrollment marked completed (premature — plan not finished)
 *   No Phase 10 invoice
 *
 * Target:
 *   total_phases 8 → absolute phases 3–10 in installment UI
 *   Phase 9 enrollment → re_enrolled
 *   Phase 10 → Not Generated (queue reopened for generation)
 *   If Phase 10 invoice already exists and is Paid → Phase 10 enrollment completed
 *
 * Run:
 *   node backend/scripts/repairEzraCaneteExtendPhase10.js --production
 *   node backend/scripts/repairEzraCaneteExtendPhase10.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { buildPhaseInstallmentSchedule } from '../utils/phaseInstallmentUtils.js';
import { formatYmdLocal } from '../utils/dateUtils.js';

const STUDENT_ID = 599;
const STUDENT_EMAIL = 'jericacanete01@gmail.com';
const PROFILE_ID = 410;
const CLASS_ID = 162;
const CLASS_NAME = 'VMP_Pre-Kindergarten_MWF 11AM';
const PHASE_START = 3;
const OLD_TOTAL_PHASES = 7;
const NEW_TOTAL_PHASES = 8; // absolute phases 3–10
const ABSOLUTE_LAST_PHASE = 10;

const PHASE_9_CLASSSTUDENT_ID = 2476;
const DOWNPAYMENT_INVOICE_ID = 1329;

const REPAIR_NOTE =
  'Ops repair 2026-09-02 — Ezra Cañete extend plan total_phases 7→8 (through Phase 10); P9 completed→re_enrolled';

const isApply = process.argv.includes('--apply');

const ymd = (value) => {
  if (value == null) return null;
  return formatYmdLocal(value).slice(0, 10);
};

function rewritePhaseEndInRemarks(remarks, phaseEnd) {
  let text = String(remarks || '');
  if (/PHASE_END:\d+/i.test(text)) {
    return text.replace(/PHASE_END:\d+/i, `PHASE_END:${phaseEnd}`);
  }
  return text ? `${text};PHASE_END:${phaseEnd}` : `PHASE_END:${phaseEnd}`;
}

function isPaidStatus(status) {
  return String(status || '').trim().toLowerCase() === 'paid';
}

async function loadProfile(client) {
  const r = await client.query(
    `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.class_id, ip.package_id,
            ip.phase_start, ip.total_phases, ip.generated_count, ip.is_active, ip.description,
            ii.installmentinvoicedtl_id,
            TO_CHAR(ii.next_generation_date, 'YYYY-MM-DD') AS next_gen,
            TO_CHAR(ii.next_invoice_month, 'YYYY-MM-DD') AS next_month,
            TO_CHAR(ii.scheduled_date, 'YYYY-MM-DD') AS scheduled,
            ii.status AS queue_status
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
    `SELECT classstudent_id, phase_number, program_enrollment_status,
            TO_CHAR(enrolled_at, 'YYYY-MM-DD') AS enrolled
     FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2 AND removed_at IS NULL
     ORDER BY phase_number, classstudent_id`,
    [STUDENT_ID, CLASS_ID]
  );
  return r.rows;
}

async function loadProfileInvoices(client) {
  const r = await client.query(
    `SELECT invoice_id, status, remarks,
            SUBSTRING(remarks FROM 'TARGET_PHASE:([0-9]+)') AS target_phase
     FROM invoicestbl
     WHERE installmentinvoiceprofiles_id = $1
       AND COALESCE(status, '') NOT IN ('Cancelled', 'Canceled')
     ORDER BY invoice_id`,
    [PROFILE_ID]
  );
  return r.rows.map((row) => ({
    ...row,
    parsed_phase: parseTargetPhase(row.remarks),
  }));
}

async function findPhase10Invoice(client) {
  const invoices = await loadProfileInvoices(client);
  return invoices.find((row) => Number(row.parsed_phase || row.target_phase || 0) === ABSOLUTE_LAST_PHASE) || null;
}

async function computeQueueDates(client, profile) {
  const sched = await buildPhaseInstallmentSchedule({
    db: client,
    profile: {
      ...profile,
      total_phases: NEW_TOTAL_PHASES,
      generated_count: Number(profile.generated_count),
    },
  });

  const nextGen =
    ymd(sched?.next_generation_date) || ymd(sched?.current_generation_date);
  const nextMonth =
    ymd(sched?.next_invoice_month) || ymd(sched?.current_invoice_month);
  const scheduled =
    ymd(sched?.scheduled_date) ||
    ymd(sched?.current_due_date) ||
    ymd(sched?.next_due_date);

  return {
    next_generation_date: nextGen,
    next_invoice_month: nextMonth,
    scheduled_date: scheduled,
    schedule: sched,
  };
}

async function main() {
  console.log(
    `\nEzra Cañete — extend installment plan to Phase 10` +
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
    if (!student) throw new Error('Student not found or email mismatch');
    console.log('Student:', student.full_name, `(id ${student.user_id})`);

    const profile = await loadProfile(client);
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);
    if (Number(profile.class_id) !== CLASS_ID) {
      throw new Error(`Class mismatch: ${profile.class_id}`);
    }
    if (Number(profile.total_phases) === NEW_TOTAL_PHASES) {
      console.log(`Profile already total_phases=${NEW_TOTAL_PHASES}. Checking enrollments only.`);
    } else if (Number(profile.total_phases) !== OLD_TOTAL_PHASES) {
      throw new Error(
        `total_phases=${profile.total_phases}, expected ${OLD_TOTAL_PHASES} (or already ${NEW_TOTAL_PHASES})`
      );
    }
    if (Number(profile.phase_start) !== PHASE_START) {
      throw new Error(`phase_start=${profile.phase_start}, expected ${PHASE_START}`);
    }

    const enrollments = await loadEnrollments(client);
    const invoices = await loadProfileInvoices(client);
    const phase9Enrollment = enrollments.find((row) => Number(row.phase_number) === 9);
    const phase10Enrollment = enrollments.find((row) => Number(row.phase_number) === 10);
    const phase10Invoice = await findPhase10Invoice(client);
    const dpInvoice = invoices.find((row) => Number(row.invoice_id) === DOWNPAYMENT_INVOICE_ID);
    if (!dpInvoice) throw new Error(`INV-${DOWNPAYMENT_INVOICE_ID} not found on profile`);
    if (!phase9Enrollment) throw new Error('Phase 9 enrollment not found');
    if (Number(phase9Enrollment.classstudent_id) !== PHASE_9_CLASSSTUDENT_ID) {
      throw new Error(
        `Phase 9 CS id ${phase9Enrollment.classstudent_id} ≠ expected ${PHASE_9_CLASSSTUDENT_ID}`
      );
    }

    const maxInvoicePhase = Math.max(
      ...invoices.map((row) => Number(row.parsed_phase || row.target_phase || 0))
    );
    const phase10Paid = phase10Invoice && isPaidStatus(phase10Invoice.status);

    console.log('\nProfile BEFORE:', {
      phase_start: profile.phase_start,
      total_phases: profile.total_phases,
      generated_count: profile.generated_count,
      is_active: profile.is_active,
      next_gen: profile.next_gen,
      next_month: profile.next_month,
      scheduled: profile.scheduled,
      queue_status: profile.queue_status,
    });
    console.log('\nBEFORE enrollments:');
    console.table(enrollments);
    console.log('\nBEFORE invoices (max phase):', maxInvoicePhase);
    if (phase10Invoice) {
      console.log('Phase 10 invoice:', {
        invoice_id: phase10Invoice.invoice_id,
        status: phase10Invoice.status,
        paid: phase10Paid,
      });
    } else {
      console.log('Phase 10 invoice: none');
    }

    const queueDates = await computeQueueDates(client, profile);
    console.log('\nComputed queue for Phase 10 generation:', queueDates);

    console.log('\nPlanned:');
    if (Number(profile.total_phases) !== NEW_TOTAL_PHASES) {
      console.log(`  • total_phases ${profile.total_phases} → ${NEW_TOTAL_PHASES}`);
    }
    console.log(`  • INV-${DOWNPAYMENT_INVOICE_ID} PHASE_END → ${ABSOLUTE_LAST_PHASE}`);
    console.log(`  • Phase 9 CS ${PHASE_9_CLASSSTUDENT_ID}: completed → re_enrolled`);
    if (phase10Paid) {
      console.log('  • Phase 10 paid → enrollment completed');
    } else {
      console.log('  • Phase 10 not paid → no Phase 10 enrollment; reopen queue');
      console.log(
        `  • Queue → next_gen ${queueDates.next_generation_date}, next_month ${queueDates.next_invoice_month}`
      );
      console.log('  • Profile is_active → true');
    }

    if (Number(profile.total_phases) !== NEW_TOTAL_PHASES) {
      await client.query(
        `UPDATE installmentinvoiceprofilestbl
         SET total_phases = $1
         WHERE installmentinvoiceprofiles_id = $2
           AND student_id = $3`,
        [NEW_TOTAL_PHASES, PROFILE_ID, STUDENT_ID]
      );
      console.log(`✅ Profile total_phases → ${NEW_TOTAL_PHASES}`);
    }

    let nextDpRemarks = rewritePhaseEndInRemarks(dpInvoice.remarks, ABSOLUTE_LAST_PHASE);
    if (!nextDpRemarks.includes(REPAIR_NOTE)) {
      nextDpRemarks = nextDpRemarks ? `${nextDpRemarks};${REPAIR_NOTE}` : REPAIR_NOTE;
    }
    if (nextDpRemarks !== String(dpInvoice.remarks || '')) {
      await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
        nextDpRemarks,
        DOWNPAYMENT_INVOICE_ID,
      ]);
      console.log(`✅ INV-${DOWNPAYMENT_INVOICE_ID} PHASE_END → ${ABSOLUTE_LAST_PHASE}`);
    }

    if (String(phase9Enrollment.program_enrollment_status) !== 're_enrolled') {
      const upd = await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 're_enrolled'
         WHERE classstudent_id = $1
           AND student_id = $2
           AND class_id = $3
           AND phase_number = 9
         RETURNING classstudent_id, phase_number, program_enrollment_status`,
        [PHASE_9_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
      );
      if (!upd.rows.length) throw new Error('Failed to update Phase 9 enrollment');
      console.log(`✅ Phase 9 enrollment → re_enrolled`);
    } else {
      console.log('ℹ️ Phase 9 already re_enrolled');
    }

    if (phase10Paid) {
      if (phase10Enrollment) {
        if (String(phase10Enrollment.program_enrollment_status) !== 'completed') {
          await client.query(
            `UPDATE classstudentstbl
             SET program_enrollment_status = 'completed'
             WHERE classstudent_id = $1`,
            [phase10Enrollment.classstudent_id]
          );
          console.log(`✅ Phase 10 enrollment → completed`);
        }
      } else {
        await client.query(
          `INSERT INTO classstudentstbl (
             class_id, student_id, phase_number, program_enrollment_status, enrolled_at
           ) VALUES ($1, $2, 10, 'completed', NOW())`,
          [CLASS_ID, STUDENT_ID]
        );
        console.log('✅ Inserted Phase 10 enrollment → completed');
      }
    } else if (!phase10Invoice) {
      if (phase10Enrollment) {
        throw new Error(
          `Unexpected Phase 10 enrollment without paid invoice: CS ${phase10Enrollment.classstudent_id}`
        );
      }

      await client.query(
        `UPDATE installmentinvoiceprofilestbl
         SET is_active = true
         WHERE installmentinvoiceprofiles_id = $1
           AND student_id = $2`,
        [PROFILE_ID, STUDENT_ID]
      );
      console.log('✅ Profile is_active → true');

      if (!profile.installmentinvoicedtl_id) {
        throw new Error('Missing installmentinvoicestbl queue row');
      }
      if (!queueDates.next_generation_date || !queueDates.next_invoice_month) {
        throw new Error('Could not compute queue dates for Phase 10');
      }

      await client.query(
        `UPDATE installmentinvoicestbl
         SET status = NULL,
             next_generation_date = $1::date,
             next_invoice_month = $2::date,
             scheduled_date = COALESCE($3::date, scheduled_date)
         WHERE installmentinvoicedtl_id = $4
           AND installmentinvoiceprofiles_id = $5`,
        [
          queueDates.next_generation_date,
          queueDates.next_invoice_month,
          queueDates.scheduled_date,
          profile.installmentinvoicedtl_id,
          PROFILE_ID,
        ]
      );
      console.log(
        `✅ Queue reopened → ${queueDates.next_generation_date} / ${queueDates.next_invoice_month}`
      );
    } else {
      console.log('ℹ️ Phase 10 invoice exists but unpaid — queue left unchanged');
    }

    const afterProfile = await loadProfile(client);
    const afterEnrollments = await loadEnrollments(client);
    const afterPhase9 = afterEnrollments.find((row) => Number(row.phase_number) === 9);
    const afterPhase10 = afterEnrollments.find((row) => Number(row.phase_number) === 10);

    console.log('\nProfile AFTER:', {
      phase_start: afterProfile.phase_start,
      total_phases: afterProfile.total_phases,
      generated_count: afterProfile.generated_count,
      is_active: afterProfile.is_active,
      next_gen: afterProfile.next_gen,
      next_month: afterProfile.next_month,
      scheduled: afterProfile.scheduled,
    });
    console.log('\nAFTER enrollments:');
    console.table(afterEnrollments);

    if (Number(afterProfile.total_phases) !== NEW_TOTAL_PHASES) {
      throw new Error(`total_phases ${afterProfile.total_phases} ≠ ${NEW_TOTAL_PHASES}`);
    }
    if (!afterPhase9 || String(afterPhase9.program_enrollment_status) !== 're_enrolled') {
      throw new Error('Phase 9 enrollment is not re_enrolled after repair');
    }
    if (phase10Paid) {
      if (!afterPhase10 || String(afterPhase10.program_enrollment_status) !== 'completed') {
        throw new Error('Phase 10 enrollment is not completed after repair');
      }
    } else if (!phase10Invoice && afterPhase10) {
      throw new Error('Unexpected Phase 10 enrollment when invoice not paid');
    }

    console.log('\nExpected UI:');
    console.log('  Phases 3–9 — existing paid invoices');
    console.log('  Phase 9 enrollment — re enrolled');
    if (phase10Paid) {
      console.log('  Phase 10 — Paid · enrollment completed');
    } else {
      console.log('  Phase 10 — Not Generated (new slot)');
      console.log(`  Queue ready for generation on ${queueDates.next_generation_date}`);
    }

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDry run only — rolled back. Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted. Refresh Student History → Installment.');
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
