import { createPortal } from 'react-dom';
import { formatDateTimeManila } from '../../utils/dateUtils';
import { getMerchandiseRequestApprovedBy } from '../../utils/merchandiseRequests/approvedBy';
import { buildTrackProgressSteps } from '../../utils/merchandiseRequests/trackProgress';

function stepCircleClass(state) {
  if (state === 'completed') return 'bg-green-600 border-green-600 text-white';
  if (state === 'current') return 'bg-blue-600 border-blue-600 text-white ring-4 ring-blue-100';
  if (state === 'skipped') return 'bg-gray-100 border-gray-200 text-gray-300';
  return 'bg-white border-gray-300 text-gray-400';
}

function stepTitleClass(state) {
  if (state === 'completed') return 'text-green-800';
  if (state === 'current') return 'text-blue-800 font-semibold';
  if (state === 'skipped') return 'text-gray-300';
  return 'text-gray-500';
}

function stepLineClass(state) {
  if (state === 'completed') return 'bg-green-500';
  return 'bg-gray-200';
}

function statusBadgeClass(currentKey) {
  if (currentKey === 'Pending') return 'bg-yellow-100 text-yellow-800';
  if (currentKey === 'Shipped') return 'bg-blue-100 text-blue-800';
  if (currentKey === 'Delivered') return 'bg-green-100 text-green-800';
  if (currentKey === 'Returned') return 'bg-orange-100 text-orange-800';
  if (currentKey === 'Rejected') return 'bg-red-100 text-red-800';
  return 'bg-gray-100 text-gray-800';
}

/**
 * Modal: track RHET stock-request progress (Pending → Shipped → Delivered / Returned / Rejected).
 * Landscape layout on md+: item/status left, timeline right. Stacks on small screens.
 * When Shipped, Branch Admin can confirm receipt (moves RHET → Delivered + credits stock).
 * For Delivered / Returned / Rejected (and legacy Approved), opens as read-only "View details".
 */
export default function TrackRequestProgressModal({
  request,
  open,
  onClose,
  canConfirmDelivery = false,
  confirming = false,
  onConfirmDelivery,
}) {
  if (!open || !request) return null;

  const { currentKey, steps } = buildTrackProgressSteps(request);
  const category =
    request.inventory_category_name || request.merchandise_name || 'Merchandise';
  const itemName = request.inventory_item_name || null;
  const sku = request.inventory_matched_sku || request.inventory_requested_sku || null;
  const processedBy = getMerchandiseRequestApprovedBy(request);
  const status = String(request.status || '').trim();
  const isViewDetailsMode =
    status === 'Delivered' ||
    status === 'Approved' ||
    status === 'Returned' ||
    status === 'Rejected';
  const modalTitle = isViewDetailsMode ? 'View details' : 'Track request item';
  const modalSubtitle = isViewDetailsMode
    ? 'Stock request progress and order details'
    : 'Monitor stock request progress from RHET Inventory';

  return createPortal(
    <div
      className="fixed inset-0 backdrop-blur-sm bg-black/20 flex items-center justify-center z-[10000] p-3 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="track-request-title"
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="min-w-0">
            <h2 id="track-request-title" className="text-lg sm:text-xl font-semibold text-gray-900">
              {modalTitle}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {modalSubtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 text-gray-500 shrink-0"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 md:items-start">
            <div className="space-y-4 min-w-0">
              <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 sm:p-4 space-y-1.5">
                <div className="text-sm font-medium text-gray-900 break-words" title={category}>
                  {category}
                  {itemName ? (
                    <span className="font-normal text-gray-600"> · {itemName}</span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                  {request.size ? <span>Size: {request.size}</span> : null}
                  {request.gender ? <span>Gender: {request.gender}</span> : null}
                  {request.type ? <span>Type: {request.type}</span> : null}
                  <span>Qty: {request.requested_quantity}</span>
                </div>
                {sku ? <div className="text-xs text-gray-500">SKU: {sku}</div> : null}
                <div className="text-xs text-gray-500 break-words">
                  Requested: {formatDateTimeManila(request.created_at)}
                  {request.requested_branch_name || request.branch_name
                    ? ` · ${request.requested_branch_name || request.branch_name}`
                    : ''}
                </div>
                {request.inventory_external_reference || request.request_id ? (
                  <div className="text-xs text-gray-400">
                    Ref:{' '}
                    {request.inventory_external_reference || `PSMS-${request.request_id}`}
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Current status
                </span>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass(currentKey)}`}
                >
                  {currentKey}
                </span>
              </div>

              {canConfirmDelivery ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
                  <p className="text-sm text-blue-900">
                    This shipment is in transit / arrived. Confirm once your branch has physically
                    received the items. RHET Inventory will move the request to <strong>Delivered</strong>{' '}
                    and stock will be added here.
                  </p>
                  <button
                    type="button"
                    disabled={confirming}
                    onClick={() => onConfirmDelivery?.()}
                    className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors"
                  >
                    {confirming ? 'Confirming…' : 'Confirm received'}
                  </button>
                </div>
              ) : null}

              {request.review_notes ? (
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Notes
                  </div>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{request.review_notes}</p>
                </div>
              ) : null}

              {request.inventory_rejection_reason ? (
                <div className="rounded-lg border border-red-100 bg-red-50 p-3">
                  <div className="text-xs font-medium text-red-700 uppercase tracking-wide mb-1">
                    Rejection reason
                  </div>
                  <p className="text-sm text-red-800">{request.inventory_rejection_reason}</p>
                </div>
              ) : null}
            </div>

            <div className="min-w-0 md:border-l md:border-gray-100 md:pl-6">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-3">
                Progress
              </div>
              <ol className="relative space-y-0">
                {steps.map((step, index) => {
                  const isLast = index === steps.length - 1;
                  const showConnector = !isLast;
                  const nextState = steps[index + 1]?.state;
                  const connectorDone =
                    step.state === 'completed' &&
                    (nextState === 'completed' || nextState === 'current');

                  return (
                    <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0">
                      {showConnector ? (
                        <span
                          className={`absolute left-[15px] top-8 w-0.5 h-[calc(100%-1.25rem)] ${
                            connectorDone ? stepLineClass('completed') : stepLineClass('upcoming')
                          }`}
                          aria-hidden="true"
                        />
                      ) : null}
                      <div
                        className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold ${stepCircleClass(step.state)}`}
                      >
                        {step.state === 'completed' ? (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : step.state === 'current' ? (
                          <span className="h-2 w-2 rounded-full bg-white" />
                        ) : (
                          <span>{index + 1}</span>
                        )}
                      </div>
                      <div className="min-w-0 pt-0.5">
                        <div className={`text-sm ${stepTitleClass(step.state)}`}>{step.title}</div>
                        <p
                          className={`text-xs mt-0.5 ${
                            step.state === 'skipped' ? 'text-gray-300' : 'text-gray-500'
                          }`}
                        >
                          {step.description}
                        </p>
                        {step.state === 'current' && processedBy && processedBy !== '—' ? (
                          <p className="text-xs text-blue-700 mt-1">Handled by: {processedBy}</p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-gray-100 flex justify-end gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
