/**
 * CHLOE SOFIA M. EVANGELISTA — extend installment plan to absolute Phase 10.
 *
 * Student: 270 · jhec292000@yahoo.com
 * Profile: 448 · class 53 VMP_NURSERY_TThS_11:00 AM
 *
 * Current:
 *   phase_start 3 · total_phases 7 (UI shows absolute phases 3–9)
 *   INV-1533 remarks already include PHASE_END:10
 *   Enrollments: phases 3–6 only (no phase 7+ enrollment)
 *   Invoices generated through Phase 7 (paid)
 *
 * Target:
 *   total_phases 8 → absolute phases 3–10 in installment UI
 *   Phase 10 shows as Not Generated (no invoice, no enrollment)
 *   Do NOT create enrollment rows
 *   Do NOT generate Phase 8/9/10 invoices
 *
 * Run:
 *   node backend/scripts/repairChloeEvangelistaExtendPhase10.js --production
 *   node backend/scripts/repairChloeEvangelistaExtendPhase10.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';

const STUDENT_ID = 270;
const STUDENT_EMAIL = 'jhec292000@yahoo.com';
const PROFILE_ID = 448;
const CLASS_ID = 53;
const CLASS_NAME = 'VMP_NURSERY_TThS_11:00 AM';
const PHASE_START = 3;
const OLD_TOTAL_PHASES = 7;
const NEW_TOTAL_PHASES = 8; // absolute phases 3–10
const FIRST_INVOICE_ID = 1533;

const REPAIR_NOTE =
  'Ops repair 2026-09-02 — Chloe Evangelista extend installment plan total_phases 7→8 (through Phase 10)';

const isApply = process.argv.includes('--apply');

function rewritePhaseEndInRemarks(remarks, phaseEnd) {
  let text = String(remarks || '');
  if (/PHASE_END:\d+/i.test(text)) {
    return text.replace(/PHASE_END:\d+/i, `PHASE_END:${phaseEnd}`);
  }
  return text ? `${text};PHASE_END:${phaseEnd}` : `PHASE_END:${phaseEnd}`;
}

async function loadProfile(client) {
  const r = await client.query(
    `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.class_id, ip.package_id,
            ip.phase_start, ip.total_phases, ip.generated_count, ip.is_active, ip.description,
            c.class_name,
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
    `SELECT classstudent_id, phase_number, program_enrollment_status
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

async function main() {
  console.log(
    `\nChloe Evangelista — extend installment plan to Phase 10` +
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
    if (Number(profile.class_id) !== CLASS_ID || profile.class_name !== CLASS_NAME) {
      throw new Error(`Class mismatch: ${profile.class_id} / ${profile.class_name}`);
    }
    if (Number(profile.phase_start) !== PHASE_START) {
      throw new Error(`phase_start=${profile.phase_start}, expected ${PHASE_START}`);
    }
    if (Number(profile.total_phases) === NEW_TOTAL_PHASES) {
      console.log(`Profile already total_phases=${NEW_TOTAL_PHASES}. Nothing to do.`);
      await client.query('ROLLBACK');
      return;
    }
    if (Number(profile.total_phases) !== OLD_TOTAL_PHASES) {
      throw new Error(
        `total_phases=${profile.total_phases}, expected ${OLD_TOTAL_PHASES} (or already ${NEW_TOTAL_PHASES})`
      );
    }

    const enrollments = await loadEnrollments(client);
    const invoices = await loadProfileInvoices(client);
    const firstInvoice = invoices.find((row) => Number(row.invoice_id) === FIRST_INVOICE_ID);
    if (!firstInvoice) throw new Error(`INV-${FIRST_INVOICE_ID} not found on profile`);

    const maxInvoicePhase = Math.max(
      ...invoices.map((row) => Number(row.parsed_phase || row.target_phase || 0))
    );
    const maxEnrollmentPhase = enrollments.length
      ? Math.max(...enrollments.map((row) => Number(row.phase_number)))
      : 0;

    console.log('\nProfile BEFORE:', {
      phase_start: profile.phase_start,
      total_phases: profile.total_phases,
      generated_count: profile.generated_count,
      is_active: profile.is_active,
      next_gen: profile.next_gen,
      next_month: profile.next_month,
      scheduled: profile.scheduled,
    });
    console.log('\nBEFORE enrollments:');
    console.table(enrollments);
    console.log('\nBEFORE invoices (max phase):', maxInvoicePhase);

    if (enrollments.some((row) => Number(row.phase_number) >= 7)) {
      throw new Error('Unexpected enrollment at phase 7+ — abort before extending plan');
    }
    if (invoices.some((row) => Number(row.parsed_phase || 0) > 10)) {
      throw new Error('Unexpected invoice beyond phase 10');
    }

    const absoluteLastBefore = PHASE_START + OLD_TOTAL_PHASES - 1;
    const absoluteLastAfter = PHASE_START + NEW_TOTAL_PHASES - 1;
    console.log('\nPlanned:');
    console.log(`  • total_phases ${OLD_TOTAL_PHASES} → ${NEW_TOTAL_PHASES}`);
    console.log(`  • Plan range absolute phases ${PHASE_START}–${absoluteLastBefore} → ${PHASE_START}–${absoluteLastAfter}`);
    console.log('  • Keep enrollments at phases 3–6 only');
    console.log('  • Do NOT generate Phase 8/9/10 invoices');
    console.log('  • Ensure INV-1533 PHASE_END:10 (already present or will be set)');

    let firstRemarks = String(firstInvoice.remarks || '');
    const nextFirstRemarks = rewritePhaseEndInRemarks(firstRemarks, absoluteLastAfter);
    if (nextFirstRemarks !== firstRemarks) {
      console.log(`  • INV-${FIRST_INVOICE_ID} PHASE_END → ${absoluteLastAfter}`);
    } else {
      console.log(`  • INV-${FIRST_INVOICE_ID} PHASE_END already ${absoluteLastAfter}`);
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET total_phases = $1
       WHERE installmentinvoiceprofiles_id = $2
         AND student_id = $3`,
      [NEW_TOTAL_PHASES, PROFILE_ID, STUDENT_ID]
    );
    console.log(`✅ Profile total_phases → ${NEW_TOTAL_PHASES}`);

    if (nextFirstRemarks !== firstRemarks) {
      const stamped = firstRemarks.includes(REPAIR_NOTE)
        ? nextFirstRemarks
        : nextFirstRemarks
          ? `${nextFirstRemarks};${REPAIR_NOTE}`
          : REPAIR_NOTE;
      await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
        stamped,
        FIRST_INVOICE_ID,
      ]);
      console.log(`✅ INV-${FIRST_INVOICE_ID} remarks updated`);
    }

    const afterProfile = await loadProfile(client);
    const afterEnrollments = await loadEnrollments(client);
    const phase10Invoice = invoices.find((row) => Number(row.parsed_phase) === 10);

    console.log('\nProfile AFTER:', {
      phase_start: afterProfile.phase_start,
      total_phases: afterProfile.total_phases,
      generated_count: afterProfile.generated_count,
      is_active: afterProfile.is_active,
    });
    console.log('\nAFTER enrollments (unchanged):');
    console.table(afterEnrollments);

    if (Number(afterProfile.total_phases) !== NEW_TOTAL_PHASES) {
      throw new Error(`total_phases ${afterProfile.total_phases} ≠ ${NEW_TOTAL_PHASES}`);
    }
    if (afterEnrollments.length !== enrollments.length) {
      throw new Error('Enrollment rows changed — abort');
    }
    if (phase10Invoice) {
      throw new Error('Phase 10 invoice already exists — unexpected');
    }
    if (maxEnrollmentPhase > 6) {
      throw new Error(`Enrollment extends beyond phase 6 (max ${maxEnrollmentPhase})`);
    }

    console.log('\nExpected UI:');
    console.log('  Phases 3–7 — existing invoices (Phase 7 paid)');
    console.log('  Phase 8 — Not Generated');
    console.log('  Phase 9 — Not Generated');
    console.log('  Phase 10 — Not Generated (new slot)');
    console.log('  Enrollments remain phases 3–6 only');

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
