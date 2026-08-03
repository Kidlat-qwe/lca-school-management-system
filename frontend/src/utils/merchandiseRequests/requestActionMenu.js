/**
 * Build ellipsis menu items for Merchandise request rows.
 * Delivered / Approved / Returned / Rejected → "View details" only (track modal, read-only).
 * Pending / Shipped → "Track request item" plus status actions.
 */

function isTerminalRequestStatus(status) {
  const s = String(status || '').trim();
  return (
    s === 'Delivered' ||
    s === 'Approved' ||
    s === 'Returned' ||
    s === 'Rejected'
  );
}

/**
 * @param {object} request
 * @param {{
 *   onTrack: (request: object) => void,
 *   onConfirmDelivery?: (request: object) => void,
 *   onCancel?: (requestId: number|string) => void,
 *   onReview?: (request: object) => void,
 *   role?: 'admin' | 'superadmin',
 * }} handlers
 */
export function buildMerchandiseRequestActionItems(request, handlers = {}) {
  const {
    onTrack,
    onConfirmDelivery,
    onCancel,
    onReview,
    role = 'admin',
  } = handlers;

  if (!request) return [];

  const status = String(request.status || '').trim();

  if (isTerminalRequestStatus(status)) {
    return [
      {
        key: 'view',
        label: 'View details',
        onSelect: () => onTrack?.(request),
      },
    ];
  }

  const items = [
    {
      key: 'track',
      label: 'Track request item',
      onSelect: () => onTrack?.(request),
    },
  ];

  if (status === 'Shipped' && typeof onConfirmDelivery === 'function') {
    items.push({
      key: 'confirm',
      label: 'Confirm received',
      onSelect: () => onConfirmDelivery(request),
    });
  }

  if (status === 'Pending' && role === 'admin' && typeof onCancel === 'function') {
    items.push({
      key: 'cancel',
      label: 'Cancel request',
      tone: 'danger',
      onSelect: () => onCancel(request.request_id),
    });
  }

  if (
    status === 'Pending' &&
    role === 'superadmin' &&
    !request.inventory_request_id &&
    typeof onReview === 'function'
  ) {
    items.push({
      key: 'review',
      label: 'Review request',
      onSelect: () => onReview(request),
    });
  }

  return items;
}

export { isTerminalRequestStatus };
