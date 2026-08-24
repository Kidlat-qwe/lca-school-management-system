import { query } from '../../config/database.js';
import {
  getFiuuCallbackUrl,
  getFiuuDefaultChannel,
  getFiuuCurrency,
  getFiuuMerchantId,
  getFiuuNotifyUrl,
  getFiuuPayBaseUrl,
  getFiuuReturnUrl,
  isFiuuConfigured,
  resolveFiuuChannelPath,
} from './config.js';
import {
  buildInvoiceOrderId,
  formatFiuuDescription,
  formatAmount,
} from './orderId.js';
import { buildPaymentVcode, formatFiuuAmount, isFiuuPaymentFailed, isFiuuPaymentSuccess, verifyPaymentSkey } from './signature.js';
import {
  findGatewayPaymentByOrderId,
  insertGatewayPayment,
  updateGatewayPaymentStatus,
  withGatewayTransaction,
} from './gatewayPaymentRepository.js';
import {
  applyGatewayInvoiceFullPayment,
  runPostCommitInstallmentJobs,
} from './applyGatewayInvoicePayment.js';
import { applyGatewayArPayment } from './applyGatewayArPayment.js';
import { createFiuuArPayment } from './createFiuuArPayment.js';
import {
  attachPayLinkToMetadata,
  buildFiuuPublicPayPageUrl,
  buildPublicPayPayload,
  buildPublicPayPayloadForRow,
  buildFiuuAutoPostHtml,
  findGatewayPaymentByPayToken,
  resolvePayLinkExpiresAt,
} from './payLink.js';
import {
  sendFiuuPaymentLinkEmail,
  loadBranchForPayEmail,
  buildFiuuPaymentLinkEmailContent,
} from './sendFiuuPaymentLinkEmail.js';
import { getPriorPartialBalanceBlockers } from '../../lib/installmentPaymentEligibility.js';
import { getClient } from '../../config/database.js';
import { sendInvoicePaymentConfirmationByInvoiceId } from '../../utils/paymentConfirmationEmailService.js';
import { normalizeNotificationRecipients } from '../../utils/emailService.js';

export { isFiuuConfigured, createFiuuArPayment };

export async function loadInvoiceForFiuuCreate(invoiceId, studentId) {
  const invRes = await query(
    `SELECT i.*, COALESCE(b.branch_nickname, b.branch_name) AS branch_name
     FROM invoicestbl i
     LEFT JOIN branchestbl b ON i.branch_id = b.branch_id
     WHERE i.invoice_id = $1`,
    [invoiceId]
  );
  if (invRes.rows.length === 0) {
    throw Object.assign(new Error('Invoice not found'), { statusCode: 404 });
  }
  const invoice = invRes.rows[0];

  if (invoice.status === 'Paid') {
    throw Object.assign(new Error('Invoice is already fully paid'), { statusCode: 400 });
  }
  if (invoice.balance_invoice_id) {
    throw Object.assign(new Error('Pay the balance continuation invoice instead'), {
      statusCode: 400,
    });
  }

  const remaining = parseFloat(invoice.amount) || 0;
  if (remaining <= 0.009) {
    throw Object.assign(new Error('No remaining balance on this invoice'), { statusCode: 400 });
  }

  const studentRes = await query(
    `SELECT u.user_id, u.full_name, u.email, u.phone_number
     FROM userstbl u
     INNER JOIN invoicestudentstbl ist ON ist.student_id = u.user_id AND ist.invoice_id = $1
     WHERE u.user_id = $2`,
    [invoiceId, studentId]
  );
  if (studentRes.rows.length === 0) {
    throw Object.assign(new Error('Student is not on this invoice'), { statusCode: 400 });
  }

  const client = await getClient();
  try {
    if (invoice.installmentinvoiceprofiles_id) {
      const priorBlock = await getPriorPartialBalanceBlockers(client, invoiceId);
      if (priorBlock.blocked) {
        throw Object.assign(new Error(priorBlock.message), { statusCode: 400 });
      }
    }
  } finally {
    client.release();
  }

  return { invoice, student: studentRes.rows[0], remaining };
}

/**
 * Create pending gateway row + FIUU hosted payment payload.
 * Invoice stays unpaid until FIUU webhook confirms success.
 *
 * @param {object} params
 * @param {boolean} [params.send_email] - email CMS pay link to guardian/client
 * @param {string|string[]} [params.recipient_email] - override recipient(s)
 */
