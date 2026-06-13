import { createPortal } from 'react-dom';
import { formatDateManila } from '../../utils/dateUtils';
import { buildInvoiceLinkedArTableRows } from '../../utils/ackReceiptTableLineItems';
import AcknowledgementReceiptStylePreview from '../receipts/AcknowledgementReceiptStylePreview';

/**
 * After recording a payment on the invoice page: receipt-style preview + Print (AR PDF).
 */
export default function PaymentRecordedInvoiceSummaryModal({
  open,
  invoice,
  branchName,
  /** Optional branch contact block (from branchestbl via parent `branches` lookup) */
  branchInfo,
  paymentSnapshot,
  onClose,
  onPrintAcknowledgementReceipt,
  printLoading,
  /** Override when stacking above another modal (e.g. installment plan details). */
  overlayClassName = 'fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-3 sm:p-4',
}) {
  if (!open || !invoice) return null;

  const invId = invoice.invoice_id;
  const arNo = invoice.invoice_ar_number || '—';
  const students = Array.isArray(invoice.students) ? invoice.students : [];
  const studentNamesJoined = students.map((s) => s.full_name).filter(Boolean).join(', ') || '—';
  const items = Array.isArray(invoice.items) ? invoice.items : [];

  const snap = paymentSnapshot || null;
  const studentForReceipt = (() => {
    if (!snap?.student_id) return studentNamesJoined;
    const m = students.find((s) => Number(s.student_id) === Number(snap.student_id));
    return m?.full_name || `Student #${snap.student_id}`;
  })();

  const issueYmd =
    invoice.issue_date != null && String(invoice.issue_date).trim() !== ''
      ? String(invoice.issue_date).slice(0, 10)
      : '';
  const lastPayYmd =
    invoice.last_payment_date != null && String(invoice.last_payment_date).trim() !== ''
      ? String(invoice.last_payment_date).slice(0, 10)
      : '';
  const snapYmd = snap?.issue_date ? String(snap.issue_date).slice(0, 10) : '';
  const receiptDateRaw = snapYmd || lastPayYmd || issueYmd;
  const receiptDateDisplay = receiptDateRaw ? formatDateManila(receiptDateRaw) : '—';

  const preparedByText = invoice?.prepared_by_name || '';
  const receivedByText = invoice?.received_by_guardian_name || '';

  const invoiceDescription = (invoice.invoice_description || '').trim();
  const looksLikeInvoiceCodeOnly = /^INV-\d+$/i.test(invoiceDescription);
  const receiptDescription =
    (!looksLikeInvoiceCodeOnly ? invoiceDescription : '') ||
    (invId ? `Invoice INV-${invId}` : 'Payment recorded');

  const paymentRowsForReceipt = snap
    ? [
        {
          payable_amount: Number(snap.payable_amount) || 0,
          discount_amount: Number(snap.discount_amount) || 0,
          tip_amount: Number(snap.tip_amount) || 0,
        },
      ]
    : [];

  const balanceInvoiceId =
    invoice.balance_invoice_id || invoice.continued_to_invoice?.invoice_id || null;
  const remainingBalance =
    balanceInvoiceId != null
      ? Number(invoice.continued_to_invoice?.amount ?? 0)
      : undefined;

  const { rows: linkedArRows, total: totalAmount } = buildInvoiceLinkedArTableRows(
    items,
    paymentRowsForReceipt,
    {
      fallbackDescription: receiptDescription,
      fallbackAmount: snap ? Number(snap.payable_amount) || 0 : undefined,
      balanceInvoiceId,
      remainingBalance,
    },
  );

  const tableRows = linkedArRows.map((row) => ({
    description: row.description,
    rate: row.rate,
    amount: row.amount,
    excludeFromTotal: row.excludeFromTotal,
  }));

  if (tableRows.length === 0 && snap) {
    const p = Number(snap.payable_amount) || 0;
    if (p > 0) {
      tableRows.push({
        description: receiptDescription,
        rate: p,
        amount: p,
      });
    }
  }

  const addr = (branchInfo?.address || '').trim();
  const phone = (branchInfo?.phone || '').trim();
  const email = (branchInfo?.email || '').trim();
  const nick = (branchInfo?.nickname || branchName || '').trim();

  return createPortal(
    <div
      className={overlayClassName}
      onClick={() => {
        if (!printLoading) onClose();
      }}
      role="presentation"
    >
      <div
        className="max-h-[95vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-recorded-invoice-title"
      >
        <div className="flex flex-col gap-2 border-b border-gray-200 bg-gray-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div>
            <h2 id="payment-recorded-invoice-title" className="text-sm font-semibold text-gray-900 sm:text-base">
              Payment recorded
            </h2>
            <p className="text-xs text-gray-600">
              {invId ? `INV-${invId}` : ''}
              {invId ? ' · ' : ''}
              Review below, then print for the official acknowledgement receipt PDF.
            </p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              disabled={printLoading}
            >
              Close
            </button>
            <button
              type="button"
              onClick={onPrintAcknowledgementReceipt}
              disabled={printLoading || !invId}
              className="rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              title="Download acknowledgement receipt (same as invoice row action)"
            >
              {printLoading ? 'Opening PDF…' : 'Print'}
            </button>
          </div>
        </div>

        <div className="p-3 sm:p-4">
          <AcknowledgementReceiptStylePreview
            branchAddress={addr || undefined}
            branchPhone={phone || undefined}
            branchEmail={email || undefined}
            branchFallbackLine={!addr ? nick : undefined}
            receiptNo={arNo}
            studentName={studentForReceipt}
            classLabel="-"
            receiptDateDisplay={receiptDateDisplay}
            preparedByText={preparedByText}
            receivedByText={receivedByText}
            tableRows={tableRows}
            totalAmount={totalAmount}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
