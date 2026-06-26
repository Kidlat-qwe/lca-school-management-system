import { query } from '../config/database.js';
import { evaluateBillingNotificationEligibility } from './billingNotificationEligibility.js';
import {
  normalizeNotificationRecipients,
  sendMonthlyInvoiceNoticeEmail,
} from './emailService.js';
import { collectPhilippineMobiles } from './sms/semaphoreSmsService.js';
import { sendPairedTemplateSms } from './sms/templateSmsService.js';
import {
  DEFAULT_SCHOOL_NAME,
  formatDateDisplay,
  formatPhp,
  loadEffectiveTemplate,
  logTemplateRenderWarning,
  renderMessagingTemplate,
  wrapBrandedEmailHtml,
} from './templateRenderService.js';

const formatBillingPeriod = (dueDate) => {
  if (!dueDate) return '';
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const computeOutstandingBalance = async (invoiceId) => {
  const itemsResult = await query('SELECT * FROM invoiceitemstbl WHERE invoice_id = $1', [invoiceId]);
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

  const paymentsResult = await query(
    `SELECT COALESCE(SUM(payable_amount), 0) AS total_payments FROM paymenttbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const totalPayments = Number(paymentsResult.rows[0]?.total_payments || 0);
  return Math.max(0, grandTotal - totalPayments);
};

/**
 * Send monthly auto-invoice notice after scheduled generation (25th issue / 5th due).
 * Skips when template disabled, no recipients, invoice paid, or balance is zero.
 */
export const sendMonthlyInvoiceGeneratedNotice = async ({ invoiceId }) => {
  if (!invoiceId) {
    return { skipped: true, reason: 'missing_invoice_id' };
  }

  const invoiceRes = await query(
    `SELECT i.invoice_id, i.invoice_description, i.issue_date, i.due_date, i.status, i.branch_id,
            COALESCE(b.branch_nickname, b.branch_name) AS branch_name
     FROM invoicestbl i
     LEFT JOIN branchestbl b ON b.branch_id = i.branch_id
     WHERE i.invoice_id = $1
     LIMIT 1`,
    [invoiceId]
  );

  if (invoiceRes.rows.length === 0) {
    return { skipped: true, reason: 'invoice_not_found' };
  }

  const invoice = invoiceRes.rows[0];
  const status = String(invoice.status || '').toLowerCase();
  if (status === 'paid') {
    return { skipped: true, reason: 'invoice_already_paid' };
  }

  const outstandingBalance = await computeOutstandingBalance(invoiceId);
  if (outstandingBalance <= 0) {
    return { skipped: true, reason: 'no_outstanding_balance' };
  }

  const studentsRes = await query(
    `SELECT DISTINCT u.user_id AS student_id, u.full_name AS student_name, u.email AS student_email,
            u.phone_number AS student_phone,
            g.guardian_name, g.email AS guardian_email, g.guardian_phone_number
     FROM invoicestudentstbl ist
     JOIN userstbl u ON u.user_id = ist.student_id
     LEFT JOIN LATERAL (
       SELECT guardian_name, email, guardian_phone_number
       FROM guardianstbl
       WHERE student_id = ist.student_id
       ORDER BY guardian_id ASC
       LIMIT 1
     ) g ON TRUE
     WHERE ist.invoice_id = $1`,
    [invoiceId]
  );

  const invoiceNumber = invoice.invoice_description || `INV-${invoice.invoice_id}`;
  const issueDateDisplay = formatDateDisplay(invoice.issue_date);
  const dueDateDisplay = formatDateDisplay(invoice.due_date);
  const billingPeriod = formatBillingPeriod(invoice.due_date);
  const branchName = invoice.branch_name || DEFAULT_SCHOOL_NAME;
  const amountDue = formatPhp(outstandingBalance);

  try {
    const tpl = await loadEffectiveTemplate(null, 'template_monthly_invoice_notice', invoice.branch_id);
    if (!tpl.enabled) {
      return { skipped: true, reason: 'template_disabled', attempted: 0, sent: 0, failed: 0 };
    }
  } catch (templateErr) {
    await logTemplateRenderWarning('sendMonthlyInvoiceGeneratedNotice template check', templateErr);
  }

  const summary = { attempted: 0, sent: 0, failed: 0, smsSent: 0, skipped: 0, errors: [] };

  for (const row of studentsRes.rows) {
    const eligibility = await evaluateBillingNotificationEligibility(query, {
      invoiceId,
      studentId: row.student_id,
    });
    if (!eligibility.allowed) {
      summary.skipped += 1;
      console.log(
        `[monthlyInvoiceNotice] Skipping student ${row.student_id} — dropped, not rejoined (invoice ${invoiceId}, class ${eligibility.classId ?? 'n/a'})`
      );
      continue;
    }

    const recipients = normalizeNotificationRecipients([row.student_email, row.guardian_email]);
    if (recipients.length === 0) {
      summary.skipped += 1;
      continue;
    }

    const greetingName = row.guardian_name || row.student_name || 'Parent/Guardian';
    const studentName = row.student_name || 'Student';
    const phoneNumbers = collectPhilippineMobiles(row.guardian_phone_number, row.student_phone);
    const templateVariables = {
      recipientName: greetingName,
      studentName,
      invoiceNumber,
      issueDate: issueDateDisplay,
      dueDate: dueDateDisplay,
      amountDue,
      billingPeriod: billingPeriod || dueDateDisplay,
      schoolName: branchName,
      branchName,
    };

    let subject = `Monthly Invoice ${invoiceNumber} - Due ${dueDateDisplay}`;
    let bodyHtml = wrapBrandedEmailHtml(`
      <p style="margin:0 0 16px;color:#111827;line-height:1.6;">Hello ${greetingName},</p>
      <p style="margin:0 0 16px;color:#111827;line-height:1.6;">
        Your monthly tuition invoice for <strong>${studentName}</strong> has been generated
        (issued ${issueDateDisplay}, due ${dueDateDisplay}).
      </p>
      <p style="margin:0 0 16px;color:#111827;line-height:1.6;">
        <strong>Invoice:</strong> ${invoiceNumber}<br/>
        <strong>Billing period:</strong> ${billingPeriod || dueDateDisplay}<br/>
        <strong>Amount due:</strong> ${amountDue}
      </p>
      <p style="margin:0 0 16px;color:#111827;line-height:1.6;">
        If you have already made a payment for this billing period, please disregard this message.
      </p>
    `);

    try {
      const rendered = await renderMessagingTemplate({
        templateKey: 'template_monthly_invoice_notice',
        branchId: invoice.branch_id,
        variables: templateVariables,
      });

      if (rendered?.enabled) {
        subject =
          rendered.subject?.trim() ||
          rendered.title?.trim() ||
          subject;
        bodyHtml = rendered.bodyHtml;
      }
    } catch (templateErr) {
      await logTemplateRenderWarning('sendMonthlyInvoiceGeneratedNotice template load', templateErr);
    }

    summary.attempted += 1;
    try {
      await sendMonthlyInvoiceNoticeEmail({
        to: recipients,
        subject,
        bodyHtml,
        invoiceId,
        invoiceNumber,
        studentName,
      });
      summary.sent += 1;

      const smsResult = await sendPairedTemplateSms({
        templateKey: 'template_monthly_invoice_notice',
        branchId: invoice.branch_id,
        variables: templateVariables,
        phoneNumbers,
      });
      if (smsResult?.success) summary.smsSent += 1;
    } catch (err) {
      summary.failed += 1;
      summary.errors.push({
        student_id: row.student_id,
        message: err?.message || String(err),
      });
    }
  }

  if (summary.attempted === 0 && summary.skipped > 0 && summary.sent === 0) {
    return { ...summary, skipped: true, reason: 'no_recipients' };
  }

  return summary;
};
