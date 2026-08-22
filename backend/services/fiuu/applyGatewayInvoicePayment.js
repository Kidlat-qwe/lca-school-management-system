/**
 * Records a full invoice payment from FIUU gateway success.
 * Supports optional tip (+) and discount (−) stored on the gateway row metadata.
 */
import { coerceToManilaYmd, todayYmdManila } from '../../utils/dateUtils.js';
import { getPriorPartialBalanceBlockers } from '../../lib/installmentPaymentEligibility.js';
import { paymenttblHasActionOwnerUserIdColumn } from '../../utils/paymentSchema.js';
import { syncProgramPaymentStatusForInvoice } from '../../utils/programPaymentStatusService.js';
import { syncInstallmentEnrollmentForPaidInvoice } from '../../utils/installmentEnrollmentSync.js';
import { syncArVerifiedFromPaymentApproval } from '../../lib/arPaymentVerificationSync.js';
import { tryIssuePackageMerchandiseOnFirstPayment } from '../../lib/merchandiseReleaseLog.js';
import {
  ensurePendingEnrollmentAfterDownpaymentPaid,
  isRejoinClassInvoice,
  parseInstallmentProfileIdFromRemarks,
  parseRejoinPhaseFromRemarks,
  syncInstallmentProfileAfterRejoinPayment,
} from '../../utils/enrollmentStatus.js';
import {
  buildPhaseInstallmentSchedule,
  getPhaseDueDateYmd,
  isPhaseInstallmentProfile,
} from '../../utils/phaseInstallmentUtils.js';
import { enrollStudentForFullPaymentPhases } from '../../utils/fullPaymentPhaseEnrollment.js';
import {
  computeOriginalInvoiceAmount,
  getChainRootInvoiceId,
  isDownpaymentChainFullySettled,
  isInvoiceOnProfileDownpaymentChain,
} from '../../utils/balanceInvoice.js';

async function syncInstallmentProfileForRejoinInvoice({ client, invoice, studentId }) {
  if (!invoice?.remarks || !isRejoinClassInvoice(invoice.remarks)) return;

  const profileId =
    invoice.installmentinvoiceprofiles_id != null
      ? parseInt(invoice.installmentinvoiceprofiles_id, 10)
      : parseInstallmentProfileIdFromRemarks(invoice.remarks);
  const rejoinPhase = parseRejoinPhaseFromRemarks(invoice.remarks);
  if (!profileId || !rejoinPhase) return;

  await syncInstallmentProfileAfterRejoinPayment(client, profileId, studentId, rejoinPhase);
}

