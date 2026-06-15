/**
 * Enrollment acknowledgement receipt picker — combine Downpayment + Phase 1 pairs into one row.
 */
import {
  getArListCombinedPackageAmount,
  getArListLineTotal,
  getArListPackagePrimaryLabel,
} from './acknowledgementReceiptDisplay';

const roundCurrency = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export function isDownpaymentPlusPhase1EnrollmentLeader(row) {
  if (!row) return false;
  if (row.is_downpayment_plus_phase1_leader) return true;
  if (row.paired_ack_receipt_id) return true;
  return String(row.installment_option || '').toLowerCase() === 'downpayment_plus_phase1';
}

function getPairedPhaseLineTotal(row) {
  const pay = Number(row?.list_paired_phase_payment_amount ?? 0);
  const tip = Number(row?.list_paired_phase_tip_amount ?? 0);
  if (Number.isFinite(pay) || Number.isFinite(tip)) {
    return roundCurrency(pay + tip);
  }
  const paired = row?.enrollment_paired_ack_receipt;
  return paired ? getArListLineTotal(paired) : 0;
}

/** Normalize API/list rows to downpayment leader + optional Phase 1 follower. */
export function resolveAckReceiptLeaderPair(receipt, pairedReceipt = null) {
  if (!receipt) return { leader: null, phase1: null };
  if (isDownpaymentPlusPhase1EnrollmentLeader(receipt)) {
    return { leader: receipt, phase1: pairedReceipt || null };
  }
  if (pairedReceipt && isDownpaymentPlusPhase1EnrollmentLeader(pairedReceipt)) {
    return { leader: pairedReceipt, phase1: receipt };
  }
  if (receipt.is_paired_phase1_follower && pairedReceipt) {
    return { leader: pairedReceipt, phase1: receipt };
  }
  return { leader: receipt, phase1: null };
}

/**
 * Merge dual-row Downpayment + Phase 1 ARs into a single enrollment picker row (leader only).
 *
 * @param {object[]} rows
 * @returns {object[]}
 */
export function combineDownpaymentPhase1ForEnrollment(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const byId = new Map(
    rows.filter((r) => r?.ack_receipt_id).map((r) => [Number(r.ack_receipt_id), r])
  );

  const combined = [];

  for (const row of rows) {
    if (row.is_paired_phase1_follower) continue;

    if (isDownpaymentPlusPhase1EnrollmentLeader(row)) {
      const pairedId = Number(row.paired_ack_receipt_id || row.list_paired_phase_ack_receipt_id);
      const pairedFromList = Number.isFinite(pairedId) && pairedId > 0 ? byId.get(pairedId) : null;
      const leaderLine = getArListLineTotal(row);
      const phaseLine = getPairedPhaseLineTotal(row) || (pairedFromList ? getArListLineTotal(pairedFromList) : 0);
      const downpaymentLabel = getArListPackagePrimaryLabel(row);
      const phaseLabel =
        String(row.list_paired_phase_package_name || '').trim() ||
        (pairedFromList ? getArListPackagePrimaryLabel(pairedFromList) : '(Phase 1)');
      const downpaymentPkgAmt = getArListCombinedPackageAmount(row);
      const phasePkgAmt =
        row.list_paired_phase_package_amount != null
          ? Number(row.list_paired_phase_package_amount)
          : pairedFromList
            ? getArListCombinedPackageAmount(pairedFromList)
            : 0;

      combined.push({
        ...row,
        enrollment_is_combined_pair: true,
        enrollment_combined_line_total: roundCurrency(leaderLine + phaseLine),
        enrollment_package_title: 'Downpayment + Phase 1',
        enrollment_package_subtitle: `${downpaymentLabel} · ${phaseLabel}`,
        enrollment_combined_package_amount: roundCurrency(downpaymentPkgAmt + phasePkgAmt),
        enrollment_paired_ack_receipt: pairedFromList || null,
        enrollment_paired_phase_status:
          row.list_paired_phase_status ||
          pairedFromList?.status ||
          null,
      });
    } else {
      combined.push({ ...row, enrollment_is_combined_pair: false });
    }
  }

  return combined;
}

export function getEnrollmentAckReceiptLineTotal(row) {
  if (row?.enrollment_combined_line_total != null) {
    return Number(row.enrollment_combined_line_total);
  }
  return getArListLineTotal(row);
}

export function getEnrollmentAckReceiptPackageTitle(row) {
  if (row?.enrollment_package_title) return row.enrollment_package_title;
  return getArListPackagePrimaryLabel(row);
}

export function getEnrollmentAckReceiptPackageSubtitle(row) {
  if (row?.enrollment_package_subtitle) return row.enrollment_package_subtitle;
  return null;
}

export function getEnrollmentAckReceiptPackageAmount(row) {
  if (row?.enrollment_combined_package_amount != null) {
    return Number(row.enrollment_combined_package_amount);
  }
  return getArListCombinedPackageAmount(row);
}

function isAckRowUsableForEnrollment(row) {
  if (!row) return false;
  const isCashMethod = String(row.payment_method || '').trim().toLowerCase() === 'cash';
  const isVerified = String(row.status || '').trim() === 'Verified';
  const blocked = ['Rejected', 'Cancelled', 'Returned'].includes(String(row.status || '').trim());
  if (blocked) return false;
  return isVerified || isCashMethod;
}

export function canUseEnrollmentAckReceipt(row) {
  if (!row) return false;
  if (row.enrollment_is_combined_pair) {
    const pairedOk = isAckRowUsableForEnrollment({
      status: row.enrollment_paired_phase_status,
      payment_method: row.payment_method,
    });
    return isAckRowUsableForEnrollment(row) && pairedOk;
  }
  return isAckRowUsableForEnrollment(row);
}

export function getEnrollmentAckReceiptDisabledReason(row) {
  if (canUseEnrollmentAckReceipt(row)) return '';
  const isCashMethod = String(row?.payment_method || '').trim().toLowerCase() === 'cash';
  if (row?.enrollment_is_combined_pair) {
    const leaderOk = isAckRowUsableForEnrollment(row);
    const pairedOk = isAckRowUsableForEnrollment({
      status: row.enrollment_paired_phase_status,
      payment_method: row.payment_method,
    });
    if (!leaderOk || !pairedOk) {
      return isCashMethod
        ? 'This downpayment + Phase 1 receipt cannot be used (returned or rejected).'
        : 'Both downpayment and Phase 1 must be verified by Finance/Superfinance before enrollment.';
    }
  }
  return isCashMethod
    ? 'This receipt cannot be used (returned or rejected).'
    : 'This receipt is not verified yet. Finance/Superfinance must verify it first.';
}
