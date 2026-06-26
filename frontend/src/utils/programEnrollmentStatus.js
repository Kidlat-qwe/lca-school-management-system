/**
 * Program enrollment status labels — single source for Reports, StatusLegend, and class UI.
 *
 * Display format (per business):
 *   new          → New
 *   re_enrolled  → Re-enroll
 *   dropped      → Not enrolled
 *   rejoin       → Rejoin
 */

export const PROGRAM_ENROLLMENT_STATUS_ITEMS = [
  {
    key: 'reserved',
    label: 'Reserved',
    tone: 'bg-amber-100 text-amber-800',
    description: 'Slot is reserved but enrollment is not finalized yet.',
  },
  {
    key: 'pending_enrollment',
    label: 'Pending enrollment',
    tone: 'bg-amber-100 text-amber-800',
    description: 'Enrollment is pending (requirements or payment not complete).',
  },
  {
    key: 'new',
    label: 'New',
    tone: 'bg-green-100 text-green-800',
    description: 'Student enrolled for the first time in this program path.',
  },
  {
    key: 're_enrolled',
    label: 'Re-enroll',
    tone: 'bg-green-100 text-green-800',
    description: 'Returning student enrolled again in a later phase.',
  },
  {
    key: 'upsell',
    label: 'Upsell',
    tone: 'bg-green-100 text-green-800',
    description: 'Student moved to an additional or higher program level.',
  },
  {
    key: 'rejoin',
    label: 'Rejoin',
    tone: 'bg-green-100 text-green-800',
    description: 'First active phase after a prior drop in the same class.',
  },
  {
    key: 'dropped',
    label: 'Not enrolled',
    tone: 'bg-gray-100 text-gray-800',
    description: 'Dropped / not enrolled for this phase (does not count as active).',
  },
  {
    key: 'completed',
    label: 'Completed',
    tone: 'bg-green-100 text-green-800',
    description: 'Student completed this enrolled phase.',
  },
  {
    key: 'not_yet_enrolled',
    label: 'Not yet enrolled',
    tone: 'bg-slate-100 text-slate-600',
    description: 'Invoice not generated yet; no enrollment for this phase.',
  },
];

const STATUS_LABELS = Object.fromEntries(
  PROGRAM_ENROLLMENT_STATUS_ITEMS.map((item) => [item.key, item.label])
);

const STATUS_TONES = Object.fromEntries(
  PROGRAM_ENROLLMENT_STATUS_ITEMS.map((item) => [item.key, item.tone])
);

/** Filter dropdown options for Report — Program Enrollment Status tab */
export const PROGRAM_ENROLLMENT_STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  ...PROGRAM_ENROLLMENT_STATUS_ITEMS.map((item) => ({
    value: item.key,
    label: item.label,
  })),
];

export function formatProgramEnrollmentStatus(status) {
  const key = String(status || '').trim().toLowerCase();
  return STATUS_LABELS[key] || (status ? String(status) : '—');
}

/** Keys shown on installment plan phase rows (Student History → Invoices). */
export const INSTALLMENT_PLAN_ENROLLMENT_STATUSES = new Set([
  'new',
  'dropped',
  'rejoin',
  're_enrolled',
]);

/** Installment plan phases table — labels match re-enrollment month matrix cells. */
export function formatInstallmentPlanPhaseEnrollment(status) {
  const key = String(status || '').trim().toLowerCase();
  switch (key) {
    case 'dropped':
      return 'dropped';
    case 're_enrolled':
    case 'upsell':
      return 're enrolled';
    case 'new':
      return 'new';
    case 'rejoin':
      return 'rejoin';
    default:
      return INSTALLMENT_PLAN_ENROLLMENT_STATUSES.has(key)
        ? formatProgramEnrollmentStatus(status)
        : null;
  }
}

export function programEnrollmentStatusBadgeClass(status) {
  const key = String(status || '').trim().toLowerCase();
  return STATUS_TONES[key] || 'bg-slate-100 text-slate-800';
}

/**
 * Matrix cell colors — distinct per status, aligned with dashboard chart palette
 * (#F7C844 amber, #4F46E5 indigo, #22C55E green, #F97316 orange, #14B8A6 teal).
 */
