/**
 * Repair enrollment for students flagged in re-enrollment matrix review:
 * Herby Legaspi, Donna Valero (manual unenroll + paid phases),
 * Andrei Atienza, Maven Mactal (phase_start 6 installment packages).
 *
 * Usage: node scripts/repairMatrixReviewStudents.js
 *        node scripts/repairMatrixReviewStudents.js --dry-run
 */
import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { resolveProfilePhaseStart } from '../utils/phaseInstallmentUtils.js';

const dryRun = process.argv.includes('--dry-run');

async function loadProfileInvoices(client, studentId, classId) {
  const res = await client.query(
    `
    SELECT
      i.invoice_id,
      i.status,
      ip.phase_start,
      COALESCE((
        SELECT SUM(p.payable_amount)
        FROM paymenttbl p
        WHERE p.invoice_id = i.invoice_id AND p.status = 'Completed'
      ), 0) AS completed_paid,
      ROW_NUMBER() OVER (
        ORDER BY i.issue_date ASC NULLS LAST, i.invoice_id ASC
      )::int AS local_phase
    FROM invoicestbl i
    INNER JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
    INNER JOIN installmentinvoiceprofilestbl ip ON ip.installmentinvoiceprofiles_id = i.installmentinvoiceprofiles_id
    WHERE ist.student_id = $1
      AND ip.class_id = $2
      AND COALESCE(i.invoice_description, '') NOT ILIKE '%downpayment%'
    ORDER BY i.issue_date ASC NULLS LAST, i.invoice_id ASC
    `,
    [studentId, classId]
  );
  return res.rows.map((row) => ({
    ...row,
    phase_start: resolveProfilePhaseStart(row),
    absolute_phase: resolveProfilePhaseStart(row) + row.local_phase - 1,
  }));
}

function invoiceEligible(inv) {
  if (inv.status === 'Paid') return true;
  if (inv.status === 'Partially Paid' && Number(inv.completed_paid) > 0) return true;
  return false;
}

async function reinstateRow(client, { classstudentId, status, label }) {
  console.log(`  ${dryRun ? '[dry-run] ' : ''}${label} -> ${status}`);
  if (!dryRun) {
    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = $1,
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL
       WHERE classstudent_id = $2`,
      [status, classstudentId]
    );
  }
}

async function ensurePhaseRow(client, { studentId, classId, absolutePhase, status, enrolledBy }) {
  const existing = await client.query(
    `SELECT classstudent_id, program_enrollment_status
     FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2 AND phase_number = $3
     ORDER BY classstudent_id DESC
     LIMIT 1`,
    [studentId, classId, absolutePhase]
  );

  if (existing.rows.length) {
    const row = existing.rows[0];
    if (row.program_enrollment_status === 'dropped') {
      await reinstateRow(client, {
        classstudentId: row.classstudent_id,
        status,
        label: `Reinstate existing P${absolutePhase} (cs ${row.classstudent_id})`,
      });
    }
    return;
  }

  console.log(
    `  ${dryRun ? '[dry-run] ' : ''}Insert P${absolutePhase} -> ${status} (${enrolledBy})`
  );
  if (!dryRun) {
    await client.query(
      `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number, program_enrollment_status)
       VALUES ($1, $2, $3, $4, $5)`,
      [studentId, classId, enrolledBy, absolutePhase, status]
    );
  }
}

async function fixManualUnenrollPaidPhases(client, { studentId, fullName, classId, phaseStart }) {
  console.log(`\n=== ${fullName} (manual unenroll, phase_start=${phaseStart}) ===`);

  const rows = await client.query(
    `SELECT classstudent_id, phase_number, program_enrollment_status, removed_reason
     FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2
     ORDER BY phase_number`,
    [studentId, classId]
  );

  const invoices = await loadProfileInvoices(client, studentId, classId);
  const paidPhases = new Set(
    invoices.filter(invoiceEligible).map((inv) => inv.absolute_phase)
  );

  for (const row of rows.rows) {
    const phase = parseInt(row.phase_number, 10);
    if (!paidPhases.has(phase)) {
      console.log(`  Skip P${phase} — no paid invoice for this phase`);
      continue;
    }
    if (!String(row.removed_reason || '').includes('unenrolled')) {
      console.log(`  Skip P${phase} — not manual unenroll (${row.removed_reason})`);
      continue;
    }
    const status = phase === phaseStart ? 'new' : 're_enrolled';
    await reinstateRow(client, {
      classstudentId: row.classstudent_id,
      status,
      label: `Reinstate P${phase} (cs ${row.classstudent_id})`,
    });
  }
}

async function fixPhaseStartPackage(client, { studentId, fullName, classId }) {
  console.log(`\n=== ${fullName} (phase-start package) ===`);

  const invoices = await loadProfileInvoices(client, studentId, classId);
  if (!invoices.length) {
    console.log('  No installment invoices');
    return;
  }

  const phaseStart = invoices[0].phase_start;
  const firstPaidAbsolute = invoices.find(invoiceEligible)?.absolute_phase ?? phaseStart;

  for (const inv of invoices) {
    if (!invoiceEligible(inv)) {
      console.log(`  Skip abs P${inv.absolute_phase} — invoice #${inv.invoice_id} ${inv.status}`);
      continue;
    }

    const status =
      inv.absolute_phase === firstPaidAbsolute ? 'new' : 're_enrolled';

    await ensurePhaseRow(client, {
      studentId,
      classId,
      absolutePhase: inv.absolute_phase,
      status,
      enrolledBy: 'System (Reinstated — paid phase after delinquency correction)',
    });
  }

  // Orphan rows below phase_start (e.g. P2 when package starts at P6)
  const orphans = await client.query(
    `SELECT classstudent_id, phase_number, program_enrollment_status
     FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2
       AND phase_number < $3
       AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
       AND removed_at IS NULL`,
    [studentId, classId, phaseStart]
  );
  for (const row of orphans.rows) {
    console.log(
      `  ${dryRun ? '[dry-run] ' : ''}Delete orphan P${row.phase_number} below phase_start (cs ${row.classstudent_id})`
    );
    if (!dryRun) {
      await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
        row.classstudent_id,
      ]);
    }
  }
}

async function main() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    await fixManualUnenrollPaidPhases(client, {
      studentId: 123,
      fullName: 'Herby Luis Legaspi',
      classId: 57,
      phaseStart: 2,
    });

    await fixManualUnenrollPaidPhases(client, {
      studentId: 166,
      fullName: 'Donna Venice M. Valero',
      classId: 57,
      phaseStart: 2,
    });

    await fixPhaseStartPackage(client, {
      studentId: 247,
      fullName: 'Andrei Caleb Ethan V. Atienza',
      classId: 58,
    });

    await fixPhaseStartPackage(client, {
      studentId: 246,
      fullName: 'Maven Janina Mactal',
      classId: 58,
    });

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('\nDry run complete.');
    } else {
      await client.query('COMMIT');
      console.log('\nDone.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
