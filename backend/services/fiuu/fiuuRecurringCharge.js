/**
 * FIUU Recurring / MIT (Merchant Initiated Transaction) token charges.
 * Spec: Fiuu Recurring API v7.1.4 — RecordType T.
 *
 * Flow: installment invoice generated → active AutoPay consent + token →
 * create pending gateway_paymentstbl row → POST recurring API →
 * async notify/callback applies payment (same webhook path as HPP).
 */
import { query } from '../../config/database.js';
import {
  getFiuuCurrency,
  getFiuuMerchantId,
  getFiuuRecurringUrl,
  getFiuuSubMerchantId,
  isFiuuAutopayMitEnabled,
  isFiuuConfigured,
} from './config.js';
import { buildInvoiceOrderId, formatFiuuDescription } from './orderId.js';
import { buildRecurringChecksum, formatFiuuAmount } from './signature.js';
import { insertGatewayPayment, updateGatewayPaymentStatus } from './gatewayPaymentRepository.js';
import { getActiveAutodebitConsentForProfile } from './fiuuAutodebitConsent.js';
import {
  buildFiuuCustId,
  getActiveFiuuPaymentTokenSecretForStudent,
  getFiuuPaymentTokenSecretById,
} from './fiuuTokenService.js';
const RECORD_TYPE_TOKEN = 'T';

