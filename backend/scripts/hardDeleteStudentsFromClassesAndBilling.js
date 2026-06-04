/**
 * One-off script: hard delete selected students from class + billing records.
 *
 * What it removes (target students only):
 * - classstudentstbl rows (hard delete; bypasses unenroll flow)
 * - paymenttbl rows tied to target invoices or target students
 * - installmentinvoicestbl rows for target installment profiles
 * - invoicestudentstbl rows for target invoices
 * - invoiceitemstbl rows for target invoices
 * - invoicestbl rows directly linked to target students/profiles (+ chain-linked balance invoices)
 * - installmentinvoiceprofilestbl rows for target students
 *
 * Daily Summary Sales / Cash Deposit alignment:
 * - Before deleting payments, collects each affected (branch_id, issue_date).
 * - After payment deletes, recomputes End-of-Day totals (completed payments + standalone AR for that date),
 *   matching backend routes/dailySummarySales.js getEodGrandTotalsOnly.
 * - Updates daily_summary_salestbl snapshots for those dates; if the day has no remaining sales rows,
 *   deletes the daily summary row so it disappears from the Daily Summary Sales page.
 * - Refreshes any cash_deposit_summarytbl whose period overlapped removed payments (cash snapshot JSON),
 *   matching routes/cashDepositSummaries.js getCashDepositSnapshot.
 *
 * Notes:
 * - Uses a single transaction (all-or-nothing).
 * - This is intentionally destructive and irreversible.
 * - It does NOT mark students as dropped/unenrolled because records are deleted.
 *
 * Run:
 *   node backend/scripts/hardDeleteStudentsFromClassesAndBilling.js
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const isDryRun = process.argv.includes('--dry-run');

const TARGET_STUDENT_EMAILS = [
  'aklas@gmail.com',
  ,
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Same aggregation as backend getEodGrandTotalsOnly (completed payments + standalone AR). */
async function computeEodGrandTotals(client, branchId, summaryDateYmd) {
  const sumRes = await client.query(
    `SELECT COALESCE(SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)), 0) AS total,
            COUNT(*)::int AS payment_count
     FROM paymenttbl p
     WHERE p.branch_id = $1
       AND p.issue_date = $2::date
       AND p.status = 'Completed'`,
    [branchId, summaryDateYmd]
  );
  const arRes = await client.query(
    `SELECT COALESCE(SUM(COALESCE(ar.payment_amount, 0) + COALESCE(ar.tip_amount, 0)), 0) AS ar_total,
            COUNT(*)::int AS ar_count
     FROM acknowledgement_receiptstbl ar
     WHERE ar.branch_id = $1
       AND ar.issue_date = $2::date
       AND COALESCE(ar.status, 'Submitted') NOT IN ('Rejected', 'Cancelled', 'Applied')
       AND ar.payment_id IS NULL
       AND ar.invoice_id IS NULL`,
    [branchId, summaryDateYmd]
  );
  const paymentTotal = round2(sumRes.rows[0]?.total ?? 0);
  const completedPaymentCount = parseInt(sumRes.rows[0]?.payment_count ?? 0, 10);
  const arTotal = round2(arRes.rows[0]?.ar_total ?? 0);
  const arCount = parseInt(arRes.rows[0]?.ar_count ?? 0, 10);
  const total = round2(paymentTotal + arTotal);
  const paymentCount = completedPaymentCount + arCount;
  return { total, paymentCount };
}

/**
 * Re-fetch cash deposit snapshot (Cash rows only in range) — aligned with cashDepositSummaries.js.
 */
