/**
 * Kirsten Celesse J. Mahinay — ensure installment data supports late-start display:
 *   - Hide plan slot 1 (late_start_gap) in Installment Plan modal
 *   - Phase progress: 2/9 complete, 3/10 paid (downpayment + 2 paid phases), 3/10 generated
 *
 * Data fixes (when --apply):
 *   - Soft-remove erroneous class phase 1 enrollment (if still active)
 *   - Ensure phase 2 (new) and phase 3 (re_enrolled) enrollment rows exist
 *   - TARGET_PHASE 2/3/4 on INV-311/571/1012
 *   - profile.generated_count = 3, downpayment_paid = true
 *   - Detach cancelled orphan INV-1511 from profile if still linked
 *
 * UI rules (late_start_gap) are applied in the phases API + InstallmentPlanDetails —
 * redeploy backend/frontend after running this script.
 *
 * Run:
 *   node backend/scripts/repairKirstenMahinayInstallmentProgressDisplay.js --dry-run
 *   node backend/scripts/repairKirstenMahinayInstallmentProgressDisplay.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';

const STUDENT_EMAIL = 'cherryjaodmd@gmail.com';
const STUDENT_ID = 109;
const CLASS_ID = 47;
const PROFILE_ID = 123;
const DOWNPAYMENT_INVOICE_ID = 310;
const ORPHAN_INVOICE_ID = 1511;

const PHASE_INVOICES = {
  2: 311,
  3: 571,
  4: 1012,
};

const isDryRun = !process.argv.includes('--apply');

const client = await getClient();

try {
  await client.query('BEGIN');
  const student = (
    await client.query(`SELECT user_id, full_name FROM userstbl WHERE email = $1`, [STUDENT_EMAIL])
  ).rows[0];
  if (!student) throw new Error(`Student not found: ${STUDENT_EMAIL}`);

  const profile = (
    await client.query(`SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`, [
      PROFILE_ID,
    ])
  ).rows[0];
  if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);

  console.log(
    `\nKirsten installment progress display repair${isDryRun ? ' (DRY RUN)' : ' (APPLY)'}\n`
  );

  const changes = [];

  // --- Enrollment: phase 1 soft-removed; phases 2 & 3 active ---
  const enrollRows = (
    await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status, removed_at
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number, classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    )
  ).rows;

  const activePh1 = enrollRows.find(
    (r) => Number(r.phase_number) === 1 && r.removed_at == null
  );
  if (activePh1) {
    changes.push(`Soft-remove class phase 1 enrollment (classstudent_id ${activePh1.classstudent_id})`);
    if (!isDryRun) {
      await client.query(
        `UPDATE classstudentstbl SET removed_at = CURRENT_TIMESTAMP WHERE classstudent_id = $1`,
        [activePh1.classstudent_id]
      );
    }
  }

  const activePh2 = enrollRows.find(
    (r) => Number(r.phase_number) === 2 && r.removed_at == null
  );
  if (!activePh2) {
    changes.push('Insert class phase 2 enrollment (new)');
    if (!isDryRun) {
      await client.query(
        `INSERT INTO classstudentstbl (student_id, class_id, phase_number, program_enrollment_status, enrolled_at)
         VALUES ($1, $2, 2, 'new', CURRENT_TIMESTAMP)`,
        [STUDENT_ID, CLASS_ID]
      );
    }
  } else if (activePh2.program_enrollment_status !== 'new') {
    changes.push(`Set phase 2 enrollment to new (was ${activePh2.program_enrollment_status})`);
    if (!isDryRun) {
      await client.query(
        `UPDATE classstudentstbl SET program_enrollment_status = 'new' WHERE classstudent_id = $1`,
        [activePh2.classstudent_id]
      );
    }
  }

  const activePh3 = enrollRows.find(
    (r) => Number(r.phase_number) === 3 && r.removed_at == null
  );
  if (!activePh3) {
    changes.push('Insert class phase 3 enrollment (re_enrolled)');
    if (!isDryRun) {
      await client.query(
        `INSERT INTO classstudentstbl (student_id, class_id, phase_number, program_enrollment_status, enrolled_at)
         VALUES ($1, $2, 3, 're_enrolled', CURRENT_TIMESTAMP)`,
        [STUDENT_ID, CLASS_ID]
      );
    }
  } else if (activePh3.program_enrollment_status !== 're_enrolled') {
    changes.push(`Set phase 3 enrollment to re_enrolled (was ${activePh3.program_enrollment_status})`);
    if (!isDryRun) {
      await client.query(
        `UPDATE classstudentstbl SET program_enrollment_status = 're_enrolled' WHERE classstudent_id = $1`,
        [activePh3.classstudent_id]
      );
    }
  }

  // --- TARGET_PHASE on installment invoices ---
  for (const [slot, invoiceId] of Object.entries(PHASE_INVOICES)) {
    const row = (
      await client.query(`SELECT remarks FROM invoicestbl WHERE invoice_id = $1`, [invoiceId])
    ).rows[0];
    const current = parseTargetPhase(row?.remarks);
    const expected = Number(slot);
    if (current !== expected) {
      const next = rewriteTargetPhaseInRemarks(row?.remarks, expected);
      changes.push(`INV-${invoiceId}: TARGET_PHASE:${current ?? '—'} → ${expected}`);
      if (!isDryRun) {
        await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
          next,
          invoiceId,
        ]);
      }
    }
  }

  // --- Profile counters ---
  if (Number(profile.generated_count) !== 3) {
    changes.push(`profile.generated_count: ${profile.generated_count} → 3`);
    if (!isDryRun) {
      await client.query(
        `UPDATE installmentinvoiceprofilestbl SET generated_count = 3 WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      );
    }
  }

  if (profile.downpayment_paid !== true) {
    changes.push('profile.downpayment_paid → true');
    if (!isDryRun) {
      await client.query(
        `UPDATE installmentinvoiceprofilestbl SET downpayment_paid = true WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      );
    }
  }

  if (profile.phase_start != null && Number(profile.phase_start) !== 1) {
    changes.push(`profile.phase_start: ${profile.phase_start} → NULL (keep plan slots 1..10; slot 1 is late_start_gap)`);
    if (!isDryRun) {
      await client.query(
        `UPDATE installmentinvoiceprofilestbl SET phase_start = NULL WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      );
    }
  }

  // --- Orphan cancelled invoice ---
  const orphan = (
    await client.query(
      `SELECT invoice_id, installmentinvoiceprofiles_id FROM invoicestbl WHERE invoice_id = $1`,
      [ORPHAN_INVOICE_ID]
    )
  ).rows[0];
  if (orphan?.installmentinvoiceprofiles_id != null) {
    changes.push(`Detach cancelled INV-${ORPHAN_INVOICE_ID} from profile`);
    if (!isDryRun) {
      await client.query(
        `UPDATE invoicestbl
         SET installmentinvoiceprofiles_id = NULL,
             remarks = REGEXP_REPLACE(COALESCE(remarks, ''), ';?TARGET_PHASE:\\d+', '', 'g')
         WHERE invoice_id = $1`,
        [ORPHAN_INVOICE_ID]
      );
    }
  }

  if (!isDryRun && changes.length > 0) {
    await client.query('COMMIT');
  } else if (!isDryRun) {
    await client.query('ROLLBACK');
  }

  console.log(changes.length ? 'Planned/applied changes:' : 'No data changes needed.');
  changes.forEach((c) => console.log(`  • ${c}`));

  console.log('\nExpected Installment Plan modal (after backend + frontend deploy):');
  console.log('  • Phase 1 row hidden (late_start_gap)');
  console.log('  • Table starts at Phase 2 (INV-311 paid) … Phase 10');
  console.log('  • Phase progress: 2/9 complete | 3/10 paid | 3/10 generated');
  console.log('    (paid = downpayment + 2 installment phases; complete = 9 visible plan slots)');

  if (isDryRun && changes.length > 0) {
    console.log('\nRe-run with --apply to write changes.');
  } else if (!isDryRun && changes.length > 0) {
    console.log('\nData updated. Restart backend and refresh the modal.');
  } else {
    console.log('\nRun diagnoseKirstenMahinayInstallmentProgress.js to verify.');
  }
} catch (err) {
  try {
    await client.query('ROLLBACK');
  } catch {
    /* ignore */
  }
  console.error(err);
  process.exit(1);
} finally {
  client.release();
}