export const ENROLLMENT_MATRIX_STATUS_ITEMS = [
  {
    key: 'new',
    label: 'New',
    tone: 'bg-emerald-100 text-emerald-800',
    description: 'First enrollment in the program path (one cell per student).',
  },
  {
    key: 're_enrolled',
    label: 'Re-enrolled',
    tone: 'bg-indigo-100 text-indigo-800',
    description: 'Returning student enrolled in a later phase or billing month.',
  },
  {
    key: 'completed',
    label: 'Completed',
    tone: 'bg-amber-100 text-amber-900',
    description: 'Student finished the final enrolled phase (common for full-payment).',
  },
  {
    key: 'rejoin',
    label: 'Rejoin',
    tone: 'bg-orange-100 text-orange-800',
    description: 'First active phase after returning from a prior drop.',
  },
  {
    key: 'upsell',
    label: 'Upsell',
    tone: 'bg-teal-100 text-teal-800',
    description: 'First month in a higher program after completing the previous level (e.g. Pre-K → Kindergarten).',
  },
  {
    key: 'pending_enrollment',
    label: 'Pending enrollment',
    tone: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
    description: 'Enrollment started but not yet finalized.',
  },
  {
    key: 'reserved',
    label: 'Reserved',
    tone: 'bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300',
    description: 'Paid reservation fee for this month/phase; enrollment not finalized yet.',
  },
  {
    key: 'dropped',
    label: 'Dropped / unenrolled',
    tone: 'bg-rose-100 text-rose-800',
    description: 'Dropped or removed from this phase or billing month.',
  },
  {
    key: 'not_enrolled',
    label: 'Not enrolled',
    tone: 'bg-slate-100 text-slate-500',
    description: 'No enrollment for this phase or billing month (—).',
  },
];

const MATRIX_STATUS_BY_KEY = Object.fromEntries(
  ENROLLMENT_MATRIX_STATUS_ITEMS.map((item) => [item.key, item])
);

/** Row sort order for matrix tables (matches legend top → bottom). */
const MATRIX_STATUS_SORT_RANK = Object.fromEntries(
  ENROLLMENT_MATRIX_STATUS_ITEMS.map((item, index) => [item.key, index])
);

/** @param {string|null|undefined} statusKey */
export function matrixStudentStatusSortRank(statusKey) {
  const key = statusKey || 'not_enrolled';
  return MATRIX_STATUS_SORT_RANK[key] ?? MATRIX_STATUS_SORT_RANK.not_enrolled;
}

