/**
 * Start FIUU payment for Merchandise or Package AR create (pending AR + gateway row).
 */
import { getClient } from '../../config/database.js';
import { allocateNextArStyleNumber } from '../../utils/invoiceArNumber.js';
import { collectPhilippineMobiles } from '../../utils/sms/semaphoreSmsService.js';
import { AR_STATUS } from '../../utils/acknowledgementReceiptStatus.js';
import {
  getFiuuCallbackUrl,
  getFiuuCurrency,
  getFiuuDefaultChannel,
  getFiuuMerchantId,
  getFiuuNotifyUrl,
  getFiuuPayBaseUrl,
  getFiuuReturnUrl,
  isFiuuConfigured,
  resolveFiuuChannelPath,
} from './config.js';
import { buildArOrderId, formatFiuuDescription } from './orderId.js';
import { buildPaymentVcode, formatFiuuAmount } from './signature.js';
import { attachPayLinkToMetadata, buildFiuuPublicPayPageUrl } from './payLink.js';
import { sendFiuuPaymentLinkEmail, loadBranchForPayEmail } from './sendFiuuPaymentLinkEmail.js';
import { normalizeNotificationRecipients } from '../../utils/emailService.js';

const FIUU_AR_PAYMENT_METHOD = 'FIUU Online';

function httpError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

/**
 * @param {object} params
 * @param {object} params.arPayload - same fields as POST /acknowledgement-receipts (Package|Merchandise)
 */