async function createFirstInstallmentRecordAfterDownpayment({
  client,
  profileId,
  profile,
  studentName,
  paymentIssueDate,
}) {
  const paymentDateYmd = coerceToManilaYmd(paymentIssueDate, { fallbackToToday: true });

  let scheduledDateYmd = profile.bill_invoice_due_date || paymentDateYmd;
  let firstGenerationYmd = paymentDateYmd;
  let currentInvoiceMonthYmd = paymentDateYmd;

  if (isPhaseInstallmentProfile(profile)) {
    const phaseSchedule = await buildPhaseInstallmentSchedule({
      db: client,
      profile,
      generatedCountOverride: 0,
      issueDateOverride: paymentDateYmd,
    });
    if (phaseSchedule?.current_due_date) scheduledDateYmd = phaseSchedule.current_due_date;
    if (phaseSchedule?.next_generation_date) firstGenerationYmd = phaseSchedule.next_generation_date;
    if (phaseSchedule?.next_invoice_month) currentInvoiceMonthYmd = phaseSchedule.next_invoice_month;
  } else if (profile.class_id) {
    const nonPhaseFirstDueYmd = await getPhaseDueDateYmd(client, profile.class_id, 1);
    if (nonPhaseFirstDueYmd) scheduledDateYmd = nonPhaseFirstDueYmd;
  }

  const firstInvoiceRecordResult = await client.query(
    `INSERT INTO installmentinvoicestbl 
     (installmentinvoiceprofiles_id, scheduled_date, status, student_name, 
      total_amount_including_tax, total_amount_excluding_tax, frequency, 
      next_generation_date, next_invoice_month)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      profileId,
      scheduledDateYmd,
      'Pending',
      studentName,
      profile.amount,
      profile.amount,
      profile.frequency || '1 month(s)',
      firstGenerationYmd,
      currentInvoiceMonthYmd,
    ]
  );

  return { firstInvoiceRecord: firstInvoiceRecordResult.rows[0] };
}

/**
 * @returns {Promise<{ payment_id: number, invoice_id: number, newInvoiceStatus: string, pendingInvoiceGeneration?: object, pendingCatchUpGeneration?: object }>}
 */
export async function applyGatewayInvoiceFullPayment(client, params) {
  const {
    invoice_id,
    student_id,
    payable_amount,
    discount_amount = 0,
    tip_amount = 0,
    reference_number,
    payment_method,
    created_by,
    issue_date,
    remarks,
    fiuu_channel,
  } = params;

  const invoiceCheck = await client.query(
    'SELECT *, installmentinvoiceprofiles_id, ack_receipt_id FROM invoicestbl WHERE invoice_id = $1 FOR UPDATE',
    [invoice_id]
  );
  if (invoiceCheck.rows.length === 0) {
    throw Object.assign(new Error('Invoice not found'), { statusCode: 404 });
  }
  const invoice = invoiceCheck.rows[0];

  if (invoice.status === 'Paid') {
    throw Object.assign(new Error('Invoice is already fully paid'), { statusCode: 400 });
  }
  if (invoice.balance_invoice_id) {
    throw Object.assign(
      new Error('Record payment on the balance continuation invoice instead'),
      { statusCode: 400 }
    );
  }

  if (invoice.installmentinvoiceprofiles_id) {
    const priorBlock = await getPriorPartialBalanceBlockers(client, invoice_id);
    if (priorBlock.blocked) {
      throw Object.assign(new Error(priorBlock.message), { statusCode: 400 });
    }
  }

  const studentCheck = await client.query('SELECT user_id FROM userstbl WHERE user_id = $1', [
    student_id,
  ]);
  if (studentCheck.rows.length === 0) {
    throw Object.assign(new Error('Student not found'), { statusCode: 404 });
  }

  const invoiceStudentCheck = await client.query(
    'SELECT 1 FROM invoicestudentstbl WHERE invoice_id = $1 AND student_id = $2',
    [invoice_id, student_id]
  );
  if (invoiceStudentCheck.rows.length === 0) {
    throw Object.assign(new Error('Student is not associated with this invoice'), {
      statusCode: 400,
    });
  }

  const remaining = parseFloat(invoice.amount) || 0;
  const discountApplied = Math.max(0, parseFloat(discount_amount) || 0);
  const tipApplied = Math.max(0, parseFloat(tip_amount) || 0);
  // Net toward invoice = FIUU charge minus tip (tip is extra cash, not balance settlement).
  // Prefer explicit payable_amount from metadata when present.
  let netPayable = parseFloat(payable_amount);
  if (!Number.isFinite(netPayable)) {
    netPayable = Math.max(0, remaining - discountApplied);
  }
  netPayable = Math.max(0, netPayable);

  if (discountApplied >= remaining && remaining > 0) {
    throw Object.assign(new Error('Discount amount must be less than invoice remaining balance'), {
      statusCode: 400,
    });
  }
  if (netPayable <= 0) {
    throw Object.assign(new Error('Payable amount must be greater than 0'), { statusCode: 400 });
  }
  // Full settlement: net + discount must close remaining balance (same as manual Record Payment).
  if (Math.abs(netPayable + discountApplied - remaining) > 0.02) {
    throw Object.assign(
      new Error(
        `FIUU payment must settle the full remaining balance (PHP ${remaining.toFixed(2)}; got net ${netPayable.toFixed(2)} + discount ${discountApplied.toFixed(2)})`
      ),
      { statusCode: 400 }
    );
  }

  const branch_id = invoice.branch_id || null;
  const actionOwnerUserId = invoice.created_by != null ? invoice.created_by : created_by;
  const issueDateYmd = coerceToManilaYmd(issue_date || todayYmdManila(), { fallbackToToday: true });
  const methodLabel = fiuu_channel
    ? `FIUU - ${String(fiuu_channel).trim()}`
    : payment_method || 'FIUU Online';

  const remarkParts = [
    remarks,
    fiuu_channel ? `FIUU channel: ${fiuu_channel}` : null,
    'Auto-verified via FIUU gateway',
  ];
  if (discountApplied > 0) {
    remarkParts.push(
      `Discount applied at payment: ₱${discountApplied.toFixed(2)} (Original payable: ₱${remaining.toFixed(2)})`
    );
  }
  if (tipApplied > 0) {
    remarkParts.push(`Tip/payment adjustment: ₱${tipApplied.toFixed(2)}`);
  }
  const remarkText = remarkParts.filter(Boolean).join(' | ');

  const hasActionOwnerCol = await paymenttblHasActionOwnerUserIdColumn();
  const refNum = reference_number != null && String(reference_number).trim() !== ''
    ? String(reference_number).trim()
    : null;
  const insertSql = hasActionOwnerCol
    ? `INSERT INTO paymenttbl (
         invoice_id, student_id, branch_id, payment_method, payment_type,
         payable_amount, discount_amount, tip_amount, issue_date, status,
         reference_number, remarks, created_by, action_owner_user_id,
         approval_status, approved_by, approved_at, finance_verified_reference_number
       ) VALUES ($1,$2,$3,$4,'Full Payment',$5,$6,$7,$8::date,'Completed',$9,$10,$11,$12,'Approved',$11,CURRENT_TIMESTAMP,$13)
       RETURNING *`
    : `INSERT INTO paymenttbl (
         invoice_id, student_id, branch_id, payment_method, payment_type,
         payable_amount, discount_amount, tip_amount, issue_date, status,
         reference_number, remarks, created_by,
         approval_status, approved_by, approved_at, finance_verified_reference_number
       ) VALUES ($1,$2,$3,$4,'Full Payment',$5,$6,$7,$8::date,'Completed',$9,$10,$11,'Approved',$11,CURRENT_TIMESTAMP,$12)
       RETURNING *`;

  const insertParams = hasActionOwnerCol
    ? [
        invoice_id,
        student_id,
        branch_id,
        methodLabel,
        netPayable,
        discountApplied,
        tipApplied,
        issueDateYmd,
        refNum,
        remarkText || null,
        created_by,
        actionOwnerUserId,
        refNum,
      ]
    : [
        invoice_id,
        student_id,
        branch_id,
        methodLabel,
        netPayable,
        discountApplied,
        tipApplied,
        issueDateYmd,
        refNum,
        remarkText || null,
        created_by,
        refNum,
      ];

  const paymentResult = await client.query(insertSql, insertParams);
  const newPayment = paymentResult.rows[0];

  const totalPaymentsResult = await client.query(
    `SELECT COALESCE(SUM(payable_amount), 0) as total_paid,
            COALESCE(SUM(COALESCE(payable_amount, 0) + COALESCE(discount_amount, 0)), 0) as total_settled
     FROM paymenttbl
     WHERE invoice_id = $1 AND status = $2
       AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
    [invoice_id, 'Completed']
  );
  const totalSettled = parseFloat(totalPaymentsResult.rows[0].total_settled) || 0;

  const { originalInvoiceAmount } = await computeOriginalInvoiceAmount(
    client,
    invoice_id,
    invoice,
    totalSettled,
    netPayable
  );

  const remainingBalance = Math.max(0, originalInvoiceAmount - totalSettled);
  let newInvoiceStatus = invoice.status;
  let pendingInvoiceGeneration = null;
  let pendingCatchUpGeneration = null;

  await client.query('UPDATE invoicestbl SET amount = $1 WHERE invoice_id = $2', [
    remainingBalance,
    invoice_id,
  ]);

  if (totalSettled >= originalInvoiceAmount - 0.01) {
    newInvoiceStatus = 'Paid';
  } else if (totalSettled > 0) {
    newInvoiceStatus = 'Partially Paid';
  }

  if (newInvoiceStatus !== invoice.status) {
    await client.query('UPDATE invoicestbl SET status = $1 WHERE invoice_id = $2', [
      newInvoiceStatus,
      invoice_id,
    ]);
  }

  if (newInvoiceStatus === 'Paid' && invoice.ack_receipt_id) {
    const ackResult = await client.query(
      `SELECT ar_type, merchandise_items_snapshot, payment_method FROM acknowledgement_receiptstbl WHERE ack_receipt_id = $1`,
      [invoice.ack_receipt_id]
    );
    if (ackResult.rows.length > 0) {
      const ackRow = ackResult.rows[0];
      if (ackRow.ar_type === 'Merchandise') {
        const items = ackRow.merchandise_items_snapshot;
        if (items && Array.isArray(items)) {
          for (const item of items) {
            await client.query(
              `UPDATE merchandisestbl SET quantity = GREATEST(0, COALESCE(quantity, 0) - $1) WHERE merchandise_id = $2`,
              [parseInt(item.quantity, 10) || 1, item.merchandise_id]
            );
          }
        }
        await client.query(
          `UPDATE acknowledgement_receiptstbl SET status = 'Verified', payment_id = $1 WHERE ack_receipt_id = $2`,
          [newPayment.payment_id, invoice.ack_receipt_id]
        );
      } else {
        await client.query(
          `UPDATE acknowledgement_receiptstbl SET status = 'Applied', payment_id = $1 WHERE ack_receipt_id = $2`,
          [newPayment.payment_id, invoice.ack_receipt_id]
        );
      }
    }
  }

  if (newInvoiceStatus === 'Paid') {
    const reservationChainRootId = await getChainRootInvoiceId(client, invoice_id);
    const reservationCheck = await client.query(
      `SELECT reserved_id, status FROM reservedstudentstbl
       WHERE invoice_id = $1 OR invoice_id = $2`,
      [invoice_id, reservationChainRootId]
    );
    if (reservationCheck.rows.length > 0 && reservationCheck.rows[0].status === 'Reserved') {
      await client.query(
        `UPDATE reservedstudentstbl SET status = 'Fee Paid', reservation_fee_paid_at = CURRENT_TIMESTAMP WHERE reserved_id = $1`,
        [reservationCheck.rows[0].reserved_id]
      );
    }
  }

  if (
    (newInvoiceStatus === 'Paid' || newInvoiceStatus === 'Partially Paid') &&
    invoice.installmentinvoiceprofiles_id
  ) {
    if (isRejoinClassInvoice(invoice.remarks)) {
      let rejoinClassId = null;
      if (invoice.remarks?.includes('CLASS_ID:')) {
        const classMatch = invoice.remarks.match(/CLASS_ID:(\d+)/);
        if (classMatch) rejoinClassId = parseInt(classMatch[1], 10);
      }
      const rejoinPhase = parseRejoinPhaseFromRemarks(invoice.remarks);
      if (rejoinClassId && rejoinPhase) {
        await enrollStudentForFullPaymentPhases({
          client,
          studentId: student_id,
          classId: rejoinClassId,
          phaseStart: rejoinPhase,
          phaseEnd: rejoinPhase,
          sourceLabel: 'System (Auto-enrolled via FIUU rejoin payment)',
          invoiceId: invoice.invoice_id,
        });
        await syncInstallmentProfileForRejoinInvoice({ client, invoice, studentId: student_id });
      }
    } else {
      const profileResult = await client.query(
        `SELECT ip.class_id, ip.student_id, ip.total_phases, ip.generated_count,
                ip.downpayment_paid, ip.downpayment_invoice_id, ip.amount, ip.frequency,
                ip.first_generation_date, ip.next_invoice_due_date, ip.bill_invoice_due_date,
                ip.branch_id, ip.package_id, ip.description, ip.phase_start
         FROM installmentinvoiceprofilestbl ip
         WHERE ip.installmentinvoiceprofiles_id = $1`,
        [invoice.installmentinvoiceprofiles_id]
      );

      if (profileResult.rows.length > 0) {
        const profile = profileResult.rows[0];
        const isDownpaymentInvoice = await isInvoiceOnProfileDownpaymentChain(
          client,
          profile,
          invoice_id
        );
        const isFirstLinkedInvoice =
          !profile.downpayment_invoice_id &&
          !profile.downpayment_paid &&
          (profile.generated_count || 0) === 0;
        const dpAnchorId = profile.downpayment_invoice_id
          ? Number(profile.downpayment_invoice_id)
          : Number(invoice_id);
        const dpChainSettled =
          isDownpaymentInvoice || isFirstLinkedInvoice
            ? await isDownpaymentChainFullySettled(client, dpAnchorId)
            : false;
        const isPendingDownpayment =
          (isDownpaymentInvoice || isFirstLinkedInvoice) &&
          !profile.downpayment_paid &&
          dpChainSettled;

        if (isPendingDownpayment) {
          const dpRootId = await getChainRootInvoiceId(client, invoice_id);
          if (Number(profile.downpayment_invoice_id) !== Number(dpRootId)) {
            await client.query(
              `UPDATE installmentinvoiceprofilestbl SET downpayment_invoice_id = $1 WHERE installmentinvoiceprofiles_id = $2`,
              [dpRootId, invoice.installmentinvoiceprofiles_id]
            );
          }
          await client.query(
            `UPDATE installmentinvoiceprofilestbl SET downpayment_paid = true WHERE installmentinvoiceprofiles_id = $1`,
            [invoice.installmentinvoiceprofiles_id]
          );

          const studentResult = await client.query(
            'SELECT full_name FROM userstbl WHERE user_id = $1',
            [student_id]
          );
          const studentName = studentResult.rows[0]?.full_name || 'Student';
          const { firstInvoiceRecord } = await createFirstInstallmentRecordAfterDownpayment({
            client,
            profileId: invoice.installmentinvoiceprofiles_id,
            profile,
            studentName,
            paymentIssueDate: issueDateYmd,
          });

          await ensurePendingEnrollmentAfterDownpaymentPaid(client, profile, student_id);

          pendingInvoiceGeneration = {
            firstInvoiceRecord,
            profile: {
              student_id: profile.student_id,
              branch_id: profile.branch_id || invoice.branch_id || null,
              package_id: profile.package_id || invoice.package_id || null,
              amount: profile.amount,
              frequency: profile.frequency || '1 month(s)',
              description: profile.description || 'Monthly Installment Payment',
              generated_count: profile.generated_count || 0,
              class_id: profile.class_id,
              total_phases: profile.total_phases,
              phase_start: profile.phase_start,
            },
            profileId: invoice.installmentinvoiceprofiles_id,
            paymentIssueDateYmd: issueDateYmd,
          };
        } else if (profile.class_id && profile.student_id === student_id) {
          await syncInstallmentEnrollmentForPaidInvoice({
            client,
            profileId: invoice.installmentinvoiceprofiles_id,
            profile,
            studentId: student_id,
            sourceLabel: 'System (Auto-enrolled via FIUU installment payment)',
            invoice,
          });

          if (newInvoiceStatus === 'Paid' && Number(profile.generated_count || 0) === 1) {
            pendingCatchUpGeneration = {
              profileId: invoice.installmentinvoiceprofiles_id,
              paidInvoiceId: invoice_id,
              paymentIssueDateYmd: issueDateYmd,
            };
          }
        }
      }
    }
  }

  // Full payment (non-installment): enroll from CLASS_ID / PHASE_* in remarks — same as manual Record Payment.
  if (
    newInvoiceStatus === 'Paid' &&
    !invoice.installmentinvoiceprofiles_id &&
    invoice.invoice_description &&
    !invoice.invoice_description.includes('Reservation Fee') &&
    !String(invoice.remarks || '').includes('PACKAGE_CHANGE_TO_FULLPAYMENT')
  ) {
    try {
      let classId = null;
      if (invoice.remarks && invoice.remarks.includes('CLASS_ID:')) {
        const match = invoice.remarks.match(/CLASS_ID:(\d+)/);
        if (match) classId = parseInt(match[1], 10);
      }

      if (classId) {
        const classResult = await client.query(
          `SELECT c.class_id, c.program_id, cu.number_of_phase
           FROM classestbl c
           LEFT JOIN programstbl p ON c.program_id = p.program_id
           LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
           WHERE c.class_id = $1`,
          [classId]
        );

        if (classResult.rows.length > 0) {
          const classData = classResult.rows[0];
          const totalPhases = classData.number_of_phase || 1;
          let phaseStart = 1;
          let phaseEnd = totalPhases;
          if (invoice.remarks && invoice.remarks.includes('PHASE_START:')) {
            const startMatch = invoice.remarks.match(/PHASE_START:(\d+)/);
            if (startMatch) phaseStart = parseInt(startMatch[1], 10) || 1;
          }
          if (invoice.remarks && invoice.remarks.includes('PHASE_END:')) {
            const endMatch = invoice.remarks.match(/PHASE_END:(\d+)/);
            if (endMatch) phaseEnd = parseInt(endMatch[1], 10) || phaseStart;
          }
          if (phaseStart < 1) phaseStart = 1;
          if (phaseEnd > totalPhases) phaseEnd = totalPhases;
          if (phaseEnd < phaseStart) phaseEnd = phaseStart;

          const changedPhaseRows = await enrollStudentForFullPaymentPhases({
            client,
            studentId: student_id,
            classId,
            phaseStart,
            phaseEnd,
            sourceLabel: 'System (Auto-enrolled via FIUU full payment)',
            invoiceId: invoice.invoice_id || invoice_id,
          });

          if (changedPhaseRows > 0) {
            console.log(
              `✅ FIUU full payment: Auto-enrolled/reactivated ${changedPhaseRows} phase row(s) for student ${student_id} in phases ${phaseStart}-${phaseEnd} of class ${classId}`
            );
          }

          await syncInstallmentProfileForRejoinInvoice({
            client,
            invoice,
            studentId: student_id,
          });
        }
      }
    } catch (fullPaymentError) {
      console.error('FIUU: Error auto-enrolling student for full payment:', fullPaymentError);
    }
  }

  await tryIssuePackageMerchandiseOnFirstPayment(client, {
    invoice,
    studentId: student_id,
    paymentId: newPayment.payment_id,
    paymentIssueDate: issueDateYmd,
    createdBy: created_by,
  });

  await syncProgramPaymentStatusForInvoice(client, invoice_id);

  await syncArVerifiedFromPaymentApproval(client, {
    paymentIds: [Number(newPayment.payment_id)],
    verifierUserId: created_by,
  });

  return {
    payment_id: newPayment.payment_id,
    invoice_id,
    newInvoiceStatus,
    pendingInvoiceGeneration,
    pendingCatchUpGeneration,
  };
}

