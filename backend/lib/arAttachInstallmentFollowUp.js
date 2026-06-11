/**
 * After attach-to-invoice pays an installment downpayment, generate Phase 1 (and optionally
 * Phase 2) invoices. For Downpayment + Phase 1 ARs, auto-pay Phase 1 in the same flow.
 */
import { query } from '../config/database.js';
import { formatYmdLocal } from '../utils/dateUtils.js';
import { paymenttblHasActionOwnerUserIdColumn } from '../utils/paymentSchema.js';
import { syncInstallmentEnrollmentForPaidInvoice } from '../utils/installmentEnrollmentSync.js';

/**
 * @param {{
 *   firstInvoiceRecord: object,
 *   profile: object,
 *   profileId: number,
 *   autoPayPhase1?: boolean,
 *   autoPayPhase1Data?: object|null,
 * }} pending
 */
export async function runArAttachInstallmentFollowUp(pending) {
  const { firstInvoiceRecord, profile: genProfile, profileId, autoPayPhase1, autoPayPhase1Data } =
    pending;

  const result = {
    phase1_invoice_id: null,
    phase2_invoice_id: null,
    phase1_auto_paid: false,
    error: null,
  };

  try {
    const { generateInvoiceFromInstallment } = await import('../utils/installmentInvoiceGenerator.js');

    const enrollmentAckReuse =
      autoPayPhase1 &&
      autoPayPhase1Data?.phase_ack_receipt_id &&
      autoPayPhase1Data?.phase_ack_receipt_number
        ? {
            reuseInvoiceArNumber: String(autoPayPhase1Data.phase_ack_receipt_number).trim(),
            ack_receipt_id: Number(autoPayPhase1Data.phase_ack_receipt_id),
          }
        : null;

    const generatedInvoice = await generateInvoiceFromInstallment(
      firstInvoiceRecord,
      genProfile,
      enrollmentAckReuse
    );
    result.phase1_invoice_id = generatedInvoice.invoice_id;

    if (!autoPayPhase1 || !autoPayPhase1Data) {
      return result;
    }

    const {
      student_id: sid,
      branch_id: bid,
      issue_date: ackDate,
      created_by: createdBy,
      ar_verified_by_user_id,
      phase_1_amount,
      profile_id,
      is_cash_ack,
    } = autoPayPhase1Data;

    const phaseApproverUserId = ar_verified_by_user_id || createdBy || null;
    const phase1InvoiceId = generatedInvoice.invoice_id;
    const phase1InvRow = await query('SELECT created_by FROM invoicestbl WHERE invoice_id = $1', [
      phase1InvoiceId,
    ]);
    const phase1ActionOwner =
      phase1InvRow.rows[0]?.created_by != null ? phase1InvRow.rows[0].created_by : createdBy;

    const approvalStatus = is_cash_ack ? 'Pending' : 'Approved';
    const approvedBy = is_cash_ack ? null : phaseApproverUserId;
    const approvedAtSql = is_cash_ack ? 'NULL' : 'CURRENT_TIMESTAMP';

    const hasColPhase1 = await paymenttblHasActionOwnerUserIdColumn();
    const paymentParams = [
      phase1InvoiceId,
      sid,
      bid,
      phase_1_amount,
      ackDate,
      approvalStatus,
      approvedBy,
      autoPayPhase1Data.reference_number || null,
      'Phase 1 auto-paid via acknowledgement receipt (Downpayment + Phase 1 option)',
      createdBy,
      autoPayPhase1Data.payment_attachment_url || null,
    ];

    let phase1PaymentId = null;
    if (hasColPhase1) {
      const payRes = await query(
        `INSERT INTO paymenttbl (invoice_id, student_id, branch_id, payment_method, payment_type,
         payable_amount, issue_date, status, approval_status, approved_by, approved_at, reference_number, remarks, created_by, payment_attachment_url, action_owner_user_id)
         VALUES ($1, $2, $3, 'Cash', 'Installment', $4, $5, 'Completed', $6, $7, ${approvedAtSql}, $8, $9, $10, $11, $12)
         RETURNING payment_id`,
        [...paymentParams, phase1ActionOwner]
      );
      phase1PaymentId = payRes.rows[0]?.payment_id ?? null;
    } else {
      const payRes = await query(
        `INSERT INTO paymenttbl (invoice_id, student_id, branch_id, payment_method, payment_type,
         payable_amount, issue_date, status, approval_status, approved_by, approved_at, reference_number, remarks, created_by, payment_attachment_url)
         VALUES ($1, $2, $3, 'Cash', 'Installment', $4, $5, 'Completed', $6, $7, ${approvedAtSql}, $8, $9, $10, $11)
         RETURNING payment_id`,
        paymentParams
      );
      phase1PaymentId = payRes.rows[0]?.payment_id ?? null;
    }

    await query(`UPDATE invoicestbl SET status = 'Paid', amount = 0 WHERE invoice_id = $1`, [
      phase1InvoiceId,
    ]);
    result.phase1_auto_paid = true;

    if (autoPayPhase1Data.phase_ack_receipt_id) {
      await query(
        `UPDATE acknowledgement_receiptstbl
         SET status = 'Applied', student_id = $1, invoice_id = $2, payment_id = $3
         WHERE ack_receipt_id = $4`,
        [sid, phase1InvoiceId, phase1PaymentId, autoPayPhase1Data.phase_ack_receipt_id]
      );
    }

    const profileRowRes = await query(
      `SELECT ip.class_id, ip.student_id, ip.total_phases, ip.generated_count,
              ip.downpayment_paid, ip.downpayment_invoice_id, ip.amount, ip.frequency, ip.phase_start
       FROM installmentinvoiceprofilestbl ip
       WHERE ip.installmentinvoiceprofiles_id = $1`,
      [profile_id]
    );
    if (profileRowRes.rows.length > 0) {
      await syncInstallmentEnrollmentForPaidInvoice({
        client: { query },
        profileId: profile_id,
        profile: profileRowRes.rows[0],
        studentId: sid,
        sourceLabel: 'System (Auto-enrolled via acknowledgement receipt — Downpayment + Phase 1)',
      });
    }

    const nextInstallmentRecord = await query(
      `SELECT * FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1 AND (status IS NULL OR status = '' OR status = 'Pending')
       ORDER BY installmentinvoicedtl_id DESC LIMIT 1`,
      [profile_id]
    );

    if (nextInstallmentRecord.rows.length > 0) {
      const nextRecord = nextInstallmentRecord.rows[0];
      const phase2Invoice = await generateInvoiceFromInstallment(nextRecord, {
        ...genProfile,
        generated_count: generatedInvoice.generated_count || 1,
      });
      result.phase2_invoice_id = phase2Invoice.invoice_id;

      const rawAckIssue = autoPayPhase1Data?.issue_date;
      let arIssueYmd = null;
      if (rawAckIssue != null && String(rawAckIssue).trim() !== '') {
        const s = String(rawAckIssue).trim();
        arIssueYmd = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(0, 10) : formatYmdLocal(new Date(s));
      }
      let candidateIssueYmd = arIssueYmd;
      if (phase1InvoiceId && /^\d{4}-\d{2}-\d{2}$/.test(String(candidateIssueYmd || ''))) {
        const p1IssueRes = await query(
          `SELECT TO_CHAR(issue_date, 'YYYY-MM-DD') AS d FROM invoicestbl WHERE invoice_id = $1`,
          [phase1InvoiceId]
        );
        const phase1IssueYmd = (p1IssueRes.rows[0]?.d || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(phase1IssueYmd)) {
          candidateIssueYmd =
            candidateIssueYmd >= phase1IssueYmd ? candidateIssueYmd : phase1IssueYmd;
        }
      }
      if (candidateIssueYmd && phase2Invoice?.invoice_id) {
        const dueRes = await query(
          `SELECT TO_CHAR(due_date, 'YYYY-MM-DD') AS d FROM invoicestbl WHERE invoice_id = $1`,
          [phase2Invoice.invoice_id]
        );
        const dueYmd = (dueRes.rows[0]?.d || '').slice(0, 10);
        if (!dueYmd || candidateIssueYmd <= dueYmd) {
          await query(`UPDATE invoicestbl SET issue_date = $1::date WHERE invoice_id = $2`, [
            candidateIssueYmd,
            phase2Invoice.invoice_id,
          ]);
        }
      }
    }
  } catch (error) {
    result.error = error?.message || String(error);
    console.error('Error in AR attach installment follow-up:', error);
  }

  return result;
}

export const isDownpaymentPlusPhase1Ack = (ack) =>
  String(ack?.installment_option || '').trim().toLowerCase() === 'downpayment_plus_phase1';