export async function createFiuuArPayment({
  arPayload,
  created_by,
  initiator_name,
  channel,
  userBranchId = null,
  send_email = false,
  recipient_email,
  pay_link_expires_on,
  disable_after_payment = true,
  send_copy_to_me = false,
  staff_email,
}) {
  if (!isFiuuConfigured()) {
    throw httpError('FIUU is not configured on the server', 503);
  }

  const arType = String(arPayload?.ar_type || 'Package').trim();
  if (arType !== 'Merchandise' && arType !== 'Package') {
    throw httpError('FIUU AR payments support Merchandise and Package only');
  }

  if (arType === 'Package' && arPayload?.installment_option === 'downpayment_plus_phase1') {
    throw httpError(
      'FIUU is not available for downpayment + Phase 1 split. Use downpayment only, or pay manually.'
    );
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const prospect_student_name = String(arPayload.prospect_student_name || '').trim();
    const prospect_student_contact = String(arPayload.prospect_student_contact || '').trim();
    const prospect_student_email = String(arPayload.prospect_student_email || '')
      .trim()
      .toLowerCase() || null;
    const prospect_student_notes = String(arPayload.prospect_student_notes || '').trim() || null;
    const level_tag = String(arPayload.level_tag || '').trim() || null;
    const linkedStudentId =
      arPayload.student_id != null ? parseInt(arPayload.student_id, 10) : null;
    const tip_amount = Math.max(0, parseFloat(arPayload.tip_amount || 0) || 0);
    const discountValue = Math.max(0, parseFloat(arPayload.discount_amount || 0) || 0);
    const issue_date = arPayload.issue_date;
    if (!issue_date) {
      throw httpError('Issue date is required');
    }

    if (!prospect_student_name) {
      throw httpError('Student name is required');
    }
    if (!prospect_student_contact) {
      throw httpError('Guardian name is required for acknowledgement receipt');
    }

    const arPhoneNumbers = collectPhilippineMobiles(arPayload.prospect_student_phone);
    if (arPhoneNumbers.length === 0) {
      throw httpError(
        'A valid Philippine mobile number is required for SMS payment confirmation (e.g. 09171234567)'
      );
    }
    const normalizedProspectPhone = arPhoneNumbers[0];

    let branchId =
      arPayload.branch_id != null ? parseInt(arPayload.branch_id, 10) : userBranchId || null;

    let totalPaymentAmount = 0;
    let merchandiseItemsSnapshot = null;
    let packageNameSnapshot = null;
    let packageAmountSnapshot = null;
    let pkgId = null;
    let installment_option = null;

    if (arType === 'Merchandise') {
      const merchandise_items = Array.isArray(arPayload.merchandise_items)
        ? arPayload.merchandise_items
        : [];
      if (merchandise_items.length === 0) {
        throw httpError('At least one merchandise item is required');
      }

      const merchSnapshots = [];
      let totalAmount = 0;

      for (const raw of merchandise_items) {
        const merchId = parseInt(raw.merchandise_id, 10);
        const qty = parseInt(raw.quantity, 10) || 0;
        if (!merchId || qty < 1) {
          throw httpError('Each merchandise item needs a valid merchandise_id and quantity');
        }

        const merchResult = await client.query(
          `SELECT merchandise_id, merchandise_name, size, price, quantity, branch_id
           FROM merchandisestbl WHERE merchandise_id = $1`,
          [merchId]
        );
        if (merchResult.rows.length === 0) {
          throw httpError(`Merchandise ${merchId} not found`, 404);
        }

        const merch = merchResult.rows[0];
        const price = parseFloat(merch.price) || 0;
        totalAmount += price * qty;

        if (merch.branch_id && branchId && merch.branch_id !== branchId) {
          throw httpError(`Merchandise "${merch.merchandise_name}" belongs to a different branch`);
        }
        if (!branchId && merch.branch_id) {
          branchId = merch.branch_id;
        }

        const availableQty = merch.quantity != null ? parseInt(merch.quantity, 10) : null;
        if (availableQty !== null && availableQty < qty) {
          throw httpError(
            `Insufficient stock for ${merch.merchandise_name}${merch.size ? ` (${merch.size})` : ''}. Available: ${availableQty}, Requested: ${qty}`
          );
        }

        merchSnapshots.push({
          merchandise_id: merch.merchandise_id,
          merchandise_name: merch.merchandise_name,
          size: merch.size,
          quantity: qty,
          price,
          branch_id: merch.branch_id || branchId,
        });
      }

      merchandiseItemsSnapshot = merchSnapshots;
      totalPaymentAmount = totalAmount;
    } else {
      const package_id = parseInt(arPayload.package_id, 10);
      if (!package_id) {
        throw httpError('Package ID is required for package acknowledgement receipt');
      }

      const pkgResult = await client.query(
        `SELECT package_id, package_name, package_price, branch_id, package_type, downpayment_amount, payment_option
         FROM packagestbl WHERE package_id = $1`,
        [package_id]
      );
      if (pkgResult.rows.length === 0) {
        throw httpError('Package not found', 404);
      }

      const pkg = pkgResult.rows[0];
      pkgId = pkg.package_id;
      packageNameSnapshot = pkg.package_name;
      packageAmountSnapshot = pkg.package_price;
      branchId = branchId || pkg.branch_id || null;
      installment_option =
        arPayload.installment_option === 'downpayment_plus_phase1'
          ? 'downpayment_plus_phase1'
          : arPayload.installment_option === 'downpayment_only'
            ? 'downpayment_only'
            : null;

      const isInstallmentPkg =
        (pkg.package_type || '').toLowerCase() === 'installment' ||
        (pkg.package_type === 'Phase' && (pkg.payment_option || '').toLowerCase() === 'installment');
      const downpayment = parseFloat(pkg.downpayment_amount ?? 0) || 0;
      const monthly = parseFloat(pkg.package_price ?? 0) || 0;

      if (isInstallmentPkg && downpayment > 0) {
        totalPaymentAmount =
          installment_option === 'downpayment_plus_phase1' ? downpayment + monthly : downpayment;
      } else {
        totalPaymentAmount = monthly;
      }
    }

    if (!branchId) {
      throw httpError('Branch is required to create an acknowledgement receipt');
    }

    const branchCheck = await client.query(
      'SELECT branch_id, COALESCE(branch_nickname, branch_name) AS branch_name FROM branchestbl WHERE branch_id = $1',
      [branchId]
    );
    if (branchCheck.rows.length === 0) {
      throw httpError('Branch not found', 404);
    }
    const branchName = branchCheck.rows[0].branch_name;

    if (totalPaymentAmount <= 0) {
      throw httpError('Payment amount must be greater than 0');
    }
    if (discountValue > 0 && discountValue >= totalPaymentAmount) {
      throw httpError('Discount amount must be less than the payment amount.');
    }

    const payAmt = Math.max(0, totalPaymentAmount - discountValue);
    if (payAmt <= 0.009) {
      throw httpError('Payable amount after discount must be greater than 0');
    }

    const chargeAmt = payAmt + tip_amount;
    if (chargeAmt <= 0.009) {
      throw httpError('Charge amount must be greater than 0');
    }

    const ackNumber = await allocateNextArStyleNumber(client);
    const insertResult = await client.query(
      `INSERT INTO acknowledgement_receiptstbl (
         ack_receipt_number, status, ar_type,
         prospect_student_name, prospect_student_contact, prospect_student_email,
         prospect_student_phone, prospect_student_notes, student_id, branch_id,
         package_id, package_name_snapshot, package_amount_snapshot,
         merchandise_items_snapshot, payment_amount, tip_amount, issue_date,
         payment_method, reference_number, payment_attachment_url, level_tag,
         installment_option, invoice_id, payment_id, created_by
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         $14, $15, $16, $17, $18, NULL, NULL, $19, $20, NULL, NULL, $21
       )
       RETURNING *`,
      [
        ackNumber,
        AR_STATUS.UNVERIFIED,
        arType,
        prospect_student_name,
        prospect_student_contact,
        prospect_student_email,
        normalizedProspectPhone,
        prospect_student_notes,
        linkedStudentId || null,
        branchId,
        pkgId,
        packageNameSnapshot,
        packageAmountSnapshot,
        merchandiseItemsSnapshot ? JSON.stringify(merchandiseItemsSnapshot) : null,
        payAmt,
        tip_amount,
        issue_date,
        FIUU_AR_PAYMENT_METHOD,
        level_tag,
        arType === 'Package' ? installment_option || null : null,
        created_by || null,
      ]
    );

    const ackReceipt = insertResult.rows[0];
    const ackId = ackReceipt.ack_receipt_id;
    const orderid = buildArOrderId(ackId);
    const amount = formatFiuuAmount(chargeAmt);
    const currency = getFiuuCurrency();
    const fiuuChannel = channel || getFiuuDefaultChannel();
    const description = formatFiuuDescription({
      typeLabel: arType === 'Merchandise' ? 'AR Merchandise' : 'AR Package',
      studentName: prospect_student_name,
      branchName,
      refLabel: ackReceipt.ack_receipt_number || `AR-${ackId}`,
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
      bill_name: prospect_student_name || 'Student',
      bill_email: prospect_student_email || '',
      bill_mobile: normalizedProspectPhone || '',
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
        payment_type: 'AR',
        ar_type: arType,
        ack_receipt_id: ackId,
        tip_amount,
        discount_amount: discountValue,
        charge_amount: chargeAmt,
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

    await client.query(
      `INSERT INTO gateway_paymentstbl (
         gateway, orderid, target_type, target_id, student_id, branch_id, invoice_id,
         amount, currency, description_sent, status, metadata, raw_request, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12,$13)`,
      [
        'FIUU',
        orderid,
        'ack_receipt',
        ackId,
        linkedStudentId || null,
        branchId,
        null,
        chargeAmt,
        currency,
        description,
        JSON.stringify(metadata),
        JSON.stringify(formFields),
        created_by ?? null,
      ]
    );

    await client.query('COMMIT');

    let emailResult = null;
    if (send_email) {
      const recipients = resolveArPayLinkRecipients(recipient_email, prospect_student_email);
      const branch = await loadBranchForPayEmail(branchId);
      emailResult = await sendFiuuPaymentLinkEmail({
        to: recipients,
        payLinkUrl,
        amount: chargeAmt,
        studentName: prospect_student_name || 'Client',
        refLabel: ackReceipt.ack_receipt_number || `AR-${ackId}`,
        itemDescription:
          arType === 'Merchandise'
            ? 'Merchandise (acknowledgement receipt)'
            : packageNameSnapshot || 'Package (acknowledgement receipt)',
        orderid,
        paymentTypeLabel: `Acknowledgement Receipt — ${arType}`,
        branch,
        tipAmount: tip_amount,
        discountAmount: discountValue,
        expiresAt: metadata.pay_link_expires_at
          ? String(metadata.pay_link_expires_at).slice(0, 10)
          : '',
        ccEmails: send_copy_to_me && staff_email ? [staff_email] : [],
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
      ack_receipt_id: ackId,
      ack_receipt_number: ackReceipt.ack_receipt_number,
      ar_type: arType,
      pay_link_url: payLinkUrl,
      pay_link_token: metadata.pay_link_token,
      email: emailResult,
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

function resolveArPayLinkRecipients(recipientEmail, prospectEmail) {
  if (recipientEmail != null && String(recipientEmail).trim() !== '') {
    const list = normalizeNotificationRecipients(
      Array.isArray(recipientEmail) ? recipientEmail : String(recipientEmail).split(/[,;]/)
    );
    if (list.length === 0) {
      throw httpError('recipient_email is not a valid email address');
    }
    return list;
  }
  const list = normalizeNotificationRecipients([prospectEmail]);
  if (list.length === 0) {
    throw httpError(
      'Client email is required to send the FIUU payment link. Enter an email on Step 1 or in the FIUU panel.'
    );
  }
  return list;
}

export { FIUU_AR_PAYMENT_METHOD };
