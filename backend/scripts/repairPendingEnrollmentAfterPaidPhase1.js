/**
 * Promote students stuck in pending_enrollment when Phase 1 installment invoice is already Paid.
 *
 * Usage:
 *   node scripts/repairPendingEnrollmentAfterPaidPhase1.js
 *   node scripts/repairPendingEnrollmentAfterPaidPhase1.js --student-email=bronny@gmail.com
 */
import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { promotePendingEnrollmentIfPhaseInvoicePaid } from '../utils/enrollmentStatus.js';

const studentEmailFilter = (() => {
  const arg = process.argv.find((a) => a.startsWith('--student-email='));
  return arg ? arg.split('=').slice(1).join('=').trim().toLowerCase() : null;
})();

async function main() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    let sql = `
      SELECT cs.student_id, cs.class_id, cs.phase_number, u.email, u.full_name,
             i.invoice_id, i.invoice_description, i.status, i.remarks, i.installmentinvoiceprofiles_id
      FROM classstudentstbl cs
      JOIN userstbl u ON u.user_id = cs.student_id
      JOIN invoicestudentstbl ist ON ist.student_id = cs.student_id
      JOIN invoicestbl i ON i.invoice_id = ist.invoice_id
      WHERE cs.program_enrollment_status = 'pending_enrollment'
        AND cs.removed_at IS NULL
        AND i.status = 'Paid'
        AND (
          i.remarks ILIKE '%TARGET_PHASE:%'
          OR i.remarks ILIKE '%auto-generated from installment invoice%'
        )
    `;
    const params = [];
    if (studentEmailFilter) {
      params.push(studentEmailFilter);
      sql += ` AND LOWER(u.email) = $${params.length}`;
    }
    sql += ' ORDER BY cs.classstudent_id, i.invoice_id DESC';

    const rows = await client.query(sql, params);
    const seen = new Set();
    let repaired = 0;

    for (const row of rows.rows) {
      const key = `${row.student_id}:${row.invoice_id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const ok = await promotePendingEnrollmentIfPhaseInvoicePaid(client, {
        studentId: row.student_id,
        invoice: row,
        sourceLabel: 'System (Repaired — installment paid via acknowledgement receipt)',
      });
      if (ok) {
        repaired += 1;
        console.log(`Repaired: ${row.full_name} (${row.email}) via invoice ${row.invoice_id}`);
      }
    }

    await client.query('COMMIT');
    console.log(`Done. Promoted ${repaired} enrollment row(s).`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Repair failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