export async function runPostCommitInstallmentJobs(result) {
  if (result?.pendingInvoiceGeneration) {
    const { firstInvoiceRecord, profile, profileId, paymentIssueDateYmd } =
      result.pendingInvoiceGeneration;
    try {
      const { generateInvoiceFromInstallment } = await import('../../utils/installmentInvoiceGenerator.js');
      await generateInvoiceFromInstallment(firstInvoiceRecord, profile, {
        enrollmentInvoiceIssueYmd: paymentIssueDateYmd,
      });
      console.log(`✅ FIUU: Generated first installment invoice for profile ${profileId}`);
    } catch (err) {
      console.error(`⚠️ FIUU: First installment invoice generation failed for profile ${profileId}:`, err);
    }
  }

  if (result?.pendingCatchUpGeneration) {
    const { profileId, paidInvoiceId, paymentIssueDateYmd } = result.pendingCatchUpGeneration;
    try {
      const { tryGenerateCatchUpInstallmentAfterFirstPhasePayment } = await import(
        '../../utils/installmentInvoiceGenerator.js'
      );
      await tryGenerateCatchUpInstallmentAfterFirstPhasePayment({
        profileId,
        paidInvoiceId,
        paymentIssueDateYmd,
      });
    } catch (err) {
      console.error(`⚠️ FIUU: Catch-up generation failed for profile ${profileId}:`, err);
    }
  }
}
