import { enrollmentMatrixSequenceKey } from './programEnrollmentStatus';

/**
 * Per-column sequence numbers across students (top → bottom in the table).
 * Each distinct status keeps its own running count within that column; a different
 * status starts at 1. Example: re-enrolled 1,2,3,4 → new 1 → re-enrolled 5.
 *
 * @param {object[]} students — matrix rows in display order
 * @param {{ key: string }[]} columns — month or phase column order
 * @param {(student: object, columnKey: string) => object|undefined} getCell
 * @returns {Record<string, Record<string, number>>} trackKey → columnKey → sequence
 */
export function computeMatrixColumnSequences(students, columns, getCell) {
  const sequencesByTrack = {};

  for (const column of columns || []) {
    const columnKey = column?.key;
    if (!columnKey) continue;

    const counters = {};

    for (const student of students || []) {
      const trackKey =
        student.enrollment_track_key || `${student.student_id}-${student.class_id}`;
      const sequenceKey = enrollmentMatrixSequenceKey(getCell(student, columnKey));
      if (!sequenceKey) continue;

      counters[sequenceKey] = (counters[sequenceKey] || 0) + 1;

      if (!sequencesByTrack[trackKey]) {
        sequencesByTrack[trackKey] = {};
      }
      sequencesByTrack[trackKey][columnKey] = counters[sequenceKey];
    }
  }

  return sequencesByTrack;
}

/** @param {object[]} students @param {{ key: string }[]} months */
export function computeMonthMatrixColumnSequences(students, months) {
  return computeMatrixColumnSequences(students, months, (student, monthKey) => student.months?.[monthKey]);
}

/** @param {object[]} students @param {{ key: string }[]} phases */
export function computePhaseMatrixColumnSequences(students, phases) {
  return computeMatrixColumnSequences(students, phases, (student, phaseKey) => student.phases?.[phaseKey]);
}

/**
 * Per-student-row sequence numbers across months (left → right).
 * Used when column order is phases/months for a single track timeline.
 *
 * @param {{ key: string }[]} periods — months or phases in display order
 * @param {Record<string, { mark?: string, label?: string, status?: string }>} cellsByPeriod
 * @returns {Record<string, number>} period key → sequence number for enrolled cells
 */
export function computeEnrollmentMatrixStatusSequences(periods, cellsByPeriod = {}) {
  const sequences = {};
  const counters = {};

  for (const period of periods || []) {
    const key = period?.key;
    if (!key) continue;

    const sequenceKey = enrollmentMatrixSequenceKey(cellsByPeriod?.[key]);
    if (!sequenceKey) continue;

    counters[sequenceKey] = (counters[sequenceKey] || 0) + 1;
    sequences[key] = counters[sequenceKey];
  }

  return sequences;
}
