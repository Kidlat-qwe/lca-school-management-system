/**
 * Email guardian/client a FIUU payment link (invoice / AR).
 * Layout inspired by FIUU Payment Link summary emails; school block = invoice/AR branch.
 */
import { query } from '../../config/database.js';
import {
  isEmailConfigured,
  normalizeNotificationRecipients,
  sendSystemNotificationEmailToEach,
} from '../../utils/emailService.js';
import {
  DEFAULT_SCHOOL_NAME,
  getEmailBrandLogoUrl,
} from '../../utils/templateRenderService.js';

function formatPhp(amount) {
  const n = Number(amount || 0);
  return `PHP ${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Load branch display fields for the payment email header/footer.
 * @param {number|null|undefined} branchId
 */
export async function loadBranchForPayEmail(branchId) {
  const id = branchId != null ? parseInt(branchId, 10) : NaN;
  if (!Number.isFinite(id) || id <= 0) {
    return {
      schoolName: DEFAULT_SCHOOL_NAME,
      address: '',
      phone: '',
      email: '',
      displayName: DEFAULT_SCHOOL_NAME,
    };
  }

  try {
    const r = await query(
      `SELECT branch_id, branch_name, branch_nickname, branch_address,
              branch_phone_number, branch_email
       FROM branchestbl
       WHERE branch_id = $1
       LIMIT 1`,
      [id]
    );
    const b = r.rows[0];
    if (!b) {
      return {
        schoolName: DEFAULT_SCHOOL_NAME,
        address: '',
        phone: '',
        email: '',
        displayName: DEFAULT_SCHOOL_NAME,
      };
    }
    const displayName =
      String(b.branch_nickname || '').trim() ||
      String(b.branch_name || '').trim() ||
      DEFAULT_SCHOOL_NAME;
    return {
      schoolName: DEFAULT_SCHOOL_NAME,
      displayName,
      branchName: b.branch_name || '',
      address: String(b.branch_address || '').trim(),
      phone: String(b.branch_phone_number || '').trim(),
      email: String(b.branch_email || '').trim(),
    };
  } catch (err) {
    console.error('[fiuu-pay-email] loadBranchForPayEmail failed:', err?.message || err);
    return {
      schoolName: DEFAULT_SCHOOL_NAME,
      address: '',
      phone: '',
      email: '',
      displayName: DEFAULT_SCHOOL_NAME,
    };
  }
}

/**
 * @param {object} params
 * @param {string|string[]} params.to
 * @param {string} params.payLinkUrl
 * @param {string|number} params.amount
 * @param {string} [params.studentName]
 * @param {string} [params.refLabel] - invoice / AR number label
 * @param {string} [params.itemDescription] - line item text
 * @param {string} [params.orderid]
 * @param {string} [params.paymentTypeLabel] - e.g. Invoice / Acknowledgement Receipt
 * @param {object} [params.branch] - from loadBranchForPayEmail
 * @param {number} [params.tipAmount]
 * @param {number} [params.discountAmount]
 * @param {string} [params.expiresAt] - ISO or display string
 */
/**
 * @returns {{ subject: string, html: string, recipients: string[] }}
 */
export function buildFiuuPaymentLinkEmailContent({
  to,
  payLinkUrl,
  amount,
  studentName = 'Client',
  refLabel = 'Payment',
  itemDescription = '',
  orderid = '',
  paymentTypeLabel = 'Payment',
  branch = null,
  tipAmount = 0,
  discountAmount = 0,
  expiresAt = '',
  ccEmails = [],
}) {
  const primary = normalizeNotificationRecipients(Array.isArray(to) ? to : [to]);
  const cc = normalizeNotificationRecipients(Array.isArray(ccEmails) ? ccEmails : [ccEmails]);
  const recipients = normalizeNotificationRecipients([...primary, ...cc]);
  if (recipients.length === 0) {
    throw Object.assign(new Error('A valid guardian/client email is required'), { statusCode: 400 });
  }
  if (!payLinkUrl) {
    throw Object.assign(new Error('payLinkUrl is required'), { statusCode: 400 });
  }

  const greeting = String(studentName || 'Client').trim() || 'Client';
  const toEmail = primary[0] || recipients[0] || '';
  const tip = Math.max(0, parseFloat(tipAmount) || 0);
  const discount = Math.max(0, parseFloat(discountAmount) || 0);
  const grandTotal = Math.max(0, parseFloat(amount) || 0);
  const baseLine = Math.max(0, grandTotal - tip);
  const lineDesc =
    String(itemDescription || '').trim() ||
    String(refLabel || paymentTypeLabel || 'Payment').trim() ||
    'Payment';

  const schoolName = escapeHtml(branch?.schoolName || DEFAULT_SCHOOL_NAME);
  const branchLabel = escapeHtml(branch?.displayName || schoolName);
  const address = escapeHtml(branch?.address || '');
  const phone = escapeHtml(branch?.phone || '');
  const branchEmail = escapeHtml(branch?.email || '');
  const logoUrl = escapeHtml(getEmailBrandLogoUrl());
  const expireDisplay = String(expiresAt || '').trim() || 'N/A';
  const subject = `Payment link — ${refLabel} (${formatPhp(grandTotal)})`;

  const contactLineParts = [];
  if (phone) contactLineParts.push(phone);
  if (branchEmail) {
    contactLineParts.push(
      `<a href="mailto:${branchEmail}" style="color:#1e3a8a;text-decoration:none;">${branchEmail}</a>`
    );
  }
  const contactLine =
    contactLineParts.length > 0
      ? contactLineParts.join(' &nbsp;|&nbsp; ')
      : 'Contact your branch for assistance.';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;">
          <tr>
            <td style="padding:20px 24px;border-bottom:1px solid #e5e7eb;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:top;width:64px;padding-right:12px;">
                    <img src="${logoUrl}" alt="Little Champions Academy" width="48" height="48"
                      style="display:block;width:48px;height:48px;border:0;border-radius:50%;object-fit:cover;" />
                  </td>
                  <td style="vertical-align:top;">
                    <div style="font-size:15px;font-weight:700;color:#111827;line-height:1.3;">${schoolName}</div>
                    <div style="font-size:13px;font-weight:600;color:#1e3a8a;margin-top:2px;">${branchLabel}</div>
                    ${
                      address
                        ? `<div style="font-size:12px;color:#4b5563;margin-top:6px;line-height:1.4;">${address}</div>`
                        : ''
                    }
                    ${
                      phone || branchEmail
                        ? `<div style="font-size:12px;color:#4b5563;margin-top:4px;">${contactLine}</div>`
                        : ''
                    }
                  </td>
                  <td style="vertical-align:top;text-align:right;font-size:12px;color:#6b7280;white-space:nowrap;">
                    <div>This payment link will expire on:</div>
                    <div style="font-weight:600;color:#111827;">${escapeHtml(expireDisplay)}</div>
                    ${
                      orderid
                        ? `<div style="margin-top:8px;">Order ID:<br/><span style="font-weight:600;color:#111827;word-break:break-all;">${escapeHtml(orderid)}</span></div>`
                        : ''
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 24px 8px;font-size:13px;color:#374151;">
              <div><strong>To:</strong> ${escapeHtml(toEmail)}</div>
              <div style="margin-top:4px;"><strong>Student Name:</strong> ${escapeHtml(greeting)}</div>
              <div style="margin-top:4px;"><strong>Reference:</strong> ${escapeHtml(refLabel)} (${escapeHtml(paymentTypeLabel)})</div>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 24px 4px;">
              <div style="font-size:14px;font-weight:700;margin-bottom:8px;">Payment Summary</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
                <tr style="background:#1e3a8a;color:#ffffff;">
                  <th align="left" style="padding:10px 8px;font-weight:600;">Item Description</th>
                  <th align="right" style="padding:10px 8px;font-weight:600;">Unit Price</th>
                  <th align="center" style="padding:10px 8px;font-weight:600;">Qty</th>
                  <th align="right" style="padding:10px 8px;font-weight:600;">Total Price</th>
                </tr>
                <tr style="border-bottom:1px solid #e5e7eb;">
                  <td style="padding:10px 8px;color:#111827;">${escapeHtml(lineDesc)}</td>
                  <td align="right" style="padding:10px 8px;">${escapeHtml(formatPhp(baseLine + discount))}</td>
                  <td align="center" style="padding:10px 8px;">1</td>
                  <td align="right" style="padding:10px 8px;">${escapeHtml(formatPhp(baseLine + discount))}</td>
                </tr>
                <tr>
                  <td colspan="3" align="right" style="padding:8px 8px 4px;color:#4b5563;">Sub Total</td>
                  <td align="right" style="padding:8px 8px 4px;">${escapeHtml(formatPhp(baseLine + discount))}</td>
                </tr>
                ${
                  discount > 0
                    ? `<tr>
                  <td colspan="3" align="right" style="padding:4px 8px;color:#4b5563;">Discount</td>
                  <td align="right" style="padding:4px 8px;">-${escapeHtml(formatPhp(discount))}</td>
                </tr>`
                    : ''
                }
                ${
                  tip > 0
                    ? `<tr>
                  <td colspan="3" align="right" style="padding:4px 8px;color:#4b5563;">Tip / Adjustment</td>
                  <td align="right" style="padding:4px 8px;">${escapeHtml(formatPhp(tip))}</td>
                </tr>`
                    : ''
                }
                <tr>
                  <td colspan="3" align="right" style="padding:8px 8px 12px;font-weight:700;">Grand Total</td>
                  <td align="right" style="padding:8px 8px 12px;font-weight:700;">${escapeHtml(formatPhp(grandTotal))}</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 24px 20px;font-size:13px;color:#374151;text-align:center;">
              <p style="margin:0 0 16px;line-height:1.5;">
                To confirm and fully agree with this transaction, click the <strong>Pay</strong> button below.
                Your bill stays unpaid in our system until payment is completed via FIUU (GCash, Maya, or QR Ph).
              </p>
              <a href="${escapeHtml(payLinkUrl)}"
                 style="display:inline-block;background:#1e3a8a;color:#ffffff;text-decoration:none;
                        font-weight:700;font-size:15px;padding:12px 36px;border-radius:6px;">
                Pay
              </a>
              <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;word-break:break-all;">
                Or open this link:<br/>
                <a href="${escapeHtml(payLinkUrl)}" style="color:#1e3a8a;">${escapeHtml(payLinkUrl)}</a>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">
              For further assistance, please contact us
              ${phone ? ` at <strong style="color:#1e3a8a;">${phone}</strong>` : ''}
              ${
                branchEmail
                  ? `${phone ? ' or' : ''} email <a href="mailto:${branchEmail}" style="color:#1e3a8a;">${branchEmail}</a>`
                  : ''
              }.
              <div style="margin-top:10px;font-size:11px;">
                This is an automated email. Please do not reply.<br/>
                © ${new Date().getFullYear()} ${schoolName}. All rights reserved.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, recipients };
}

/**
 * @param {object} params — same as buildFiuuPaymentLinkEmailContent
 */
export async function sendFiuuPaymentLinkEmail(params) {
  if (!isEmailConfigured()) {
    throw Object.assign(
      new Error('Email is not configured. Set BREVO_API_KEY or SMTP settings before sending payment links.'),
      { statusCode: 503 }
    );
  }

  const { subject, html, recipients } = buildFiuuPaymentLinkEmailContent(params);

  const result = await sendSystemNotificationEmailToEach({
    recipients,
    subject,
    html,
  });

  return {
    recipients,
    sent: result?.sent ?? recipients.length,
    failed: result?.failed || [],
  };
}