export async function createFiuuInvoicePayment({
  invoice_id,
  student_id,
  created_by,
  initiator_name,
  channel,
  send_email = false,
  recipient_email,
  pay_link_expires_on,
  disable_after_payment = true,
  send_copy_to_me = false,
  staff_email,
  tip_amount = 0,
  discount_amount = 0,
}) {
  if (!isFiuuConfigured()) {
    throw Object.assign(new Error('FIUU is not configured on the server'), { statusCode: 503 });
  }

  const { invoice, student, remaining } = await loadInvoiceForFiuuCreate(invoice_id, student_id);
  const tipApplied = Math.max(0, parseFloat(tip_amount) || 0);
  const discountApplied = Math.max(0, parseFloat(discount_amount) || 0);
  if (discountApplied > 0 && discountApplied >= remaining) {
    throw Object.assign(new Error('Discount amount must be less than invoice remaining balance'), {
      statusCode: 400,
    });
  }
  const netPayable = Math.max(0, remaining - discountApplied);
  if (netPayable <= 0.009) {
    throw Object.assign(new Error('Payable amount after discount must be greater than 0'), {
      statusCode: 400,
    });
  }
  const chargeAmt = netPayable + tipApplied;

  const orderid = buildInvoiceOrderId(invoice_id);
  const amount = formatFiuuAmount(chargeAmt);
  const currency = getFiuuCurrency();
  const fiuuChannel = channel || getFiuuDefaultChannel();
  const refLabel = invoice.invoice_description || `INV-${invoice_id}`;
  const description = formatFiuuDescription({
    typeLabel: 'Invoice',
    studentName: student.full_name || 'Student',
    branchName: invoice.branch_name || 'Branch',
    refLabel,
    amountPhp: chargeAmt,
    initiatorName: initiator_name,
  });

  const vcode = buildPaymentVcode({ amount, orderid, currency });
  const merchantId = getFiuuMerchantId();
  const channelPath = resolveFiuuChannelPath(fiuuChannel);
  const payUrl = `${getFiuuPayBaseUrl()}${merchantId}/${channelPath}`;

  const formFields = {
    amount,
    orderid,
    bill_name: student.full_name || 'Student',
    bill_email: student.email || '',
    bill_mobile: student.phone_number || '',
    bill_desc: description,
    currency,
    vcode,
    channel: fiuuChannel,
  };

  const returnUrl = getFiuuReturnUrl();
  const notifyUrl = getFiuuNotifyUrl();
  const callbackUrl = getFiuuCallbackUrl();
  if (returnUrl) formFields.returnurl = returnUrl;
  if (notifyUrl) formFields.notifyurl = notifyUrl;
  if (callbackUrl) formFields.callbackurl = callbackUrl;

  const metadata = attachPayLinkToMetadata(
    {
      channel: fiuuChannel,
      payment_type: 'Full Payment',
      tip_amount: tipApplied,
      discount_amount: discountApplied,
      net_payable: netPayable,
      invoice_remaining: remaining,
    },
    {
      expiresOnYmd: pay_link_expires_on,
      disableAfterPayment: disable_after_payment !== false,
    }
  );
  let payLinkUrl = null;
  try {
    payLinkUrl = buildFiuuPublicPayPageUrl(metadata.pay_link_token);
  } catch (err) {
    if (send_email) throw err;
  }

  await insertGatewayPayment({
    gateway: 'FIUU',
    orderid,
    target_type: 'invoice',
    target_id: invoice_id,
    student_id,
    branch_id: invoice.branch_id,
    invoice_id,
    amount: chargeAmt,
    currency,
    description_sent: description,
    metadata,
    raw_request: formFields,
    created_by,
  });

  let emailResult = null;
  if (send_email) {
    const recipients = await resolveInvoicePayLinkRecipients(student_id, recipient_email, student);
    const branch = await loadBranchForPayEmail(invoice.branch_id);
    emailResult = await sendFiuuPaymentLinkEmail({
      to: recipients,
      payLinkUrl,
      amount: chargeAmt,
      studentName: student.full_name || 'Client',
      refLabel: invoice.invoice_ar_number || refLabel || `INV-${invoice_id}`,
      itemDescription: invoice.invoice_description || refLabel || 'Invoice payment',
      orderid,
      paymentTypeLabel: 'Invoice',
      branch,
      tipAmount: tipApplied,
      discountAmount: discountApplied,
      expiresAt: pay_link_expires_on
        ? String(metadata.pay_link_expires_at || '').slice(0, 10)
        : '',
      ccEmails:
        send_copy_to_me && staff_email ? [staff_email] : [],
    });
  }

  return {
    orderid,
    amount,
    currency,
    payUrl,
    formFields,
    description,
    channel: fiuuChannel,
    pay_link_url: payLinkUrl,
    pay_link_token: metadata.pay_link_token,
    tip_amount: tipApplied,
    discount_amount: discountApplied,
    net_payable: netPayable,
    email: emailResult,
  };
}