function sanitizePipeField(value, maxLen) {
  const cleaned = String(value ?? '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, maxLen);
}

function buildRecurringPipeLine({
  merchantId,
  subMerchant,
  token,
  orderid,
  currency,
  amount,
  billingName,
  billingEmail,
  billingMobile,
  billingDescription,
  checksum,
  customerId,
}) {
  return [
    RECORD_TYPE_TOKEN,
    merchantId,
    subMerchant || '',
    token,
    orderid,
    currency,
    amount,
    billingName,
    billingEmail,
    billingMobile,
    billingDescription,
    checksum,
    customerId || '',
  ].join('|');
}

async function postRecurringRequest(pipeLine) {
  const url = getFiuuRecurringUrl();
  const body = new URLSearchParams({ '0': pipeLine }).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json, text/plain, */*',
    },
    body,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { httpStatus: res.status, raw: text, parsed };
}

function normalizeAcceptedResult(parsed, orderid) {
  if (!parsed) return { status: 'failed', reason: 'Non-JSON recurring response', orderid };
  const row = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!row || typeof row !== 'object') {
    return { status: 'failed', reason: 'Unexpected recurring response shape', orderid };
  }
  return {
    status: String(row.status || '').toLowerCase(),
    orderid: row.orderid || orderid,
    tranID: row.tranID ?? row.tranId ?? null,
    reason: row.reason || '',
  };
}

async function loadBillingContact(studentId, invoiceId) {
  const result = await query(
    `SELECT u.user_id, u.full_name, u.email, u.phone_number,
            COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
            i.invoice_description, i.amount, i.status AS invoice_status, i.branch_id
     FROM userstbl u
     INNER JOIN invoicestudentstbl ist ON ist.student_id = u.user_id AND ist.invoice_id = $1
     INNER JOIN invoicestbl i ON i.invoice_id = $1
     LEFT JOIN branchestbl b ON i.branch_id = b.branch_id
     WHERE u.user_id = $2
     LIMIT 1`,
    [invoiceId, studentId]
  );
  return result.rows[0] || null;
}

async function resolveTokenForConsent(consent, studentId) {
  if (consent?.fiuu_payment_token_id) {
    const byId = await getFiuuPaymentTokenSecretById(consent.fiuu_payment_token_id);
    if (byId?.fiuu_token) return byId;
  }
  return getActiveFiuuPaymentTokenSecretForStudent(studentId);
}

async function hasOpenMitForInvoice(invoiceId) {
  const result = await query(
    `SELECT gateway_payment_id, orderid, status
     FROM gateway_paymentstbl
     WHERE invoice_id = $1
       AND gateway = 'FIUU'
       AND status IN ('pending', 'paid')
       AND (
         COALESCE(metadata->>'mit', '') = 'true'
         OR COALESCE(metadata->>'payment_type', '') = 'LCA AutoPay MIT'
       )
     ORDER BY created_at DESC
     LIMIT 1`,
    [invoiceId]
  );
  return result.rows[0] || null;
}

async function sendFallbackPayLink({ invoiceId, studentId, reason }) {
  try {
    // Dynamic import avoids circular dependency with fiuuPaymentService.
    const { createFiuuInvoicePayment } = await import('./fiuuPaymentService.js');
    const created = await createFiuuInvoicePayment({
      invoice_id: invoiceId,
      student_id: studentId,
      created_by: null,
      initiator_name: 'LCA AutoPay fallback',
      send_email: true,
      disable_after_payment: true,
    });
    console.warn(
      `[fiuu-mit] Fallback pay link emailed for invoice ${invoiceId} (reason=${reason}, orderid=${created?.orderid || 'n/a'})`
    );
    return { emailed: true, orderid: created?.orderid || null };
  } catch (err) {
    console.error(
      `[fiuu-mit] Fallback pay link failed for invoice ${invoiceId}:`,
      err?.message || err
    );
    return { emailed: false, error: err?.message || String(err) };
  }
}

/**
 * Attempt MIT charge for a newly generated installment invoice when AutoPay is active.
 * Non-fatal — never throws into the invoice generator; returns a result object.
 *
 * @param {{ invoiceId: number, profileId: number, studentId: number }} params
 */
export async function tryAutopayInstallmentInvoice({ invoiceId, profileId, studentId }) {
  const invId = parseInt(invoiceId, 10);
  const profId = parseInt(profileId, 10);
  const studId = parseInt(studentId, 10);

  if (!Number.isFinite(invId) || !Number.isFinite(profId) || !Number.isFinite(studId)) {
    return { attempted: false, reason: 'invalid_ids' };
  }

  if (!isFiuuAutopayMitEnabled()) {
    return { attempted: false, reason: 'mit_disabled' };
  }
  if (!isFiuuConfigured()) {
    return { attempted: false, reason: 'fiuu_not_configured' };
  }

  try {
    const consent = await getActiveAutodebitConsentForProfile(profId);
    if (!consent) {
      return { attempted: false, reason: 'no_active_consent' };
    }
    if (Number(consent.student_id) !== studId) {
      return { attempted: false, reason: 'consent_student_mismatch' };
    }
    if (!consent.parent_opt_in) {
      return { attempted: false, reason: 'parent_not_opted_in' };
    }

    const existing = await hasOpenMitForInvoice(invId);
    if (existing) {
      return {
        attempted: false,
        reason: 'mit_already_open',
        orderid: existing.orderid,
        status: existing.status,
      };
    }

    const contact = await loadBillingContact(studId, invId);
    if (!contact) {
      return { attempted: false, reason: 'invoice_student_not_found' };
    }
    if (String(contact.invoice_status || '').toLowerCase() === 'paid') {
      return { attempted: false, reason: 'invoice_already_paid' };
    }

    const amountNum = parseFloat(contact.amount);
    if (!Number.isFinite(amountNum) || amountNum <= 1) {
      // FIUU requires amount > 1.00
      return { attempted: false, reason: 'amount_below_fiuu_minimum', amount: amountNum };
    }

    const tokenRow = await resolveTokenForConsent(consent, studId);
    const token = String(tokenRow?.fiuu_token || '').trim();
    if (!token) {
      const fallback = await sendFallbackPayLink({
        invoiceId: invId,
        studentId: studId,
        reason: 'no_active_token',
      });
      return { attempted: false, reason: 'no_active_token', fallback };
    }

    const merchantId = getFiuuMerchantId();
    const subMerchant = getFiuuSubMerchantId();
    const currency = getFiuuCurrency();
    const amount = formatFiuuAmount(amountNum);
    const orderid = buildInvoiceOrderId(invId);
    const customerId =
      String(tokenRow.fiuu_cust_id || '').trim() || buildFiuuCustId(studId);

    const billingName = sanitizePipeField(contact.full_name || 'Student', 50) || 'Student';
    const billingEmail = sanitizePipeField(contact.email || '', 100);
    const billingMobile = sanitizePipeField(
      String(contact.phone_number || '').replace(/[^\d+]/g, ''),
      20
    );
    if (!billingEmail && !billingMobile && !customerId) {
      const fallback = await sendFallbackPayLink({
        invoiceId: invId,
        studentId: studId,
        reason: 'missing_billing_contact',
      });
      return { attempted: false, reason: 'missing_billing_contact', fallback };
    }

    const description = sanitizePipeField(
      formatFiuuDescription({
        typeLabel: 'LCA AutoPay',
        studentName: billingName,
        branchName: contact.branch_name || 'Branch',
        refLabel: contact.invoice_description || `INV-${invId}`,
        amountPhp: amountNum,
        initiatorName: 'MIT',
      }),
      300
    );

    const checksum = buildRecurringChecksum({
      recordType: RECORD_TYPE_TOKEN,
      merchantId,
      subMerchant,
      token,
      orderid,
      currency,
      amount,
    });

    const pipeLine = buildRecurringPipeLine({
      merchantId,
      subMerchant,
      token,
      orderid,
      currency,
      amount,
      billingName,
      billingEmail,
      billingMobile,
      billingDescription: description,
      checksum,
      customerId,
    });

    const gatewayRow = await insertGatewayPayment({
      gateway: 'FIUU',
      orderid,
      target_type: 'invoice',
      target_id: invId,
      student_id: studId,
      branch_id: contact.branch_id || null,
      invoice_id: invId,
      amount: amountNum,
      currency,
      description_sent: description,
      metadata: {
        mit: true,
        payment_type: 'LCA AutoPay MIT',
        record_type: RECORD_TYPE_TOKEN,
        fiuu_autodebit_consent_id: consent.fiuu_autodebit_consent_id,
        fiuu_payment_token_id: tokenRow.fiuu_payment_token_id,
        installmentinvoiceprofiles_id: profId,
        card_last4: tokenRow.card_last4 || null,
        card_brand: tokenRow.card_brand || null,
      },
      raw_request: {
        recurring_url: getFiuuRecurringUrl(),
        // Never store raw token in DB request log
        pipe_preview: pipeLine.replace(token, `[TOKEN:${token.length}]`),
      },
      created_by: null,
    });

    let apiResult;
    try {
      apiResult = await postRecurringRequest(pipeLine);
    } catch (netErr) {
      await updateGatewayPaymentStatus(gatewayRow.gateway_payment_id, {
        status: 'failed',
        raw_webhook: { error: netErr?.message || String(netErr), stage: 'recurring_http' },
      });
      const fallback = await sendFallbackPayLink({
        invoiceId: invId,
        studentId: studId,
        reason: 'recurring_network_error',
      });
      return {
        attempted: true,
        accepted: false,
        reason: 'recurring_network_error',
        orderid,
        error: netErr?.message || String(netErr),
        fallback,
      };
    }

    const acceptedRow = normalizeAcceptedResult(apiResult.parsed, orderid);
    await updateGatewayPaymentStatus(gatewayRow.gateway_payment_id, {
      status: acceptedRow.status === 'accepted' ? 'pending' : 'failed',
      fiuu_tran_id: acceptedRow.tranID ? String(acceptedRow.tranID) : null,
      raw_webhook: {
        recurring_http_status: apiResult.httpStatus,
        recurring_response: apiResult.parsed || apiResult.raw,
      },
    });

    if (acceptedRow.status === 'accepted') {
      console.log(
        `[fiuu-mit] Accepted MIT for invoice ${invId} orderid=${orderid} tranID=${acceptedRow.tranID || 'n/a'}`
      );
      return {
        attempted: true,
        accepted: true,
        orderid,
        tranID: acceptedRow.tranID,
        gateway_payment_id: gatewayRow.gateway_payment_id,
      };
    }

    console.warn(
      `[fiuu-mit] Rejected MIT for invoice ${invId} orderid=${orderid}: ${acceptedRow.reason || 'failed'}`
    );
    const fallback = await sendFallbackPayLink({
      invoiceId: invId,
      studentId: studId,
      reason: acceptedRow.reason || 'recurring_rejected',
    });
    return {
      attempted: true,
      accepted: false,
      orderid,
      reason: acceptedRow.reason || 'recurring_rejected',
      fallback,
    };
  } catch (err) {
    console.error(`[fiuu-mit] Unexpected error for invoice ${invId}:`, err?.message || err);
    return { attempted: false, reason: 'unexpected_error', error: err?.message || String(err) };
  }
}
