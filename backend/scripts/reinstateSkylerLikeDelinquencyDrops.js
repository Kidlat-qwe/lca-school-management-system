/**
 * Reinstate delinquency-dropped phases that match the Skyler pattern:
 * - Installment invoice for that phase is Paid, or Partially Paid with Completed payment, OR
 * - A later phase has a Paid installment invoice (class-wide wrongful drop).
 *
 * Usage:
 *   node scripts/reinstateSkylerLikeDelinquencyDrops.js --dry-run
 *   node scripts/reinstateSkylerLikeDelinquencyDrops.js
 *   node scripts/reinstateSkylerLikeDelinquencyDrops.js --student-id=118
 */
import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const dryRun = process.argv.includes('--dry-run');
const studentIdArg = process.argv.find((a) => a.startsWith('--student-id='));
const onlyStudentId = studentIdArg ? parseInt(studentIdArg.split('=')[1], 10) : null;

async function loadPhaseInvoiceMap(client, studentId, classId) {
  const res = await client.query(
    `
    SELECT
      i.invoice_id,
      i.status,
      i.due_date,
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
    `,
    [studentId, classId]
  );
  const byPhase = new Map();
  for (const row of res.rows) {
    byPhase.set(row.local_phase, row);
  }
  return byPhase;
}

function phaseEligibleForReinstate(phaseNumber, byPhase) {
  const maxPhase = Math.max(...byPhase.keys(), 0);
  const inv = byPhase.get(phaseNumber);
  if (inv) {
    if (inv.status === 'Paid') return { ok: true, reason: 'invoice_paid' };
    if (inv.status === 'Partially Paid' && Number(inv.completed_paid) > 0) {
      return { ok: true, reason: 'partial_with_payment' };
    }
  }
  for (let p = phaseNumber + 1; p <= maxPhase; p += 1) {
    if (byPhase.get(p)?.status === 'Paid') {
      return { ok: true, reason: 'later_phase_paid' };
    }
  }
  return { ok: false, reason: 'no_paid_evidence' };
}

async function main() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    let sql = `
      SELECT cs.classstudent_id, cs.student_id, cs.class_id, COALESCE(cs.phase_number, 1) AS phase_number,
             u.full_name, u.email, c.class_name
      FROM classstudentstbl cs
      INNER JOIN userstbl u ON u.user_id = cs.student_id
      INNER JOIN classestbl c ON c.class_id = cs.class_id
      WHERE cs.program_enrollment_status = 'dropped'
        AND cs.removed_reason ILIKE '%Installment delinquency%'
    `;
    const params = [];
    if (Number.isFinite(onlyStudentId)) {
      params.push(onlyStudentId);
      sql += ` AND cs.student_id = $1`;
    }
    sql += ' ORDER BY u.full_name, cs.class_id, cs.phase_number';

    const dropped = await client.query(sql, params);
    const mapCache = new Map();
    let reinstated = 0;
    let skipped = 0;

    for (const row of dropped.rows) {
      const cacheKey = `${row.student_id}:${row.class_id}`;
      if (!mapCache.has(cacheKey)) {
        mapCache.set(
          cacheKey,
          await loadPhaseInvoiceMap(client, row.student_id, row.class_id)
        );
      }
      const byPhase = mapCache.get(cacheKey);
      const phase = parseInt(row.phase_number, 10) || 1;
      const { ok, reason } = phaseEligibleForReinstate(phase, byPhase);

      if (!ok) {
        skipped += 1;
        console.log(
          `[skip] ${row.full_name} class ${row.class_id} phase ${phase} — ${reason}`
        );
        continue;
      }

      const status = phase === 1 ? 'new' : 're_enrolled';
      console.log(
        `${dryRun ? '[dry-run] ' : ''}Reinstate ${row.full_name} (${row.email}) ` +
          `class ${row.class_name} phase ${phase} -> ${status} (${reason})`
      );

      if (!dryRun) {
        await client.query(
          `UPDATE classstudentstbl
           SET program_enrollment_status = $1,
               removed_at = NULL,
               removed_reason = NULL,
               removed_by = NULL
           WHERE classstudent_id = $2`,
          [status, row.classstudent_id]
        );
      }
      reinstated += 1;
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log(`\nDry run: would reinstate ${reinstated} row(s), skip ${skipped}.`);
    } else {
      await client.query('COMMIT');
      console.log(`\nDone: reinstated ${reinstated} row(s), skipped ${skipped}.`);
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