async function computeCashDepositSnapshot(client, branchId, startDate, endDate) {
  const result = await client.query(
    `SELECT p.payment_id,
            p.invoice_id,
            p.student_id,
            p.branch_id,
            p.payment_method,
            p.payment_type,
            p.payable_amount,
            COALESCE(p.tip_amount, 0) AS tip_amount,
            TO_CHAR(p.issue_date, 'YYYY-MM-DD') AS issue_date,
            p.status,
            p.reference_number,
            p.remarks,
            p.payment_attachment_url,
            p.created_by,
            TO_CHAR(p.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
            p.approval_status,
            p.approved_by,
            TO_CHAR(p.approved_at, 'YYYY-MM-DD HH24:MI:SS') AS approved_at,
            u.full_name AS student_name,
            u.email AS student_email,
            i.invoice_description,
            i.amount AS invoice_amount,
            COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
            approver.full_name AS approved_by_name,
            ar.prospect_student_name AS ar_prospect_student_name
     FROM paymenttbl p
     LEFT JOIN userstbl u ON p.student_id = u.user_id
     LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
     LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
     LEFT JOIN userstbl approver ON p.approved_by = approver.user_id
     LEFT JOIN acknowledgement_receiptstbl ar ON ar.payment_id = p.payment_id
     WHERE p.branch_id = $1
       AND LOWER(TRIM(COALESCE(p.payment_method, ''))) = 'cash'
       AND p.issue_date >= $2::date
       AND p.issue_date <= $3::date
     ORDER BY p.issue_date ASC, p.payment_id ASC`,
    [branchId, startDate, endDate]
  );

  let totalDepositAmount = 0;
  let totalCashAmount = 0;
  let completedCashCount = 0;

  const payments = (result.rows || []).map((row) => {
    let studentName = row.student_name;
    let studentEmail = row.student_email;
    const isWalkIn = (studentEmail || '').toLowerCase() === 'walkin@merchandise.psms.internal';
    const prospectName = row.ar_prospect_student_name || null;

    if (isWalkIn && prospectName) {
      studentName = prospectName;
      studentEmail = null;
    }

    const payable = parseFloat(row.payable_amount) || 0;
    const tip = parseFloat(row.tip_amount) || 0;
    const lineAmount = payable + tip;
    totalCashAmount += lineAmount;

    if (row.status === 'Completed') {
      totalDepositAmount += lineAmount;
      completedCashCount += 1;
    }

    return {
      ...row,
      student_name: studentName,
      student_email: studentEmail,
    };
  });

  return {
    total_deposit_amount: round2(totalDepositAmount),
    total_cash_amount: round2(totalCashAmount),
    payment_count: payments.length,
    completed_cash_count: completedCashCount,
    payments,
  };
}

async function syncDailySummariesAfterPaymentRemoval(client, affectedDateRows, dryRun) {
  let updated = 0;
  let deleted = 0;
  let skipped = 0;

  for (const row of affectedDateRows) {
    const branchId = row.branch_id;
    const ymd = row.ymd;
    const existsRes = await client.query(
      `SELECT daily_summary_id FROM daily_summary_salestbl
       WHERE branch_id = $1 AND summary_date = $2::date`,
      [branchId, ymd]
    );
    if (existsRes.rows.length === 0) {
      skipped += 1;
      continue;
    }

    const { total, paymentCount } = await computeEodGrandTotals(client, branchId, ymd);
    const id = existsRes.rows[0].daily_summary_id;

    if (total === 0 && paymentCount === 0) {
      if (dryRun) {
        deleted += 1;
      } else {
        await client.query(`DELETE FROM daily_summary_salestbl WHERE daily_summary_id = $1`, [id]);
        deleted += 1;
      }
      continue;
    }

    if (dryRun) {
      updated += 1;
    } else {
      await client.query(
        `UPDATE daily_summary_salestbl
         SET total_amount = $1,
             payment_count = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE daily_summary_id = $3`,
        [total, paymentCount, id]
      );
      updated += 1;
    }
  }

  return { updated, deleted, skipped };
}

async function syncCashDepositSummariesAfterPaymentRemoval(client, cashSummaryRows) {
  let updated = 0;

  for (const r of cashSummaryRows) {
    const snap = await computeCashDepositSnapshot(client, r.branch_id, r.start_date, r.end_date);
    await client.query(
      `UPDATE cash_deposit_summarytbl
       SET total_deposit_amount = $1,
           total_cash_amount = $2,
           payment_count = $3,
           completed_cash_count = $4,
           cash_payment_snapshot = $5::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE cash_deposit_summary_id = $6`,
      [
        snap.total_deposit_amount,
        snap.total_cash_amount,
        snap.payment_count,
        snap.completed_cash_count,
        JSON.stringify(snap.payments || []),
        r.cash_deposit_summary_id,
      ]
    );
    updated += 1;
  }

  return { updated };
}