const normalizeMatrixLabelKey = (label) =>
  String(label || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const MATRIX_LABEL_TO_KEY = {
  new: 'new',
  're-enrolled': 're_enrolled',
  re_enrolled: 're_enrolled',
  completed: 'completed',
  rejoin: 'rejoin',
  upsell: 'upsell',
  'pending enrollment': 'pending_enrollment',
  reserved: 'reserved',
  'dropped/unenrolled': 'dropped',
  dropped: 'dropped',
  'not enrolled': 'dropped',
};

/** Statuses that receive per-column sequence numbers in month/phase matrices. */
export const MATRIX_SEQUENCE_STATUS_KEYS = new Set([
  'new',
  're_enrolled',
  'completed',
  'rejoin',
  'upsell',
  'pending_enrollment',
  'reserved',
  'dropped',
]);

/**
 * Resolve badge tone for phase/month enrollment matrix cells.
 * @param {{ mark?: string, label?: string, status?: string|null }} cell
 */
export function enrollmentMatrixCellTone(cell) {
  const mark = cell?.mark ?? '-';

  const labelKey = MATRIX_LABEL_TO_KEY[normalizeMatrixLabelKey(cell?.label)];
  if (labelKey && MATRIX_STATUS_BY_KEY[labelKey]) {
    return MATRIX_STATUS_BY_KEY[labelKey].tone;
  }

  const statusKey = String(cell?.status || '').trim().toLowerCase();
  if (statusKey && MATRIX_STATUS_BY_KEY[statusKey]) {
    return MATRIX_STATUS_BY_KEY[statusKey].tone;
  }

  if (mark === '1') {
    return MATRIX_STATUS_BY_KEY.re_enrolled.tone;
  }

  return MATRIX_STATUS_BY_KEY.not_enrolled.tone;
}

export function enrollmentMatrixCellTitle(cell) {
  if (cell?.from_previous_reserved && cell?.label === 'new') {
    return 'Previous reserved';
  }
  const label = cell?.label?.trim();
  if (label) return label;
  return cell?.mark === '1' ? 'Enrolled' : 'Not enrolled';
}

/** Hover text for matrix status badges — includes enrolled phase when known. */
export function enrollmentMatrixCellHoverTitle(cell, options = {}) {
  const rawPhase = options.periodKey ?? cell?.phase_number;
  const phaseNumber = parseInt(rawPhase, 10);
  const hasPhase = Number.isFinite(phaseNumber) && phaseNumber > 0;

  if (cell?.from_previous_reserved && cell?.label === 'new') {
    return hasPhase
      ? `Enrolled in Phase ${phaseNumber} · Previous reserved`
      : 'Previous reserved';
  }

  if (!enrollmentMatrixCellShowsSequence(cell)) {
    if (hasPhase) return `Phase ${phaseNumber} · Not enrolled`;
    return enrollmentMatrixCellTitle(cell);
  }

  const statusLabel = cell?.label?.trim() || enrollmentMatrixCellTitle(cell);
  if (hasPhase) {
    const isNew = statusLabel.toLowerCase() === 'new' || cell?.status === 'new';
    if (isNew) {
      return `Enrolled in Phase ${phaseNumber}`;
    }
    return `Enrolled in Phase ${phaseNumber} · ${statusLabel}`;
  }
  return statusLabel;
}

/** Stable key for per-status sequence counters on matrix rows (month or phase). */
export function enrollmentMatrixSequenceKey(cell) {
  if (!cell) return null;

  const labelKey = MATRIX_LABEL_TO_KEY[normalizeMatrixLabelKey(cell?.label)];
  if (labelKey && MATRIX_SEQUENCE_STATUS_KEYS.has(labelKey)) {
    return labelKey;
  }

  const statusKey = String(cell?.status || '').trim().toLowerCase();
  if (statusKey && MATRIX_SEQUENCE_STATUS_KEYS.has(statusKey)) {
    return statusKey;
  }

  if (cell.mark === '1') {
    return 're_enrolled';
  }

  return null;
}

/** True when the cell should show a numbered badge (all matrix statuses except empty / not enrolled). */
export function enrollmentMatrixCellShowsSequence(cell) {
  return enrollmentMatrixSequenceKey(cell) != null;
}

const ACTIVE_ENROLLMENT_STATUSES = new Set(['new', 're_enrolled', 'upsell', 'rejoin']);

/** One display status when multiple phase rows are merged into a single student row. */
export function pickGroupedProgramEnrollmentStatus(phaseRows) {
  if (!phaseRows?.length) return null;

  const rows = phaseRows.map((row) => ({
    status: String(row.program_enrollment_status || '').trim().toLowerCase(),
    phase: Number(row.phase_number) || 0,
    removed: row.removed_at != null,
  }));

  const byHighestPhase = [...rows].sort((a, b) => b.phase - a.phase);
  const highest = byHighestPhase[0];

  if (highest?.status === 'completed') {
    return 'completed';
  }

  const activeRows = rows.filter((r) => ACTIVE_ENROLLMENT_STATUSES.has(r.status) && !r.removed);
  if (activeRows.length > 0) {
    return activeRows.reduce((best, row) => (row.phase > best.phase ? row : best)).status;
  }

  if (rows.length > 0 && rows.every((r) => r.status === 'dropped' || r.removed)) {
    return 'dropped';
  }

  return highest?.status || null;
}

export function studentHasActivePhaseEnrollment(phaseRows) {
  if (!phaseRows?.length) return false;
  return phaseRows.some((row) => {
    const status = String(row.program_enrollment_status || '').trim().toLowerCase();
    return ACTIVE_ENROLLMENT_STATUSES.has(status) && row.removed_at == null;
  });
}
