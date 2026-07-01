/**
 * Find students dropped by installment delinquency who likely should stay enrolled
 * (paid phase invoices, partial payment on overdue invoice, or multiple phases dropped together).
 *
 * Usage: node scripts/findDelinquencyDropMismatchStudents.js
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';

const droppedRows = await query(`
  SELECT
    cs.student_id,
    u.full_name,
    u.email,
    cs.class_id,
    c.class_name,
    cs.classstudent_id,
    COALESCE(cs.phase_number, 1) AS phase_number,
    cs.program_enrollment_status,
    cs.removed_at,
    cs.removed_reason
  FROM classstudentstbl cs
  INNER JOIN userstbl u ON u.user_id = cs.student_id AND u.user_type = 'Student'
  INNER JOIN classestbl c ON c.class_id = cs.class_id
  WHERE cs.program_enrollment_status = 'dropped'
    AND cs.removed_reason ILIKE '%Installment delinquency%'
  ORDER BY u.full_name, cs.class_id, cs.phase_number, cs.classstudent_id
`);

const byStudentClass = new Map();
for (const row of droppedRows.rows) {
  const key = `${row.student_id}:${row.class_id}`;
  if (!byStudentClass.has(key)) {
    byStudentClass.set(key, {
      student_id: row.student_id,
      full_name: row.full_name,
      email: row.email,
      class_id: row.class_id,
      class_name: row.class_name,
      phases: [],
      removed_at_samples: [],
    });
  }
  const g = byStudentClass.get(key);
  g.phases.push(row.phase_number);
  if (row.removed_at) g.removed_at_samples.push(row.removed_at);
}

const studentIds = [...new Set(droppedRows.rows.map((r) => r.student_id))];

const invoiceSummary = studentIds.length
  ? await query(
      `
      SELECT
        ist.student_id,
        ip.class_id,
        i.invoice_id,
        i.status,
        i.due_date,
        i.issue_date,
        COALESCE((
          SELECT SUM(p.payable_amount)
          FROM paymenttbl p
          WHERE p.invoice_id = i.invoice_id AND p.status = 'Completed'
        ), 0) AS completed_paid,
        ROW_NUMBER() OVER (
          PARTITION BY ip.installmentinvoiceprofiles_id
          ORDER BY i.issue_date ASC NULLS LAST, i.invoice_id ASC
        ) AS billing_order
      FROM invoicestbl i
      INNER JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
      INNER JOIN installmentinvoiceprofilestbl ip ON ip.installmentinvoiceprofiles_id = i.installmentinvoiceprofiles_id
      WHERE ist.student_id = ANY($1::int[])
        AND COALESCE(i.invoice_description, '') NOT ILIKE '%downpayment%'
      `,
      [studentIds]
    )
  : { rows: [] };

const invByStudentClass = new Map();
for (const inv of invoiceSummary.rows) {
  const key = `${inv.student_id}:${inv.class_id}`;
  if (!invByStudentClass.has(key)) invByStudentClass.set(key, []);
  invByStudentClass.get(key).push(inv);
}

const candidates = [];

for (const [, g] of byStudentClass) {
  const key = `${g.student_id}:${g.class_id}`;
  const invoices = invByStudentClass.get(key) || [];
  const paidCount = invoices.filter((i) => i.status === 'Paid').length;
  const partialCount = invoices.filter((i) => i.status === 'Partially Paid').length;
  const partialWithPayment = invoices.filter(
    (i) => i.status === 'Partially Paid' && Number(i.completed_paid) > 0
  );
  const unpaidOverdue = invoices.filter(
    (i) => !['Paid', 'Cancelled'].includes(i.status) && i.due_date && new Date(i.due_date) < new Date()
  );

  const droppedPhaseCount = g.phases.length;
  const multiPhaseDrop = droppedPhaseCount > 1;
  const hasPaidPhaseWhileDropped =
    paidCount > 0 && droppedPhaseCount >= paidCount;
  const hasPartialWithPayment = partialWithPayment.length > 0;
  const skylerLike =
    multiPhaseDrop && (hasPaidPhaseWhileDropped || hasPartialWithPayment);

  if (!skylerLike && !hasPartialWithPayment && !(multiPhaseDrop && paidCount >= 2)) {
    continue;
  }

  candidates.push({
    student_id: g.student_id,
    full_name: g.full_name,
    email: g.email,
    class_id: g.class_id,
    class_name: g.class_name,
    dropped_phases: [...g.phases].sort((a, b) => a - b),
    dropped_phase_count: droppedPhaseCount,
    paid_installment_invoices: paidCount,
    partially_paid_invoices: partialCount,
    partial_with_completed_payment: partialWithPayment.map((i) => ({
      invoice_id: i.invoice_id,
      paid: i.completed_paid,
      due_date: i.due_date,
      billing_order: i.billing_order,
    })),
    unpaid_overdue_invoice_ids: unpaidOverdue.map((i) => i.invoice_id),
    removed_at: g.removed_at_samples[0] || null,
    pattern: skylerLike ? 'skyler_like' : 'review',
  });
}

candidates.sort((a, b) => a.full_name.localeCompare(b.full_name));

console.log(`\nTotal delinquency-dropped rows: ${droppedRows.rows.length}`);
console.log(`Student×class tracks with delinquency drop: ${byStudentClass.size}`);
console.log(`Candidates for reinstatement (Skyler-like): ${candidates.length}\n`);

for (const c of candidates) {
  console.log('---');
  console.log(`${c.full_name} <${c.email}>`);
  console.log(`  user_id=${c.student_id} class_id=${c.class_id} (${c.class_name})`);
  console.log(`  Dropped phases: ${c.dropped_phases.join(', ')} (count=${c.dropped_phase_count})`);
  console.log(`  Paid installment invoices: ${c.paid_installment_invoices}`);
  if (c.partial_with_completed_payment.length) {
    console.log('  Partially paid with Completed payment:', c.partial_with_completed_payment);
  }
  if (c.unpaid_overdue_invoice_ids.length) {
    console.log('  Unpaid overdue invoice IDs:', c.unpaid_overdue_invoice_ids.join(', '));
  }
  console.log(`  Removed at: ${c.removed_at}`);
  console.log(`  Reinstate: node scripts/reinstateStudentAfterDelinquencyDrop.js --student-id=${c.student_id}`);
}

if (!candidates.length) {
  console.log('No Skyler-like candidates found with current heuristics.');
}

process.exit(0);