async function resolveInvoicePayLinkRecipients(studentId, recipientEmail, student) {
  if (recipientEmail != null && String(recipientEmail).trim() !== '') {
    const list = normalizeNotificationRecipients(
      Array.isArray(recipientEmail) ? recipientEmail : String(recipientEmail).split(/[,;]/)
    );
    if (list.length === 0) {
      throw Object.assign(new Error('recipient_email is not a valid email address'), {
        statusCode: 400,
      });
    }
    return list;
  }

  const gRes = await query(
    `SELECT email FROM guardianstbl WHERE student_id = $1 AND email IS NOT NULL AND TRIM(email) <> ''
     ORDER BY guardian_id ASC LIMIT 3`,
    [studentId]
  );
  const fromGuardians = gRes.rows.map((r) => r.email);
  const list = normalizeNotificationRecipients([...(fromGuardians || []), student?.email]);
  if (list.length === 0) {
    throw Object.assign(
      new Error('No guardian or student email on file. Enter an email to send the payment link.'),
      { statusCode: 400 }
    );
  }
  return list;
}

export async function getPublicFiuuPayByToken(token) {
  const row = await findGatewayPaymentByPayToken(token);
  return buildPublicPayPayloadForRow(row);
}

/** HTML bridge for email "Pay now" — auto-POSTs to FIUU in the same tab. */
export async function getPublicFiuuGoHtmlByToken(token) {
  const row = await findGatewayPaymentByPayToken(token);
  const payload = await buildPublicPayPayloadForRow(row);
  return buildFiuuAutoPostHtml(payload);
}

/**
 * Build payment-link email HTML for staff Preview (does not create gateway row or send mail).
 */
export async function previewFiuuPaymentLinkEmail({
  mode = 'invoice',
  invoice_id,
  student_id,
  recipient_email,
  amount,
  student_name,
  ref_label,
  item_description,
  branch_id,
  tip_amount = 0,
  discount_amount = 0,
  pay_link_expires_on,
  send_copy_to_me = false,
  staff_email,
}) {
  const expiresIso = resolvePayLinkExpiresAt(pay_link_expires_on);
  const expiresAt = expiresIso ? expiresIso.slice(0, 10) : '';
  const placeholderLink = 'https://example.invalid/pay/preview';
  const tipApplied = Math.max(0, parseFloat(tip_amount) || 0);
  const discountApplied = Math.max(0, parseFloat(discount_amount) || 0);

  if (mode === 'invoice') {
    if (!invoice_id || !student_id) {
      throw Object.assign(new Error('invoice_id and student_id are required for invoice preview'), {
        statusCode: 400,
      });
    }
    const { invoice, student, remaining } = await loadInvoiceForFiuuCreate(invoice_id, student_id);
    if (discountApplied > 0 && discountApplied >= remaining) {
      throw Object.assign(new Error('Discount amount must be less than invoice remaining balance'), {
        statusCode: 400,
      });
    }
    const netPayable = Math.max(0, remaining - discountApplied);
    const chargeAmt = netPayable + tipApplied;
    const branch = await loadBranchForPayEmail(invoice.branch_id);
    const to =
      recipient_email ||
      (await resolveInvoicePayLinkRecipients(student_id, recipient_email, student));
    return buildFiuuPaymentLinkEmailContent({
      to,
      payLinkUrl: placeholderLink,
      amount: chargeAmt,
      studentName: student.full_name || 'Client',
      refLabel: invoice.invoice_ar_number || invoice.invoice_description || `INV-${invoice_id}`,
      itemDescription: invoice.invoice_description || 'Invoice payment',
      orderid: 'PREVIEW-ORDER',
      paymentTypeLabel: 'Invoice',
      branch,
      tipAmount: tipApplied,
      discountAmount: discountApplied,
      expiresAt,
      ccEmails: send_copy_to_me && staff_email ? [staff_email] : [],
    });
  }

  const branch = await loadBranchForPayEmail(branch_id);
  if (!recipient_email) {
    throw Object.assign(new Error('recipient_email is required for AR preview'), { statusCode: 400 });
  }
  return buildFiuuPaymentLinkEmailContent({
    to: recipient_email,
    payLinkUrl: placeholderLink,
    amount: amount != null ? amount : 0,
    studentName: student_name || 'Client',
    refLabel: ref_label || 'AR preview',
    itemDescription: item_description || 'Acknowledgement receipt',
    orderid: 'PREVIEW-ORDER',
    paymentTypeLabel: 'Acknowledgement Receipt',
    branch,
    tipAmount: tip_amount,
    discountAmount: discount_amount,
    expiresAt,
    ccEmails: send_copy_to_me && staff_email ? [staff_email] : [],
  });
}