async function main() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const studentResult = await client.query(
      `SELECT user_id, full_name, email
       FROM userstbl
       WHERE user_type = 'Student'
         AND email = ANY($1::text[])`,
      [TARGET_STUDENT_EMAILS]
    );

    if (studentResult.rows.length === 0) {
      console.log('No matching student accounts found for provided emails.');
      await client.query('ROLLBACK');
      return;
    }

    const students = studentResult.rows;
    const studentIds = students.map((s) => s.user_id);
    console.log('Target students:', students.map((s) => `${s.full_name} <${s.email}>`).join(', '));

    const profileResult = await client.query(
      `SELECT installmentinvoiceprofiles_id
       FROM installmentinvoiceprofilestbl
       WHERE student_id = ANY($1::int[])`,
      [studentIds]
    );
    const profileIds = profileResult.rows.map((r) => r.installmentinvoiceprofiles_id);

    const invoiceDirectResult = await client.query(
      `SELECT DISTINCT i.invoice_id
       FROM invoicestbl i
       LEFT JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
       WHERE ist.student_id = ANY($1::int[])
          OR i.installmentinvoiceprofiles_id = ANY(COALESCE($2::int[], ARRAY[]::int[]))`,
      [studentIds, profileIds]
    );
    const baseInvoiceIds = invoiceDirectResult.rows.map((r) => r.invoice_id);

    const chainInvoiceResult = await client.query(
      `SELECT DISTINCT i2.invoice_id
       FROM invoicestbl i2
       WHERE i2.invoice_id = ANY(COALESCE($1::int[], ARRAY[]::int[]))
          OR i2.invoice_chain_root_id = ANY(COALESCE($1::int[], ARRAY[]::int[]))`,
      [baseInvoiceIds]
    );
    const invoiceIds = chainInvoiceResult.rows.map((r) => r.invoice_id);

    const affectedDatesRes = await client.query(
      `SELECT DISTINCT p.branch_id,
              TO_CHAR(p.issue_date, 'YYYY-MM-DD') AS ymd
       FROM paymenttbl p
       WHERE p.student_id = ANY($1::int[])
          OR p.invoice_id = ANY(COALESCE($2::int[], ARRAY[]::int[]))`,
      [studentIds, invoiceIds]
    );
    const affectedDateRows = affectedDatesRes.rows;

    const cashSummariesRes = await client.query(
      `SELECT DISTINCT cds.cash_deposit_summary_id,
              cds.branch_id,
              TO_CHAR(cds.start_date, 'YYYY-MM-DD') AS start_date,
              TO_CHAR(cds.end_date, 'YYYY-MM-DD') AS end_date
       FROM cash_deposit_summarytbl cds
       INNER JOIN paymenttbl p ON p.branch_id = cds.branch_id
         AND p.issue_date >= cds.start_date
         AND p.issue_date <= cds.end_date
       WHERE (p.student_id = ANY($1::int[]) OR p.invoice_id = ANY(COALESCE($2::int[], ARRAY[]::int[])))`,
      [studentIds, invoiceIds]
    );
    const cashSummaryRows = cashSummariesRes.rows;

    const classDelete = await client.query(
      `${isDryRun ? 'SELECT COUNT(*)::int AS count FROM classstudentstbl' : 'DELETE FROM classstudentstbl'}
       WHERE student_id = ANY($1::int[])`,
      [studentIds]
    );

    const paymentDelete = await client.query(
      `${isDryRun ? 'SELECT COUNT(*)::int AS count FROM paymenttbl' : 'DELETE FROM paymenttbl'}
       WHERE student_id = ANY($1::int[])
          OR invoice_id = ANY(COALESCE($2::int[], ARRAY[]::int[]))`,
      [studentIds, invoiceIds]
    );

    let dailySync = { updated: 0, deleted: 0, skipped: 0 };
    let cashSync = { updated: 0 };

    if (!isDryRun && affectedDateRows.length > 0) {
      dailySync = await syncDailySummariesAfterPaymentRemoval(client, affectedDateRows, false);
    }
    if (!isDryRun && cashSummaryRows.length > 0) {
      cashSync = await syncCashDepositSummariesAfterPaymentRemoval(client, cashSummaryRows);
    }

    const installmentInvoicesDelete = await client.query(
      `${isDryRun ? 'SELECT COUNT(*)::int AS count FROM installmentinvoicestbl' : 'DELETE FROM installmentinvoicestbl'}
       WHERE installmentinvoiceprofiles_id = ANY(COALESCE($1::int[], ARRAY[]::int[]))`,
      [profileIds]
    );

    const invoiceStudentsDelete = await client.query(
      `${isDryRun ? 'SELECT COUNT(*)::int AS count FROM invoicestudentstbl' : 'DELETE FROM invoicestudentstbl'}
       WHERE invoice_id = ANY(COALESCE($1::int[], ARRAY[]::int[]))
          OR student_id = ANY($2::int[])`,
      [invoiceIds, studentIds]
    );

    const invoiceItemsDelete = await client.query(
      `${isDryRun ? 'SELECT COUNT(*)::int AS count FROM invoiceitemstbl' : 'DELETE FROM invoiceitemstbl'}
       WHERE invoice_id = ANY(COALESCE($1::int[], ARRAY[]::int[]))`,
      [invoiceIds]
    );

    const invoicesDelete = await client.query(
      `${isDryRun ? 'SELECT COUNT(*)::int AS count FROM invoicestbl' : 'DELETE FROM invoicestbl'}
       WHERE invoice_id = ANY(COALESCE($1::int[], ARRAY[]::int[]))`,
      [invoiceIds]
    );

    const profileDelete = await client.query(
      `${isDryRun ? 'SELECT COUNT(*)::int AS count FROM installmentinvoiceprofilestbl' : 'DELETE FROM installmentinvoiceprofilestbl'}
       WHERE installmentinvoiceprofiles_id = ANY(COALESCE($1::int[], ARRAY[]::int[]))
          OR student_id = ANY($2::int[])`,
      [profileIds, studentIds]
    );

    const getAffected = (result) =>
      isDryRun ? (parseInt(result.rows?.[0]?.count, 10) || 0) : result.rowCount;

    if (isDryRun) {
      await client.query('ROLLBACK');
      console.log('DRY RUN ONLY (no data changed).');
      console.log(`- classstudentstbl would delete: ${getAffected(classDelete)}`);
      console.log(`- paymenttbl would delete: ${getAffected(paymentDelete)}`);
      console.log(`- installmentinvoicestbl would delete: ${getAffected(installmentInvoicesDelete)}`);
      console.log(`- invoicestudentstbl would delete: ${getAffected(invoiceStudentsDelete)}`);
      console.log(`- invoiceitemstbl would delete: ${getAffected(invoiceItemsDelete)}`);
      console.log(`- invoicestbl would delete: ${getAffected(invoicesDelete)}`);
      console.log(`- installmentinvoiceprofilestbl would delete: ${getAffected(profileDelete)}`);
      console.log(
        `- daily_summary_salestbl: after payment removal, ${affectedDateRows.length} branch-date pair(s) will be reconciled (update totals or delete row if day is empty)`
      );
      console.log(
        `- cash_deposit_summarytbl: ${cashSummaryRows.length} overlapping summary row(s) will refresh cash snapshot`
      );
    } else {
      await client.query('COMMIT');
      console.log('Hard delete completed successfully.');
      console.log(`- classstudentstbl deleted: ${getAffected(classDelete)}`);
      console.log(`- paymenttbl deleted: ${getAffected(paymentDelete)}`);
      console.log(`- installmentinvoicestbl deleted: ${getAffected(installmentInvoicesDelete)}`);
      console.log(`- invoicestudentstbl deleted: ${getAffected(invoiceStudentsDelete)}`);
      console.log(`- invoiceitemstbl deleted: ${getAffected(invoiceItemsDelete)}`);
      console.log(`- invoicestbl deleted: ${getAffected(invoicesDelete)}`);
      console.log(`- installmentinvoiceprofilestbl deleted: ${getAffected(profileDelete)}`);
      console.log(
        `- daily_summary_salestbl: updated snapshots ${dailySync.updated}, removed empty rows ${dailySync.deleted}, skipped (no prior EOD row) ${dailySync.skipped}`
      );
      console.log(`- cash_deposit_summarytbl: refreshed ${cashSync.updated} row(s)`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Hard delete failed. Transaction rolled back.');
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
