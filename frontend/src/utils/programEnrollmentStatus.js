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

export function programEnrollmentStatusBadgeClass(status) {
  const key = String(status || '').trim().toLowerCase();
  return STATUS_TONES[key] || 'bg-slate-100 text-slate-800';
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