export async function getFiuuPaymentStatus(orderid) {
  const row = await findGatewayPaymentByOrderId(orderid);
  if (!row) {
    throw Object.assign(new Error('Gateway payment not found'), { statusCode: 404 });
  }
  return {
    orderid: row.orderid,
    status: row.status,
    payment_id: row.payment_id,
    invoice_id: row.invoice_id,
    amount: row.amount,
    fiuu_tran_id: row.fiuu_tran_id,
    fiuu_channel: row.fiuu_channel,
    target_type: row.target_type,
    target_id: row.target_id,
    ack_receipt_id:
      String(row.target_type || '') === 'ack_receipt' ? row.target_id : undefined,
  };
}

async function processSuccessfulGatewayPayment(gatewayRow, webhookPayload) {
  const isAckReceipt = String(gatewayRow.target_type || '') === 'ack_receipt';
  if (gatewayRow.status === 'paid' && (gatewayRow.payment_id || isAckReceipt)) {
    return {
      alreadyProcessed: true,
      payment_id: gatewayRow.payment_id,
      ack_receipt_id: isAckReceipt ? gatewayRow.target_id : undefined,
      invoice_id: gatewayRow.invoice_id,
    };
  }

  const tranID = String(webhookPayload.tranID ?? '').trim();
  const channel = String(webhookPayload.channel ?? gatewayRow.metadata?.channel ?? '').trim();

  let applyResult;
  await withGatewayTransaction(async (client) => {
    const locked = await client.query(
      'SELECT * FROM gateway_paymentstbl WHERE orderid = $1 FOR UPDATE',
      [gatewayRow.orderid]
    );
    const current = locked.rows[0];
    if (!current) throw new Error('Gateway payment not found');
    const currentIsAck = String(current.target_type || '') === 'ack_receipt';
    if (current.status === 'paid' && (current.payment_id || currentIsAck)) {
      applyResult = {
        alreadyProcessed: true,
        payment_id: current.payment_id,
        ack_receipt_id: currentIsAck ? current.target_id : undefined,
        invoice_id: current.invoice_id,
      };
      return;
    }

    if (currentIsAck) {
      applyResult = await applyGatewayArPayment(client, {
        ack_receipt_id: current.target_id,
        reference_number: tranID,
        fiuu_channel: channel || getFiuuDefaultChannel(),
        created_by: current.created_by,
        issue_date: new Date().toISOString().slice(0, 10),
      });
    } else {
      const meta =
        current.metadata && typeof current.metadata === 'object' ? current.metadata : {};
      const tipApplied = Math.max(0, parseFloat(meta.tip_amount) || 0);
      const discountApplied = Math.max(0, parseFloat(meta.discount_amount) || 0);
      const netPayable =
        meta.net_payable != null
          ? Math.max(0, parseFloat(meta.net_payable) || 0)
          : Math.max(0, (parseFloat(current.amount) || 0) - tipApplied);
      applyResult = await applyGatewayInvoiceFullPayment(client, {
        invoice_id: current.invoice_id,
        student_id: current.student_id,
        payable_amount: netPayable,
        discount_amount: discountApplied,
        tip_amount: tipApplied,
        reference_number: tranID,
        payment_method: 'FIUU Online',
        fiuu_channel: channel || getFiuuDefaultChannel(),
        created_by: current.created_by,
        issue_date: new Date(),
        remarks: current.description_sent,
      });
    }

    await client.query(
      `UPDATE gateway_paymentstbl
       SET status = 'paid', fiuu_tran_id = $1, fiuu_channel = $2, raw_webhook = $3,
           payment_id = $4, invoice_id = COALESCE($5, invoice_id),
           paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE gateway_payment_id = $6`,
      [
        tranID || null,
        channel || null,
        JSON.stringify(webhookPayload),
        applyResult.payment_id || null,
        applyResult.invoice_id || null,
        current.gateway_payment_id,
      ]
    );
  });

  if (applyResult && !applyResult.alreadyProcessed && !isAckReceipt) {
    await runPostCommitInstallmentJobs(applyResult);
    (async () => {
      try {
        const emailClient = await getClient();
        try {
          await sendInvoicePaymentConfirmationByInvoiceId(emailClient, applyResult.invoice_id);
        } finally {
          emailClient.release();
        }
      } catch (emailErr) {
        console.error('FIUU: payment confirmation email failed:', emailErr);
      }
    })();
  }

  return applyResult;
}

