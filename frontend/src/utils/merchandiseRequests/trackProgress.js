/**
 * Resolve Request Stock tracking steps for CMS UI.
 * Lifecycle: Pending → Shipped → Delivered; branches Returned / Rejected.
 * Legacy local status "Approved" is treated as Delivered.
 */

export const TRACK_STEPS = [
  {
    key: 'Pending',
    title: 'Pending',
    description: 'Request submitted and awaiting RHET Inventory action',
  },
  {
    key: 'Shipped',
    title: 'Shipped',
    description: 'Handed to courier — central warehouse stock deducted',
  },
  {
    key: 'Delivered',
    title: 'Delivered',
    description: 'Branch received — stock added to your campus inventory',
  },
  {
    key: 'Returned',
    title: 'Returned',
    description: 'Returned to warehouse — branch stock reversed if it was delivered',
  },
  {
    key: 'Rejected',
    title: 'Rejected',
    description: 'Not approved by RHET Inventory',
  },
];

export function normalizeTrackStatus(status) {
  const s = String(status || '').trim();
  if (s === 'Approved') return 'Delivered';
  if (s === 'Cancelled') return 'Cancelled';
  return s || 'Pending';
}

/**
 * @param {object} request - merchandiserequestlogtbl row
 * @returns {{ currentKey: string, steps: Array<{ key, title, description, state: 'completed'|'current'|'upcoming'|'skipped' }> }}
 */
export function buildTrackProgressSteps(request) {
  const currentKey = normalizeTrackStatus(request?.status);
  const inventoryStatus = String(request?.inventory_status || '').toUpperCase();

  /** @type {Record<string, 'completed'|'current'|'upcoming'|'skipped'>} */
  const states = {
    Pending: 'upcoming',
    Shipped: 'upcoming',
    Delivered: 'upcoming',
    Returned: 'skipped',
    Rejected: 'skipped',
  };

  if (currentKey === 'Cancelled') {
    states.Pending = 'completed';
    return {
      currentKey,
      steps: TRACK_STEPS.map((step) => ({
        ...step,
        state: step.key === 'Pending' ? 'completed' : 'skipped',
      })),
    };
  }

  if (currentKey === 'Rejected') {
    states.Pending = 'completed';
    if (inventoryStatus === 'SHIPPED') {
      states.Shipped = 'completed';
    }
    states.Rejected = 'current';
  } else if (currentKey === 'Returned') {
    states.Pending = 'completed';
    states.Shipped = 'completed';
    const notes = String(request?.review_notes || '').toLowerCase();
    if (notes.includes('before delivery')) {
      states.Delivered = 'skipped';
    } else {
      // Default for returned: treat as post-delivery reverse when notes mention reverse/after,
      // or when inventory already reached DELIVERED historically (notes from webhook).
      states.Delivered =
        notes.includes('after delivery') || notes.includes('reversed')
          ? 'completed'
          : 'completed';
    }
    states.Returned = 'current';
  } else if (currentKey === 'Delivered') {
    states.Pending = 'completed';
    states.Shipped = 'completed';
    states.Delivered = 'current';
  } else if (currentKey === 'Shipped') {
    states.Pending = 'completed';
    states.Shipped = 'current';
  } else {
    // Pending (default)
    states.Pending = 'current';
  }

  return {
    currentKey,
    steps: TRACK_STEPS.map((step) => ({
      ...step,
      state: states[step.key] || 'upcoming',
    })),
  };
}
