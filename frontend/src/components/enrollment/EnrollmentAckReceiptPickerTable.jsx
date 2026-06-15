import { formatDateManila } from '../../utils/dateUtils';
import {
  canUseEnrollmentAckReceipt,
  combineDownpaymentPhase1ForEnrollment,
  getEnrollmentAckReceiptDisabledReason,
  getEnrollmentAckReceiptLineTotal,
  getEnrollmentAckReceiptPackageAmount,
  getEnrollmentAckReceiptPackageSubtitle,
  getEnrollmentAckReceiptPackageTitle,
} from '../../utils/enrollmentAckReceiptList';

const formatMoney = (value) =>
  `₱${Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Shared table for enrollment / upgrade acknowledgement receipt selection.
 * Downpayment + Phase 1 pairs render as one combined row.
 */
export default function EnrollmentAckReceiptPickerTable({
  ackReceipts,
  onUseReceipt,
  showReferenceColumn = true,
  minWidth = '780px',
}) {
  const rows = combineDownpaymentPhase1ForEnrollment(ackReceipts || []);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        No usable acknowledgement receipts found for this branch/search yet.
      </p>
    );
  }

  return (
    <div
      className="overflow-x-auto rounded-lg"
      style={{
        scrollbarWidth: 'thin',
        scrollbarColor: '#cbd5e0 #f7fafc',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <table className="min-w-full divide-y divide-gray-200 text-sm" style={{ width: '100%', minWidth }}>
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-semibold text-gray-700">Payer</th>
            <th className="px-4 py-3 text-left font-semibold text-gray-700">Package</th>
            <th className="px-4 py-3 text-left font-semibold text-gray-700">Amount</th>
            {showReferenceColumn ? (
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Reference No.</th>
            ) : null}
            <th className="px-4 py-3 text-left font-semibold text-gray-700">Issue Date</th>
            <th className="px-4 py-3 text-left font-semibold text-gray-700">Action</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {rows.map((ar) => {
            const canUseReceipt = canUseEnrollmentAckReceipt(ar);
            const disabledReason = getEnrollmentAckReceiptDisabledReason(ar);
            const packageSubtitle = getEnrollmentAckReceiptPackageSubtitle(ar);
            return (
              <tr key={ar.ack_receipt_id}>
                <td className="px-4 py-3">
                  <div className="text-gray-900">{ar.prospect_student_name}</div>
                  {ar.prospect_student_contact ? (
                    <div className="text-xs text-gray-500 truncate">{ar.prospect_student_contact}</div>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <div className="text-gray-900">{getEnrollmentAckReceiptPackageTitle(ar)}</div>
                  {packageSubtitle ? (
                    <div className="text-xs text-gray-600 mt-0.5">{packageSubtitle}</div>
                  ) : null}
                  <div className="text-xs text-gray-500">
                    {formatMoney(getEnrollmentAckReceiptPackageAmount(ar))}
                  </div>
                  {ar.enrollment_is_combined_pair && ar.list_paired_phase_ar_number ? (
                    <div className="text-xs text-amber-700 mt-0.5">
                      AR# {ar.receipt_ar_number || ar.display_ar_number || '—'} + Phase 1 AR#{' '}
                      {ar.list_paired_phase_ar_number}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-gray-900">{formatMoney(getEnrollmentAckReceiptLineTotal(ar))}</td>
                {showReferenceColumn ? (
                  <td className="px-4 py-3 text-gray-900">{ar.reference_number || '-'}</td>
                ) : null}
                <td className="px-4 py-3 text-gray-900">
                  {ar.issue_date ? formatDateManila(ar.issue_date) : '-'}
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    disabled={!canUseReceipt}
                    title={!canUseReceipt ? disabledReason : 'Use this acknowledgement receipt'}
                    onClick={() => {
                      if (!canUseReceipt) return;
                      onUseReceipt(ar);
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      canUseReceipt
                        ? 'text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E]'
                        : 'text-gray-400 bg-gray-100 cursor-not-allowed border border-gray-200'
                    }`}
                  >
                    Use This Receipt
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