function isCallbackSource(source) {
  return String(source || '').toLowerCase().includes('callback');
}

function pingAck(payload, source, extra = {}) {
  return {
    ok: true,
    ping: true,
    ...extra,
    ipnEcho: isCallbackSource(source) ? 'CBTOKEN:MPSTATOK' : formatIpnAckBody(payload),
  };
}

/**
 * Handle FIUU notify/callback/return POST body.
 */
export async function handleFiuuWebhookPayload(payload, { source = 'notify' } = {}) {
  const orderid = String(payload.orderid ?? '').trim();
  if (!orderid) {
    // FIUU portal Check may POST an empty body. ACK 200 so URL validation passes.
    return pingAck(payload, source, { message: 'Webhook endpoint OK' });
  }

  const gatewayRow = await findGatewayPaymentByOrderId(orderid);
  if (!gatewayRow) {
    // FIUU Check uses dummy orderids (e.g. DEMO894). Do not 404 — ACK only.
    console.warn(`[fiuu-${source}] Unknown orderid (ping/check): ${orderid}`);
    return pingAck(payload, source, { message: 'Unknown orderid acknowledged', orderid });
  }

  const amountOk =
    Math.abs(parseFloat(payload.amount || 0) - parseFloat(gatewayRow.amount || 0)) < 0.02;
  const currency = String(payload.currency ?? 'PHP').trim();
  if (!amountOk) {
    console.error(
      `[fiuu-${source}] Amount mismatch for ${orderid}: webhook=${payload.amount} gateway=${gatewayRow.amount}`
    );
    await updateGatewayPaymentStatus(gatewayRow.gateway_payment_id, {
      status: 'failed',
      raw_webhook: payload,
    });
    return { ok: false, message: 'Amount mismatch', httpStatus: 400 };
  }

  if (!verifyPaymentSkey(payload)) {
    console.error(`[fiuu-${source}] Invalid skey for ${orderid}`);
    return { ok: false, message: 'Invalid signature', httpStatus: 400 };
  }

  const status = String(payload.status ?? '').trim();
  if (isFiuuPaymentSuccess(status)) {
    const result = await processSuccessfulGatewayPayment(gatewayRow, payload);
    return {
      ok: true,
      message: 'Payment applied',
      orderid,
      payment_id: result?.payment_id,
      ipnEcho: formatIpnAckBody(payload),
    };
  }

  if (isFiuuPaymentFailed(status)) {
    await updateGatewayPaymentStatus(gatewayRow.gateway_payment_id, {
      status: 'failed',
      fiuu_tran_id: payload.tranID || null,
      raw_webhook: payload,
    });
    return { ok: true, message: 'Payment failed recorded', orderid, ipnEcho: formatIpnAckBody(payload) };
  }

  await updateGatewayPaymentStatus(gatewayRow.gateway_payment_id, {
    status: 'pending',
    raw_webhook: payload,
  });
  return { ok: true, message: 'Pending status received', orderid, ipnEcho: formatIpnAckBody(payload) };
}

/** IPN ACK: echo POST fields + treq=1 (FIUU expects plain text key=value lines). */
export function formatIpnAckBody(payload) {
  const lines = Object.entries({ ...payload, treq: '1' }).map(
    ([key, value]) => `${key}=${encodeURIComponent(String(value ?? ''))}`
  );
  return lines.join('\n');
}

export function normalizeFiuuPostBody(body) {
  if (!body || typeof body !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = v == null ? '' : String(v);
  }
  return out;
}
