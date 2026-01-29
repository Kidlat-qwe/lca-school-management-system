import { getClient, query } from '../config/database.js';
import { sendOverduePaymentReminderEmail } from './emailService.js';

const MANILA_TZ = 'Asia/Manila';

async function hasColumn(tableName, columnName) {
  const res = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2
     LIMIT 1`,
    [tableName, columnName]
  );
  return res.rows.length > 0;
}

function isPaidStatus(status) {
  return String(status || '').toLowerCase() === 'paid';
}

/**
 * Auto-send overdue reminder emails once per invoice-student when invoice becomes overdue.
 * Uses invoicestudentstbl.overdue_email_first_sent_at as a one-time marker.
 */
export async function processOverdueInvoiceAutoEmails({ batchLimit = 50 } = {}) {
  const client = await getClient();

  try {
    // If migration not applied yet, skip safely.
    const hasMarker = await hasColumn('invoicestudentstbl', 'overdue_email_first_sent_at');
    if (!hasMarker) {
      return {
        success: true,
        skipped: true,
        reason: 'Column invoicestudentstbl.overdue_email_first_sent_at does not exist (migration not applied).',
        scanned: 0,
        candidates: 0,
        emailed: 0,
        marked: 0,
        errors: 0,
      };
    }

    // Fetch invoice-student rows that are overdue and not yet auto-emailed.
    const candidatesRes = await client.query(
      `
      SELECT
        invs.invoice_student_id,
        invs.invoice_id,
        invs.student_id,
        u.full_name,
        g.guardian_name as parent_name,
        u.email as student_email,
        g.email as guardian_email,
        i.invoice_description,
        i.due_date,
        i.status,
        b.branch_name
      FROM invoicestudentstbl invs
      JOIN invoicestbl i ON i.invoice_id = invs.invoice_id
      JOIN userstbl u ON u.user_id = invs.student_id
      LEFT JOIN LATERAL (
        SELECT guardian_name, email
        FROM guardianstbl
        WHERE student_id = invs.student_id
        ORDER BY guardian_id ASC
        LIMIT 1
      ) g ON TRUE
      LEFT JOIN branchestbl b ON b.branch_id = i.branch_id
      WHERE (
        (u.email IS NOT NULL AND TRIM(u.email) <> '')
        OR (g.email IS NOT NULL AND TRIM(g.email) <> '')
      )
        AND invs.overdue_email_first_sent_at IS NULL
        AND COALESCE(i.status, '') <> 'Paid'
        AND (i.due_date::date < (NOW() AT TIME ZONE '${MANILA_TZ}')::date)
      ORDER BY i.due_date ASC, invs.invoice_student_id ASC
      LIMIT $1
      `,
      [batchLimit]
    );

    const candidates = candidatesRes.rows || [];
    if (candidates.length === 0) {
      return {
        success: true,
        skipped: false,
        scanned: 0,
        candidates: 0,
        emailed: 0,
        marked: 0,
        errors: 0,
      };
    }

    // Group by invoice_id to avoid recomputing totals per student.
    const byInvoice = new Map();
    for (const row of candidates) {
      if (!byInvoice.has(row.invoice_id)) byInvoice.set(row.invoice_id, []);
      byInvoice.get(row.invoice_id).push(row);
    }

    let emailed = 0;
    let marked = 0;
    let errors = 0;

    for (const [invoiceId, rows] of byInvoice.entries()) {
      // Compute outstanding balance (same logic as manual endpoint).
      const itemsResult = await client.query('SELECT * FROM invoiceitemstbl WHERE invoice_id = $1', [invoiceId]);
      const totals = (itemsResult.rows || []).reduce(
        (acc, item) => {
          const amt = Number(item.amount) || 0;
          const discount = Number(item.discount_amount) || 0;
          const penalty = Number(item.penalty_amount) || 0;
          const taxPct = Number(item.tax_percentage) || 0;
          const taxableBase = amt - discount + penalty;
          const tax = taxableBase * (taxPct / 100);
          acc.subtotal += amt;
          acc.discount += discount;
          acc.penalty += penalty;
          acc.tax += tax;
          return acc;
        },
        { subtotal: 0, discount: 0, penalty: 0, tax: 0 }
      );
      const grandTotal = totals.subtotal - totals.discount + totals.penalty + totals.tax;

      const paymentsResult = await client.query(
        `SELECT COALESCE(SUM(payable_amount), 0) as total_payments FROM paymentstbl WHERE invoice_id = $1`,
        [invoiceId]
      );
      const totalPayments = Number(paymentsResult.rows[0]?.total_payments || 0);
      const outstandingBalance = grandTotal - totalPayments;

      // Optional: fetch class name.
      let className = null;
      try {
        const enrollmentResult = await client.query(
          `SELECT c.class_name
           FROM enrollmentstbl e
           JOIN classestbl c ON e.class_id = c.class_id
           JOIN invoicestudentstbl inv_student ON e.student_id = inv_student.student_id
           WHERE inv_student.invoice_id = $1
           LIMIT 1`,
          [invoiceId]
        );
        if (enrollmentResult.rows.length > 0) className = enrollmentResult.rows[0].class_name;
      } catch {
        // optional; ignore
      }

      // Send to each student linked (only once per invoice-student).
      for (const r of rows) {
        try {
          // Guard: if invoice is paid now, skip.
          if (isPaidStatus(r.status)) continue;

          await sendOverduePaymentReminderEmail({
            to: Array.from(
              new Set([r.guardian_email, r.student_email].filter((e) => e && String(e).trim() !== ''))
            ),
            parentName: r.parent_name || null,
            studentName: r.full_name,
            invoiceId: invoiceId,
            invoiceNumber: r.invoice_description || `INV-${invoiceId}`,
            invoiceDescription: r.invoice_description || `INV-${invoiceId}`,
            amount: outstandingBalance,
            dueDate: r.due_date,
            className,
            centerName: r.branch_name || null,
            facebookLink: 'https://www.facebook.com/littlechampionsacademy',
          });

          emailed += 1;

          // Mark as auto-sent (Asia/Manila time).
          await client.query(
            `UPDATE invoicestudentstbl
             SET overdue_email_first_sent_at = (NOW() AT TIME ZONE '${MANILA_TZ}')::timestamp
             WHERE invoice_student_id = $1
               AND overdue_email_first_sent_at IS NULL`,
            [r.invoice_student_id]
          );
          marked += 1;
        } catch (e) {
          errors += 1;
          console.error(
            `[AutoOverdueEmail] Failed sending/marking invoice_student_id=${r.invoice_student_id} invoice_id=${invoiceId}:`,
            e
          );
        }
      }
    }

    return {
      success: true,
      skipped: false,
      scanned: 0,
      candidates: candidates.length,
      emailed,
      marked,
      errors,
    };
  } finally {
    client.release();
  }
}

