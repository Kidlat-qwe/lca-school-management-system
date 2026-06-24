/**
 * Canonical labels for month/phase enrollment matrix cells.
 * Aligns with backend `enrollmentRateMetrics` matrix labels and KPI counting.
 */

export const MATRIX_CELL_LABEL = {
  NEW: 'new',
  RE_ENROLLED: 're-enrolled',
  DROPPED: 'dropped',
  REJOIN: 'rejoin',
  UPSELL: 'upsell',
  RESERVED: 'reserved',
  COMPLETED: 'completed',
};

const normalizeLabelKey = (label) =>
  String(label || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ');

const LABEL_ALIASES = {
  new: MATRIX_CELL_LABEL.NEW,
  're-enrolled': MATRIX_CELL_LABEL.RE_ENROLLED,
  're enrolled': MATRIX_CELL_LABEL.RE_ENROLLED,
  dropped: MATRIX_CELL_LABEL.DROPPED,
  'dropped/unenrolled': MATRIX_CELL_LABEL.DROPPED,
  'not enrolled': MATRIX_CELL_LABEL.DROPPED,
  rejoin: MATRIX_CELL_LABEL.REJOIN,
  upsell: MATRIX_CELL_LABEL.UPSELL,
  reserved: MATRIX_CELL_LABEL.RESERVED,
  'pending enrollment': 'pending enrollment',
  completed: MATRIX_CELL_LABEL.COMPLETED,
};

/** Map API/UI matrix cell labels to canonical keys for KPI switches. */
export function normalizeMatrixCellLabel(label) {
  const key = normalizeLabelKey(label);
  return LABEL_ALIASES[key] ?? key;
}

export function isMatrixDroppedLabel(label) {
  return normalizeMatrixCellLabel(label) === MATRIX_CELL_LABEL.DROPPED;
}

export function isMatrixReEnrolledLabel(label) {
  return normalizeMatrixCellLabel(label) === MATRIX_CELL_LABEL.RE_ENROLLED;
}
