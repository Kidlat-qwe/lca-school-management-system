/**
 * Client-side sort for enrollment matrix student rows.
 */

import {
  enrollmentMatrixSequenceKey,
  matrixStudentStatusSortRank,
} from './programEnrollmentStatus';

const MANILA_TZ = 'Asia/Manila';

export const sortMatrixStudentsByEnrollmentDate = (students, direction = 'asc') => {
  const mult = direction === 'desc' ? -1 : 1;
  return [...students].sort((a, b) => {
    const aTime = a.first_enrolled_at ? new Date(a.first_enrolled_at).getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.first_enrolled_at ? new Date(b.first_enrolled_at).getTime() : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return mult * (aTime - bTime);
    const byStudent = (a.student_id || 0) - (b.student_id || 0);
    if (byStudent !== 0) return byStudent;
    return (a.class_id || 0) - (b.class_id || 0);
  });
};

/**
 * Status key for one matrix cell (matches column sequence keys).
 * @param {object|undefined} cell
 */
export const matrixCellStatusSortKey = (cell) =>
  enrollmentMatrixSequenceKey(cell) || 'not_enrolled';

const compareEnrollmentDateAsc = (a, b) => {
  const aTime = a.first_enrolled_at ? new Date(a.first_enrolled_at).getTime() : Number.POSITIVE_INFINITY;
  const bTime = b.first_enrolled_at ? new Date(b.first_enrolled_at).getTime() : Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  const byStudent = (a.student_id || 0) - (b.student_id || 0);
  if (byStudent !== 0) return byStudent;
  return (a.class_id || 0) - (b.class_id || 0);
};

/**
 * Billing month used for status-based row order (current Manila month when in scope).
 * @param {{ key: string }[]} months
 * @param {string|number} [displayYear]
 */
export const resolveMonthMatrixFocusMonthKey = (months, displayYear) => {
  const list = months || [];
  if (!list.length) return null;

  const year = parseInt(String(displayYear), 10);
  const nowKey = new Date().toLocaleDateString('en-CA', { timeZone: MANILA_TZ }).slice(0, 7);
  const nowYear = parseInt(nowKey.slice(0, 4), 10);

  if (Number.isFinite(year) && year === nowYear) {
    if (list.some((m) => m.key === nowKey)) return nowKey;
    const throughToday = list.filter((m) => m.key <= nowKey);
    if (throughToday.length) return throughToday[throughToday.length - 1].key;
  }

  return list[list.length - 1].key;
};

/** Latest phase column key (highest phase number in view). */
export const resolvePhaseMatrixFocusPhaseKey = (phases) => {
  const list = phases || [];
  if (!list.length) return null;
  return list.reduce((max, phase) => {
    const key = phase?.key;
    if (key == null) return max;
    if (max == null) return key;
    return Number(key) > Number(max) ? key : max;
  }, null);
};

/**
 * Sort rows by status in one focus period: New → Re-enrolled → … → Not enrolled.
 *
 * @param {object[]} students
 * @param {string|number|null} focusPeriodKey
 * @param {(student: object, periodKey: string|number) => object|undefined} getCell
 */
export const sortMatrixStudentsByFocusPeriodStatus = (students, focusPeriodKey, getCell) => {
  if (focusPeriodKey == null) return [...students];

  return [...students].sort((a, b) => {
    const rankA = matrixStudentStatusSortRank(
      matrixCellStatusSortKey(getCell(a, focusPeriodKey))
    );
    const rankB = matrixStudentStatusSortRank(
      matrixCellStatusSortKey(getCell(b, focusPeriodKey))
    );
    if (rankA !== rankB) return rankA - rankB;
    return compareEnrollmentDateAsc(a, b);
  });
};

/** @param {object[]} students @param {{ key: string }[]} months @param {string|number} [displayYear] */
export const sortMonthMatrixStudentsByStatus = (students, months, displayYear) => {
  const focusKey = resolveMonthMatrixFocusMonthKey(months, displayYear);
  return sortMatrixStudentsByFocusPeriodStatus(
    students,
    focusKey,
    (student, monthKey) => student.months?.[monthKey]
  );
};

/** @param {object[]} students @param {{ key: string|number }[]} phases */
export const sortPhaseMatrixStudentsByStatus = (students, phases) => {
  const focusKey = resolvePhaseMatrixFocusPhaseKey(phases);
  return sortMatrixStudentsByFocusPeriodStatus(
    students,
    focusKey,
    (student, phaseKey) => student.phases?.[phaseKey]
  );
};

/** Label shown in matrix student column (includes class when enrolled in multiple classes). */
export const matrixTrackDisplayName = (track) =>
  track?.display_name || track?.full_name || '';

export const formatMatrixEnrollmentDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: MANILA_TZ });
};

export const toggleEnrollmentDateSort = (current) => (current === 'asc' ? 'desc' : 'asc');

export const toggleMatrixStudentSortMode = (current) =>
  current === 'status' ? 'enrollment_date' : 'status';
