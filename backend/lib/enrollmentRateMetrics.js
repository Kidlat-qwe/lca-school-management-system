/**
 * Enrollment rate by phase and enrollment dashboard snapshot metrics.
 * Used by GET /dashboard/enrollment and daily/monthly operational dashboards.
 */

import { levelTagIndex } from '../utils/enrollmentStatus.js';

const ENROLLED_STATUSES = "('new', 're_enrolled', 'upsell', 'rejoin', 'completed')";
const ACTIVE_PROGRAM_STATUSES = "('new', 're_enrolled', 'upsell', 'rejoin')";
const ENROLLED_STATUSES_LIST = ['new', 're_enrolled', 'upsell', 'rejoin', 'completed'];

/**
 * Phase-matrix cell display.
 * Drop flow keeps paid phases as new/re_enrolled/... with removed_at set (historical);
 * only the drop-marker row uses status "dropped". removed_at alone must not imply dropped.
 */
const buildPhaseMatrixCell = (status, removedAt, normalizeLabel) => {
  const programStatus = status || null;
  if (programStatus && ENROLLED_STATUSES_LIST.includes(programStatus)) {
    return {
      mark: '1',
      label: normalizeLabel(programStatus),
      status: programStatus,
    };
  }
  if (programStatus === 'dropped' || removedAt != null) {
    return {
      mark: '-',
      label: 'dropped/unenrolled',
      status: programStatus,
    };
  }
  const label = programStatus ? normalizeLabel(programStatus) : '';
  return {
    mark: programStatus === 'pending_enrollment' ? '-' : programStatus ? '1' : '-',
    label,
    status: programStatus,
  };
};

/** Stable key for one student × class enrollment track (matrix row). */
export const enrollmentTrackKey = (studentId, classId) =>
  `${parseInt(studentId, 10)}:${parseInt(classId, 10)}`;

/** Build a matrix row object for one enrollment track. */
export const buildEnrollmentMatrixTrackRow = ({
  studentId,
  classId,
  fullName,
  className = '',
  classLevelTag = '',
  firstEnrolledAt = null,
  firstEnrolledMonthKey = null,
  lastFullPayMonthKey = null,
  phases = undefined,
  months = undefined,
}) => {
  const safeName = fullName || `Student ${studentId}`;
  const row = {
    student_id: parseInt(studentId, 10),
    class_id: parseInt(classId, 10),
    enrollment_track_key: enrollmentTrackKey(studentId, classId),
    full_name: safeName,
    class_name: className || '',
    class_level_tag: classLevelTag || '',
    display_name: className ? `${safeName} — ${className}` : safeName,
    first_enrolled_at: firstEnrolledAt || null,
    first_enrolled_month_key: firstEnrolledMonthKey || null,
    last_full_pay_month_key: lastFullPayMonthKey || null,
  };
  if (phases !== undefined) row.phases = phases;
  if (months !== undefined) row.months = months;
  return row;
};

/** Sort matrix tracks by earliest enrolled_at (Manila), not by name. */
export const sortEnrollmentMatrixStudents = (students, direction = 'asc') => {
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

const buildMonthEnrolledAtFilter = (paramFromIdx, paramToIdx) => `
  AND cs.enrolled_at IS NOT NULL
  AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date >= $${paramFromIdx}::date
  AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date < $${paramToIdx}::date`;

/** Calendar month immediately before YYYY-MM. */
export const prevCalendarMonthKey = (monthKey) => {
  const [y, m] = monthKey.split('-').map((v) => parseInt(v, 10));
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Calendar month immediately after YYYY-MM. */
export const nextCalendarMonthKey = (monthKey) => {
  const [y, m] = monthKey.split('-').map((v) => parseInt(v, 10));
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Add N calendar months to YYYY-MM (N may be 0). */
export const addCalendarMonthsToKey = (monthKey, monthsToAdd) => {
  const [y, m] = monthKey.split('-').map((v) => parseInt(v, 10));
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + monthsToAdd);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** YYYY-MM in Asia/Manila for a timestamp (used by calendar overlays). */
const toManilaMonthKey = (dateValue) => {
  if (!dateValue) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(dateValue));
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return year && month ? `${year}-${month}` : null;
};

/** Earliest month that should display as "new" (billing anchor vs first enrolled_at). */
const resolveCanonicalFirstNewMonthKey = (firstBillingKey, firstEverMonthKey) => {
  if (firstBillingKey && firstEverMonthKey) {
    return firstBillingKey <= firstEverMonthKey ? firstBillingKey : firstEverMonthKey;
  }
  return firstBillingKey || firstEverMonthKey || null;
};

/** When a student has one class in scope, show name only; with multiple classes, include class label. */
const applyMatrixTrackDisplayNames = (tracks) => {
  const classCountByStudent = new Map();
  for (const track of tracks) {
    if (track.hide_from_matrix) continue;
    const sid = track.student_id;
    classCountByStudent.set(sid, (classCountByStudent.get(sid) || 0) + 1);
  }
  for (const track of tracks) {
    if (track.hide_from_matrix) continue;
    if (track.matrix_merged_upsell_anchor) {
      track.display_name = track.full_name;
      continue;
    }
    if (track.matrix_upsell_track && track.class_name) {
      track.display_name = `${track.full_name} — ${track.class_name}`;
      continue;
    }
    const multiClass = (classCountByStudent.get(track.student_id) || 0) > 1;
    track.display_name =
      multiClass && track.class_name
        ? `${track.full_name} — ${track.class_name}`
        : track.full_name;
  }
  return tracks;
};

const trackHasCompletedEnrollment = (track, periodKey) => {
  const cells = track?.[periodKey] || {};
  return Object.values(cells).some(
    (cell) => cell?.label === 'completed' || cell?.status === 'completed'
  );
};

/** Matrix rows merged into an anchor track are omitted from API/UI lists. */
export const filterHiddenMatrixTracks = (tracks) =>
  (tracks || []).filter((t) => !t.hide_from_matrix);

const findLastCompletedMonthKey = (track) => {
  const cells = track?.months || {};
  const keys = Object.keys(cells)
    .filter((k) => {
      const c = cells[k];
      return c?.label === 'completed' || c?.status === 'completed';
    })
    .sort();
  if (keys.length) return keys[keys.length - 1];
  const lfp = track.last_full_pay_month_key;
  if (lfp && cells[lfp]?.mark === '1') return lfp;
  return null;
};

const findLastCompletedPhaseKey = (track) => {
  const cells = track?.phases || {};
  const keys = Object.keys(cells)
    .map((k) => parseInt(k, 10))
    .filter((n) => Number.isFinite(n))
    .filter((k) => {
      const c = cells[k];
      return c?.label === 'completed' || c?.status === 'completed';
    })
    .sort((a, b) => a - b);
  return keys.length ? keys[keys.length - 1] : null;
};

const mergeMonthCellOntoAnchor = (anchor, monthKey, src, { upsell }) => {
  if (!anchor.months) anchor.months = {};
  const isCompleted =
    src?.label === 'completed' || src?.status === 'completed';
  anchor.months[monthKey] = {
    ...src,
    mark: '1',
    label: upsell ? 'upsell' : isCompleted ? 'completed' : 're-enrolled',
    status: upsell ? 'upsell' : isCompleted ? 'completed' : 're_enrolled',
    display_upsell_merged: true,
    merged_from_class_id: src?.merged_from_class_id,
  };
};

const trackIsFullPaymentEnrollment = (track) =>
  Boolean(track?.last_full_pay_month_key) ||
  Object.values(track?.months || {}).some((cell) => cell?.is_full_payment);

/**
 * Full-payment upsell: mark "completed" only on the month that maps to the track's
 * true last full-payment billing month (not the last column visible in the selected year).
 * If the program continues in a later calendar year (e.g. Jan 2027), Dec 2026 stays re-enrolled.
 */
const applyFullPaymentCompletedOnLastMergedUpsellMonth = (
  anchor,
  srcBillingMonthToDisplayMonth,
  higherTrack,
  displayMonthKeys
) => {
  if (!trackIsFullPaymentEnrollment(higherTrack)) return;

  const terminalBillingKey = higherTrack.last_full_pay_month_key || null;
  if (!terminalBillingKey) return;

  if (displayMonthKeys instanceof Set && !displayMonthKeys.has(terminalBillingKey)) {
    return;
  }

  const displayMonth = srcBillingMonthToDisplayMonth.get(terminalBillingKey);
  if (!displayMonth) return;

  const cell = anchor.months?.[displayMonth];
  if (cell?.mark !== '1') return;

  cell.label = 'completed';
  cell.status = 'completed';
};

/**
 * Month matrix: after a lower program is completed, merge higher-program phases onto
 * that same row. First higher phase → upsell (month after completed); each later
 * higher phase → re-enrolled in the following month columns (matches phase matrix).
 */
const applyUpsellMonthMatrixSameRowRules = (tracks, { siblingTracksByStudent = null, displayMonthKeys = null } = {}) => {
  const byStudent = new Map();
  const addTrack = (track) => {
    if (!track?.student_id) return;
    const sid = track.student_id;
    if (!byStudent.has(sid)) byStudent.set(sid, []);
    const list = byStudent.get(sid);
    if (!list.some((t) => t.class_id === track.class_id)) {
      list.push(track);
    }
  };

  for (const track of tracks) addTrack(track);
  if (siblingTracksByStudent) {
    for (const [, siblingTracks] of siblingTracksByStudent) {
      for (const track of siblingTracks) addTrack(track);
    }
  }

  const monthKeysInScope =
    displayMonthKeys instanceof Set ? displayMonthKeys : null;

  for (const studentTracks of byStudent.values()) {
    if (studentTracks.length < 2) continue;

    const completedTracks = studentTracks.filter((t) =>
      trackHasCompletedEnrollment(t, 'months')
    );
    if (!completedTracks.length) continue;

    const anchor = completedTracks.reduce((best, t) => {
      const idx = levelTagIndex(t.class_level_tag);
      if (idx < 0) return best;
      if (!best) return t;
      const bestIdx = levelTagIndex(best.class_level_tag);
      return bestIdx < 0 || idx < bestIdx ? t : best;
    }, null);
    if (!anchor) continue;

    const anchorIdx = levelTagIndex(anchor.class_level_tag);
    const completedMonthKey = findLastCompletedMonthKey(anchor);
    if (!completedMonthKey) continue;

    const upsellMonthKey = nextCalendarMonthKey(completedMonthKey);

    const higherTracks = studentTracks
      .filter((t) => {
        if (t.class_id === anchor.class_id) return false;
        const idx = levelTagIndex(t.class_level_tag);
        return idx > anchorIdx;
      })
      .sort(
        (a, b) =>
          levelTagIndex(a.class_level_tag) - levelTagIndex(b.class_level_tag)
      );

    if (!higherTracks.length) continue;

    const hasHigherEnrollment = higherTracks.some((higher) =>
      Object.values(higher.months || {}).some((cell) => cell?.mark === '1')
    );
    if (!hasHigherEnrollment) continue;

    let upsellPlaced = false;
    const mergedMonthKeys = new Set();
    let higherPhaseIndex = 0;

    for (const higher of higherTracks) {
      const higherCells = higher.months || {};
      const enrolledBillingMonths = Object.keys(higherCells)
        .filter((k) => higherCells[k]?.mark === '1')
        .sort();

      const srcBillingMonthToDisplayMonth = new Map();

      for (const srcKey of enrolledBillingMonths) {
        const displayMonth = addCalendarMonthsToKey(upsellMonthKey, higherPhaseIndex);
        const src = { ...higherCells[srcKey], merged_from_class_id: higher.class_id };

        if (!monthKeysInScope || monthKeysInScope.has(displayMonth)) {
          if (!anchor.months) anchor.months = {};
          if (higherPhaseIndex === 0) {
            anchor.months[displayMonth] = {
              mark: '1',
              label: 'upsell',
              status: 'upsell',
              display_upsell_synthetic: true,
              merged_from_class_id: higher.class_id,
            };
            upsellPlaced = true;
          } else {
            mergeMonthCellOntoAnchor(anchor, displayMonth, src, { upsell: false });
          }
          mergedMonthKeys.add(displayMonth);
          srcBillingMonthToDisplayMonth.set(srcKey, displayMonth);
        }

        higherPhaseIndex += 1;
      }

      applyFullPaymentCompletedOnLastMergedUpsellMonth(
        anchor,
        srcBillingMonthToDisplayMonth,
        higher,
        monthKeysInScope
      );

      if (tracks.some((t) => t.enrollment_track_key === higher.enrollment_track_key)) {
        higher.hide_from_matrix = true;
        higher.matrix_merged_into_anchor = anchor.enrollment_track_key;
      }
    }

    if (upsellPlaced || mergedMonthKeys.size > 0) {
      anchor.matrix_merged_upsell_anchor = true;
      anchor.display_name = anchor.full_name;
    }
  }

  return tracks;
};

/**
 * Phase matrix: upsell students stay on their own row (higher program track).
 * First enrolled phase shows "upsell" when a lower program was completed.
 */
const applyUpsellPhaseMatrixSeparateRowRules = (tracks, { siblingTracksByStudent = null } = {}) => {
  const byStudent = new Map();
  const addTrack = (track) => {
    if (!track?.student_id) return;
    const sid = track.student_id;
    if (!byStudent.has(sid)) byStudent.set(sid, []);
    const list = byStudent.get(sid);
    if (!list.some((t) => t.class_id === track.class_id)) {
      list.push(track);
    }
  };

  for (const track of tracks) addTrack(track);
  if (siblingTracksByStudent) {
    for (const [, siblingTracks] of siblingTracksByStudent) {
      for (const track of siblingTracks) addTrack(track);
    }
  }

  for (const studentTracks of byStudent.values()) {
    for (const track of studentTracks) {
      const curIdx = levelTagIndex(track.class_level_tag);
      if (curIdx < 0) continue;

      const hasCompletedLowerProgram = studentTracks.some((other) => {
        if (other.class_id === track.class_id) return false;
        const otherIdx = levelTagIndex(other.class_level_tag);
        return (
          otherIdx >= 0 &&
          otherIdx < curIdx &&
          trackHasCompletedEnrollment(other, 'phases')
        );
      });
      if (!hasCompletedLowerProgram) continue;

      const cells = track.phases || {};
      let firstKey = track.first_enrolled_phase;
      if (firstKey == null) {
        firstKey = Object.keys(cells)
          .map((k) => parseInt(k, 10))
          .filter((n) => Number.isFinite(n) && cells[n]?.mark === '1')
          .sort((a, b) => a - b)[0];
      }
      if (firstKey == null) continue;

      const cell = cells[firstKey];
      if (!cell || cell.mark !== '1') continue;

      track.matrix_upsell_track = true;

      if (cell.status === 'upsell' || cell.label === 'upsell') {
        cell.label = 'upsell';
        cell.status = 'upsell';
        continue;
      }

      if (
        cell.status === 'new' ||
        cell.label === 'new' ||
        cell.status === 're_enrolled' ||
        cell.label === 're-enrolled'
      ) {
        cell.label = 'upsell';
        cell.status = 'upsell';
        cell.display_upsell_inferred = true;
      }
    }
  }

  return tracks;
};

/**
 * Display rules for upsell on enrollment matrices.
 * Month matrix: same row as completed lower program. Phase matrix: separate row per upsell track.
 */
export const applyUpsellMatrixDisplayRules = (tracks, options = {}) => {
  const { periodKey = 'months' } = options;
  if (periodKey === 'months') {
    return applyUpsellMonthMatrixSameRowRules(tracks, options);
  }
  if (periodKey === 'phases') {
    return applyUpsellPhaseMatrixSeparateRowRules(tracks, options);
  }
  return tracks;
};

/**
 * True when student+class uses class-start billing (no installment profile and no paid downpayment).
 */
const IS_FULL_PAYMENT_SQL = `
  NOT EXISTS (
    SELECT 1
    FROM installmentinvoiceprofilestbl ip
    WHERE ip.student_id = cs.student_id
      AND ip.class_id = cs.class_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM invoicestbl i
    INNER JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
    WHERE ist.student_id = cs.student_id
      AND i.status = 'Paid'
      AND i.invoice_description ILIKE '%downpayment%'
      AND i.remarks ILIKE ('%CLASS_ID:' || cs.class_id::text || '%')
  )`;

/**
 * Re-enrollment rate per display month (spreadsheet logic):
 * - Numerator: enrolled in prior month AND still enrolled this month.
 * - Denominator: enrolled in prior month.
 * - Students not enrolled in the prior month (first-time or gap return) are never counted.
 * - First-ever enrolled month ("new") is never counted in that month's fraction.
 */
export const computeReEnrollmentMonthStats = (displayMonths, students, options = {}) => {
  const { selectedYear = null } = options;
  let totalReEnrolled = 0;
  let totalPriorMonthEnrolled = 0;

  const month_stats = displayMonths.map(({ key, label }, index) => {
    let prevKey = null;
    let hasPriorMonth = false;

    if (index > 0) {
      prevKey = displayMonths[index - 1].key;
      hasPriorMonth = true;
    } else if (selectedYear != null) {
      prevKey = `${selectedYear - 1}-12`;
      hasPriorMonth = true;
    }

    if (!hasPriorMonth || !prevKey) {
      return {
        month_key: key,
        month: label,
        re_enrolled_count: 0,
        prior_month_enrolled_count: 0,
        re_enrollment_rate: null,
        has_prior_month: false,
      };
    }

    let priorMonthEnrolledCount = 0;
    let reEnrolledCount = 0;

    for (const student of students) {
      const firstEnrolledKey = student.first_enrolled_month_key || null;
      if (firstEnrolledKey && key === firstEnrolledKey) continue;

      const wasEnrolledPrev = student.months[prevKey]?.mark === '1';
      const isEnrolledCurr = student.months[key]?.mark === '1';
      if (!wasEnrolledPrev) continue;

      priorMonthEnrolledCount += 1;
      if (isEnrolledCurr) reEnrolledCount += 1;
    }

    totalReEnrolled += reEnrolledCount;
    totalPriorMonthEnrolled += priorMonthEnrolledCount;

    const reEnrollmentRate =
      priorMonthEnrolledCount > 0
        ? Number(((reEnrolledCount / priorMonthEnrolledCount) * 100).toFixed(2))
        : null;

    return {
      month_key: key,
      month: label,
      re_enrolled_count: reEnrolledCount,
      prior_month_enrolled_count: priorMonthEnrolledCount,
      re_enrollment_rate: reEnrollmentRate,
      has_prior_month: true,
    };
  });

  const totalReEnrollmentRate =
    totalPriorMonthEnrolled > 0
      ? Number(((totalReEnrolled / totalPriorMonthEnrolled) * 100).toFixed(2))
      : 0;

  return {
    month_stats,
    total_re_enrolled_count: totalReEnrolled,
    total_prior_month_enrolled_count: totalPriorMonthEnrolled,
    total_re_enrollment_rate: totalReEnrollmentRate,
  };
};

/**
 * Re-enrollment rate per phase (same rules as monthly matrix, by phase):
 * - Numerator: enrolled in prior phase AND still enrolled this phase.
 * - Denominator: enrolled in prior phase.
 * - First phase has no prior (N/A). First-ever enrolled phase ("new") is never counted.
 */
export const computeReEnrollmentPhaseStats = (displayPhases, students) => {
  let totalReEnrolled = 0;
  let totalPriorPhaseEnrolled = 0;

  const phase_stats = displayPhases.map(({ key, label }, index) => {
    if (index === 0) {
      return {
        phase_number: key,
        phase: label,
        re_enrolled_count: 0,
        prior_phase_enrolled_count: 0,
        re_enrollment_rate: null,
        has_prior_phase: false,
      };
    }

    const prevKey = displayPhases[index - 1].key;
    let priorPhaseEnrolledCount = 0;
    let reEnrolledCount = 0;

    for (const student of students) {
      const firstEnrolledPhase = student.first_enrolled_phase ?? null;
      if (firstEnrolledPhase != null && key === firstEnrolledPhase) continue;

      const wasEnrolledPrev = student.phases[prevKey]?.mark === '1';
      const isEnrolledCurr = student.phases[key]?.mark === '1';
      if (!wasEnrolledPrev) continue;

      priorPhaseEnrolledCount += 1;
      if (isEnrolledCurr) reEnrolledCount += 1;
    }

    totalReEnrolled += reEnrolledCount;
    totalPriorPhaseEnrolled += priorPhaseEnrolledCount;

    const reEnrollmentRate =
      priorPhaseEnrolledCount > 0
        ? Number(((reEnrolledCount / priorPhaseEnrolledCount) * 100).toFixed(2))
        : null;

    return {
      phase_number: key,
      phase: label,
      re_enrolled_count: reEnrolledCount,
      prior_phase_enrolled_count: priorPhaseEnrolledCount,
      re_enrollment_rate: reEnrollmentRate,
      has_prior_phase: true,
    };
  });

  const totalReEnrollmentRate =
    totalPriorPhaseEnrolled > 0
      ? Number(((totalReEnrolled / totalPriorPhaseEnrolled) * 100).toFixed(2))
      : 0;

  return {
    phase_stats,
    total_re_enrolled_count: totalReEnrolled,
    total_prior_phase_enrolled_count: totalPriorPhaseEnrolled,
    total_re_enrollment_rate: totalReEnrollmentRate,
  };
};

/** Matches student_statustbl drop-blocking rule (migration 115). */
const DROP_BLOCKED_STUDENT_SQL = `
  SELECT DISTINCT cs.student_id
  FROM classstudentstbl cs
  WHERE cs.program_enrollment_status = 'dropped'
    AND NOT EXISTS (
      SELECT 1
      FROM classstudentstbl active_after_drop
      WHERE active_after_drop.student_id = cs.student_id
        AND active_after_drop.program_enrollment_status IN ${ACTIVE_PROGRAM_STATUSES}
        AND active_after_drop.removed_at IS NULL
        AND active_after_drop.enrolled_at > COALESCE(cs.removed_at, cs.enrolled_at)
    )`;

/**
 * @param {import('pg').QueryResult['rows']} rows
 */
export const summarizeEnrollmentRateByPhase = (rows) => {
  const byPhase = (rows || []).map((row) => ({
    phase_number: parseInt(row.phase_number, 10) || 0,
    enrolled_count: parseInt(row.enrolled_count, 10) || 0,
    student_count: parseInt(row.student_count, 10) || 0,
    enrollment_rate: Number(row.enrollment_rate) || 0,
  }));
  const enrolledCount = byPhase.reduce((sum, row) => sum + row.enrolled_count, 0);
  // Business rule: use a fixed cohort denominator, not SUM(student_count).
  // loadEnrollmentRateByPhase returns the same cohort_size in `student_count` for each phase row.
  const cohortSize = byPhase.length > 0 ? byPhase[0].student_count : 0;
  const enrollmentRate = cohortSize > 0
    ? Number(((enrolledCount / cohortSize) * 100).toFixed(2))
    : 0;
  const phaseNumbers = byPhase.map((row) => row.phase_number).filter((n) => n > 0);
  const phaseFrom = phaseNumbers.length > 0 ? Math.min(...phaseNumbers) : null;
  const phaseTo = phaseNumbers.length > 0 ? Math.max(...phaseNumbers) : null;
  const phasesSummaryLabel = phaseFrom != null && phaseTo != null
    ? (phaseFrom === phaseTo ? `Phase ${phaseFrom}` : `Phases ${phaseFrom}–${phaseTo}`)
    : 'Phases 1–10';

  return {
    by_phase: byPhase,
    enrolled_count: enrolledCount,
    student_count: cohortSize,
    enrollment_rate: enrollmentRate,
    phases_summary_label: phasesSummaryLabel,
    phase_from: phaseFrom,
    phase_to: phaseTo,
    phases_count: phaseNumbers.length,
  };
};

/**
 * @param {Function} queryFn - database query function
 * @param {{ branchId?: number|null, curriculumId?: number|null, enrolledOnDate?: string|null, enrolledFrom?: string|null, enrolledTo?: string|null }} options
 */
export const loadEnrollmentRateByPhase = async (queryFn, options = {}) => {
  const { branchId = null, curriculumId = null, enrolledOnDate = null, enrolledFrom = null, enrolledTo = null } = options;

  const params = [];
  let paramIdx = 1;
  let branchJoin = '';
  if (branchId) {
    branchJoin = `AND c.branch_id = $${paramIdx}`;
    params.push(branchId);
    paramIdx += 1;
  }
  let curriculumJoin = '';
  if (curriculumId) {
    curriculumJoin = `INNER JOIN programstbl p ON c.program_id = p.program_id AND p.curriculum_id = $${paramIdx}`;
    params.push(curriculumId);
    paramIdx += 1;
  }
  let dateFilter = '';
  if (enrolledOnDate) {
    dateFilter = `
      AND cs.enrolled_at IS NOT NULL
      AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date = $${paramIdx}::date`;
    params.push(enrolledOnDate);
    paramIdx += 1;
  } else if (enrolledFrom && enrolledTo) {
    dateFilter = `
      AND cs.enrolled_at IS NOT NULL
      AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date >= $${paramIdx}::date
      AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date < $${paramIdx + 1}::date`;
    params.push(enrolledFrom, enrolledTo);
    paramIdx += 2;
  }

  const result = await queryFn(
    `
      WITH scoped_rows AS (
        SELECT
          cs.student_id,
          COALESCE(cs.phase_number, 0) AS phase_number,
          cs.program_enrollment_status,
          cs.removed_at
        FROM classstudentstbl cs
        INNER JOIN classestbl c ON cs.class_id = c.class_id ${branchJoin}
        ${curriculumJoin}
        WHERE COALESCE(cs.phase_number, 0) > 0
          AND COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
          ${dateFilter}
      ),
      cohort AS (
        SELECT COUNT(DISTINCT student_id)::bigint AS cohort_size FROM scoped_rows
      ),
      phase_student AS (
        SELECT
          student_id,
          phase_number,
          BOOL_OR(
            program_enrollment_status IN ${ENROLLED_STATUSES}
            AND removed_at IS NULL
          ) AS is_enrolled
        FROM scoped_rows
        GROUP BY student_id, phase_number
      ),
      phase_agg AS (
        SELECT
          phase_number,
          COUNT(*) FILTER (WHERE is_enrolled)::bigint AS enrolled_count
        FROM phase_student
        GROUP BY phase_number
      )
      SELECT
        phase_number,
        enrolled_count,
        CASE
          WHEN cohort.cohort_size > 0
          THEN ROUND((enrolled_count::numeric / cohort.cohort_size::numeric) * 100, 2)
          ELSE 0
        END AS enrollment_rate,
        cohort.cohort_size::bigint AS student_count
      FROM phase_agg
      CROSS JOIN cohort
      ORDER BY phase_number ASC
    `,
    params
  );

  return summarizeEnrollmentRateByPhase(result.rows);
};

/**
 * Active reservations from reservedstudentstbl (same rules as class capacity on Classes page).
 * Counts status Reserved / Fee Paid; excludes Expired, Cancelled, Upgraded, and past-due unpaid.
 * @param {Function} queryFn
 * @param {{ branchId?: number|null, classId?: number|null, curriculumId?: number|null }} options
 */
export const loadReservedStudentsCount = async (queryFn, options = {}) => {
  const { branchId = null, classId = null, curriculumId = null } = options;
  const params = [];
  let paramIdx = 1;
  let curriculumJoin = '';
  const filters = [
    "r.status IN ('Reserved', 'Fee Paid')",
    'r.expired_at IS NULL',
    `NOT (
      COALESCE(r.due_date, inv.due_date) IS NOT NULL
      AND COALESCE(r.due_date, inv.due_date)::date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
      AND (
        r.invoice_id IS NULL
        OR COALESCE(inv.status, '') NOT IN ('Paid', 'Partially Paid')
      )
    )`,
  ];

  if (branchId) {
    filters.push(`(r.branch_id = $${paramIdx} OR c.branch_id = $${paramIdx})`);
    params.push(branchId);
    paramIdx += 1;
  }
  if (classId) {
    filters.push(`r.class_id = $${paramIdx}`);
    params.push(classId);
    paramIdx += 1;
  }
  if (curriculumId) {
    curriculumJoin = `INNER JOIN programstbl p ON c.program_id = p.program_id AND p.curriculum_id = $${paramIdx}`;
    params.push(curriculumId);
    paramIdx += 1;
  }

  const result = await queryFn(
    `
      SELECT COUNT(DISTINCT r.student_id)::bigint AS reserved_students_count
      FROM reservedstudentstbl r
      INNER JOIN classestbl c ON r.class_id = c.class_id
      LEFT JOIN invoicestbl inv ON r.invoice_id = inv.invoice_id
      ${curriculumJoin}
      WHERE ${filters.join(' AND ')}
    `,
    params
  );

  return parseInt(result.rows[0]?.reserved_students_count, 10) || 0;
};

/**
 * Active/inactive from student_statustbl; reserved from reservedstudentstbl snapshot.
 * @param {Function} queryFn
 * @param {{ branchId?: number|null, classId?: number|null, curriculumId?: number|null }} options
 */
export const loadEnrollmentStatusSnapshot = async (queryFn, options = {}) => {
  const { branchId = null, classId = null, curriculumId = null } = options;
  const branchParams = branchId ? [branchId] : [];
  const statusBranchJoin = branchId ? 'AND u.branch_id = $1' : '';

  const [statusResult, reservedStudentsCount] = await Promise.all([
    queryFn(
      `
        SELECT
          COUNT(DISTINCT ss.student_id) AS total_students,
          COUNT(DISTINCT CASE WHEN ss.status = 'active' THEN ss.student_id END) AS active_students,
          COUNT(DISTINCT CASE WHEN ss.status = 'inactive' THEN ss.student_id END) AS inactive_students
        FROM student_statustbl ss
        INNER JOIN userstbl u ON u.user_id = ss.student_id AND u.user_type = 'Student'
        WHERE 1 = 1 ${statusBranchJoin}
      `,
      branchParams
    ),
    loadReservedStudentsCount(queryFn, { branchId, classId, curriculumId }),
  ]);

  return {
    active_students: parseInt(statusResult.rows[0]?.active_students, 10) || 0,
    inactive_students: parseInt(statusResult.rows[0]?.inactive_students, 10) || 0,
    total_students: parseInt(statusResult.rows[0]?.total_students, 10) || 0,
    reserved_students_count: reservedStudentsCount,
  };
};

/**
 * Active/inactive for Enrollment Dashboard month picker: distinct students with enrolled_at in range.
 * Active = has a month enrollment row in ACTIVE_PROGRAM_STATUSES with removed_at IS NULL, and not drop-blocked.
 * @param {Function} queryFn
 * @param {{ branchId?: number|null, enrolledFrom: string, enrolledTo: string }} options
 */
export const loadEnrollmentStatusSnapshotForMonth = async (queryFn, options = {}) => {
  const { branchId = null, enrolledFrom, enrolledTo } = options;
  const params = [];
  let paramIdx = 1;
  let branchJoin = '';
  if (branchId) {
    branchJoin = `AND c.branch_id = $${paramIdx}`;
    params.push(branchId);
    paramIdx += 1;
  }
  const fromIdx = paramIdx;
  const toIdx = paramIdx + 1;
  params.push(enrolledFrom, enrolledTo);

  const result = await queryFn(
    `
      WITH month_enrollments AS (
        SELECT
          cs.student_id,
          cs.program_enrollment_status,
          cs.removed_at
        FROM classstudentstbl cs
        INNER JOIN classestbl c ON cs.class_id = c.class_id
        INNER JOIN userstbl u ON u.user_id = cs.student_id AND u.user_type = 'Student'
        WHERE 1 = 1
          ${branchJoin}
          ${buildMonthEnrolledAtFilter(fromIdx, toIdx)}
      ),
      student_month_status AS (
        SELECT
          me.student_id,
          BOOL_OR(
            me.program_enrollment_status IN ${ACTIVE_PROGRAM_STATUSES}
            AND me.removed_at IS NULL
          ) AS has_active_enrollment_in_month
        FROM month_enrollments me
        GROUP BY me.student_id
      ),
      drop_blocked AS (
        ${DROP_BLOCKED_STUDENT_SQL}
      )
      SELECT
        COUNT(DISTINCT sms.student_id)::bigint AS total_students,
        COUNT(DISTINCT CASE
          WHEN sms.has_active_enrollment_in_month AND db.student_id IS NULL
          THEN sms.student_id
        END)::bigint AS active_students,
        COUNT(DISTINCT CASE
          WHEN NOT sms.has_active_enrollment_in_month OR db.student_id IS NOT NULL
          THEN sms.student_id
        END)::bigint AS inactive_students
      FROM student_month_status sms
      LEFT JOIN drop_blocked db ON db.student_id = sms.student_id
    `,
    params
  );

  const row = result.rows[0] || {};
  return {
    active_students: parseInt(row.active_students, 10) || 0,
    inactive_students: parseInt(row.inactive_students, 10) || 0,
    total_students: parseInt(row.total_students, 10) || 0,
  };
};

/**
 * Active/inactive by branch for selected month (enrolled_at, Manila).
 * @param {Function} queryFn
 * @param {{ enrolledFrom: string, enrolledTo: string }} options
 */
export const loadActiveInactiveByBranchForMonth = async (queryFn, options = {}) => {
  const { enrolledFrom, enrolledTo } = options;
  const result = await queryFn(
    `
      WITH month_enrollments AS (
        SELECT
          cs.student_id,
          c.branch_id,
          cs.program_enrollment_status,
          cs.removed_at
        FROM classstudentstbl cs
        INNER JOIN classestbl c ON cs.class_id = c.class_id
        INNER JOIN userstbl u ON u.user_id = cs.student_id AND u.user_type = 'Student'
        WHERE cs.enrolled_at IS NOT NULL
          ${buildMonthEnrolledAtFilter(1, 2)}
      ),
      student_branch_month AS (
        SELECT
          me.student_id,
          me.branch_id,
          BOOL_OR(
            me.program_enrollment_status IN ${ACTIVE_PROGRAM_STATUSES}
            AND me.removed_at IS NULL
          ) AS has_active_enrollment_in_month
        FROM month_enrollments me
        GROUP BY me.student_id, me.branch_id
      ),
      drop_blocked AS (
        ${DROP_BLOCKED_STUDENT_SQL}
      )
      SELECT
        b.branch_id,
        COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
        COUNT(DISTINCT sbm.student_id)::bigint AS total,
        COUNT(DISTINCT CASE
          WHEN sbm.has_active_enrollment_in_month AND db.student_id IS NULL
          THEN sbm.student_id
        END)::bigint AS active_count,
        COUNT(DISTINCT CASE
          WHEN NOT sbm.has_active_enrollment_in_month OR db.student_id IS NOT NULL
          THEN sbm.student_id
        END)::bigint AS inactive_count
      FROM branchestbl b
      LEFT JOIN student_branch_month sbm ON sbm.branch_id = b.branch_id
      LEFT JOIN drop_blocked db ON db.student_id = sbm.student_id
      GROUP BY b.branch_id, b.branch_nickname, b.branch_name
      ORDER BY COALESCE(b.branch_nickname, b.branch_name)
    `,
    [enrolledFrom, enrolledTo]
  );

  return (result.rows || []).map((row) => ({
    branch_id: row.branch_id,
    branch_name: row.branch_name || 'Unassigned',
    total: parseInt(row.total, 10) || 0,
    active: parseInt(row.active_count, 10) || 0,
    inactive: parseInt(row.inactive_count, 10) || 0,
  }));
};

/**
 * Shared scope filters for enrollment-rate queries (matches dashboard phase table).
 * @returns {{ branchJoin: string, curriculumJoin: string, dateFilter: string, params: unknown[], nextIdx: number }}
 */
const buildEnrollmentRateScopeParts = (options = {}) => {
  const { branchId = null, curriculumId = null, enrolledOnDate = null, enrolledFrom = null, enrolledTo = null } =
    options;
  const params = [];
  let idx = 1;
  let branchJoin = '';
  let curriculumJoin = '';
  let dateFilter = '';

  if (branchId) {
    branchJoin = `AND c.branch_id = $${idx}`;
    params.push(branchId);
    idx += 1;
  }
  if (curriculumId) {
    curriculumJoin = `INNER JOIN programstbl p ON c.program_id = p.program_id AND p.curriculum_id = $${idx}`;
    params.push(curriculumId);
    idx += 1;
  }
  if (enrolledOnDate) {
    dateFilter = `
      AND cs.enrolled_at IS NOT NULL
      AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date = $${idx}::date`;
    params.push(enrolledOnDate);
    idx += 1;
  } else if (enrolledFrom && enrolledTo) {
    dateFilter = `
      AND cs.enrolled_at IS NOT NULL
      AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date >= $${idx}::date
      AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date < $${idx + 1}::date`;
    params.push(enrolledFrom, enrolledTo);
    idx += 2;
  }

  return { branchJoin, curriculumJoin, dateFilter, params, nextIdx: idx };
};

const enrollmentRatePhaseStudentsSql = (scope, phaseFilterSql = '') => `
  WITH scoped_rows AS (
    SELECT
      cs.student_id,
      COALESCE(cs.phase_number, 0) AS phase_number,
      cs.program_enrollment_status,
      cs.removed_at,
      cs.enrolled_at,
      COALESCE(c.class_name, '') AS class_name,
      c.branch_id AS class_branch_id
    FROM classstudentstbl cs
    INNER JOIN classestbl c ON cs.class_id = c.class_id ${scope.branchJoin}
    ${scope.curriculumJoin}
    WHERE COALESCE(cs.phase_number, 0) > 0
      AND COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
      ${scope.dateFilter}
  ),
  phase_student AS (
    SELECT
      student_id,
      phase_number,
      BOOL_OR(
        program_enrollment_status IN ${ENROLLED_STATUSES}
        AND removed_at IS NULL
      ) AS is_enrolled,
      STRING_AGG(DISTINCT program_enrollment_status, ', ' ORDER BY program_enrollment_status) AS statuses_seen,
      STRING_AGG(DISTINCT NULLIF(class_name, ''), ', ' ORDER BY NULLIF(class_name, '')) AS class_names,
      MAX(enrolled_at) AS enrolled_at,
      MAX(removed_at) AS removed_at
    FROM scoped_rows
    GROUP BY student_id, phase_number
  )
  SELECT
    ps.student_id,
    ps.phase_number,
    ps.is_enrolled,
    ps.statuses_seen,
    ps.class_names,
    TO_CHAR(TIMEZONE('Asia/Manila', ps.enrolled_at), 'YYYY-MM-DD HH24:MI:SS') AS enrolled_at_manila,
    TO_CHAR(TIMEZONE('Asia/Manila', ps.removed_at), 'YYYY-MM-DD HH24:MI:SS') AS removed_at_manila,
    u.full_name,
    u.email,
    u.level_tag,
    COALESCE(b.branch_nickname, b.branch_name) AS branch_name
  FROM phase_student ps
  INNER JOIN userstbl u ON u.user_id = ps.student_id
  LEFT JOIN branchestbl b ON b.branch_id = u.branch_id
  WHERE 1=1
    ${phaseFilterSql}
  ORDER BY ps.is_enrolled DESC, u.full_name ASC NULLS LAST, ps.student_id ASC
`;

/**
 * Student list behind enrollment-rate-by-phase (for human verification).
 * @param {Function} queryFn
 * @param {{ branchId?: number|null, curriculumId?: number|null, enrolledOnDate?: string|null, enrolledFrom?: string|null, enrolledTo?: string|null, phaseNumber: number }} options
 */
export const loadEnrollmentRatePhaseStudents = async (queryFn, options = {}) => {
  const {
    branchId = null,
    curriculumId = null,
    enrolledOnDate = null,
    enrolledFrom = null,
    enrolledTo = null,
    phaseNumber,
  } = options;

  const scope = buildEnrollmentRateScopeParts({
    branchId,
    curriculumId,
    enrolledOnDate,
    enrolledFrom,
    enrolledTo,
  });
  const params = [...scope.params];
  const phaseNum = parseInt(phaseNumber, 10);
  if (!Number.isFinite(phaseNum) || phaseNum <= 0) {
    return { students: [], summary: { phase_number: phaseNum, enrolled_count: 0, student_count: 0 } };
  }
  params.push(phaseNum);
  const phaseFilterSql = `AND ps.phase_number = $${scope.nextIdx}`;

  const result = await queryFn(enrollmentRatePhaseStudentsSql(scope, phaseFilterSql), params);
  const students = (result.rows || []).map((row) => ({
    student_id: parseInt(row.student_id, 10) || 0,
    phase_number: parseInt(row.phase_number, 10) || 0,
    is_enrolled: Boolean(row.is_enrolled),
    statuses_seen: row.statuses_seen || '',
    class_names: row.class_names || '',
    enrolled_at_manila: row.enrolled_at_manila || null,
    removed_at_manila: row.removed_at_manila || null,
    full_name: row.full_name || '',
    email: row.email || '',
    level_tag: row.level_tag || '',
    branch_name: row.branch_name || '',
  }));

  const enrolledCount = students.filter((s) => s.is_enrolled).length;
  return {
    students,
    summary: {
      phase_number: phaseNum,
      enrolled_count: enrolledCount,
      student_count: students.length,
    },
  };
};

/**
 * All phases — export rows for spreadsheet verification.
 */
export const loadEnrollmentRatePhaseStudentsExport = async (queryFn, options = {}) => {
  const { branchId = null, curriculumId = null, enrolledOnDate = null, enrolledFrom = null, enrolledTo = null } =
    options;
  const scope = buildEnrollmentRateScopeParts({
    branchId,
    curriculumId,
    enrolledOnDate,
    enrolledFrom,
    enrolledTo,
  });
  const result = await queryFn(enrollmentRatePhaseStudentsSql(scope, ''), scope.params);
  return (result.rows || []).map((row) => ({
    phase_number: parseInt(row.phase_number, 10) || 0,
    student_id: parseInt(row.student_id, 10) || 0,
    full_name: row.full_name || '',
    email: row.email || '',
    level_tag: row.level_tag || '',
    branch_name: row.branch_name || '',
    class_names: row.class_names || '',
    statuses_seen: row.statuses_seen || '',
    counts_toward_enrolled: Boolean(row.is_enrolled) ? 'Y' : 'N',
    enrolled_at_manila: row.enrolled_at_manila || '',
    removed_at_manila: row.removed_at_manila || '',
  }));
};

export const loadEnrollmentDashboardMetrics = async (queryFn, options = {}) => {
  const { branchId = null, enrolledOnDate = null, enrolledFrom = null, enrolledTo = null } = options;
  const toNextYmd = (ymd) => {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return null;
    const d = new Date(`${ymd}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return null;
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };

  const matrixFrom = enrolledFrom || enrolledOnDate || null;
  const matrixTo = enrolledTo || (enrolledOnDate ? toNextYmd(enrolledOnDate) : null);

  const [statusSnapshot, rateSummary, reEnrollmentSummary] = await Promise.all([
    loadEnrollmentStatusSnapshot(queryFn, { branchId }),
    loadEnrollmentRateByPhase(queryFn, { branchId, enrolledOnDate, enrolledFrom, enrolledTo }),
    loadStudentPhaseEnrollmentMatrix(queryFn, {
      branchId,
      enrolledFrom: matrixFrom,
      enrolledTo: matrixTo,
    }),
  ]);

  return {
    ...statusSnapshot,
    enrollment_rate: rateSummary.enrollment_rate,
    enrollment_rate_enrolled_count: rateSummary.enrolled_count,
    enrollment_rate_student_count: rateSummary.student_count,
    enrollment_rate_phases_summary_label: rateSummary.phases_summary_label,
    enrollment_rate_by_phase: rateSummary.by_phase,
    re_enrollment_rate: Number(reEnrollmentSummary?.total_re_enrollment_rate ?? 0) || 0,
    re_enrollment_rate_retained_count:
      parseInt(reEnrollmentSummary?.total_re_enrolled_count, 10) || 0,
    re_enrollment_rate_prior_count:
      parseInt(reEnrollmentSummary?.total_prior_phase_enrolled_count, 10) || 0,
  };
};

/**
 * Student × phase enrollment matrix driven purely by program_enrollment_status.
 *
 * Logic:
 *   - Cohort = all students who have any classstudentstbl row for phases 1–N
 *     (branch / curriculum scoped).
 *   - Cell = 1 when the student has a row for that phase where
 *       program_enrollment_status IN ('new','re_enrolled','upsell','rejoin','completed')
 *       AND removed_at IS NULL
 *     This covers: actively enrolled + completed-the-phase students
 *     (completed rows always have removed_at IS NULL per DB trigger).
 *   - Cell = 0 when the student has no qualifying row (never reached that phase,
 *     or was dropped from it).
 *   When enrolledFrom / enrolledTo are set (month scope), only rows with enrolled_at
 *   in that Manila calendar month are included.
 *
 * @param {Function} queryFn
 * @param {{ branchId?: number|null, curriculumId?: number|null, programId?: number|null, classId?: number|null, maxPhase?: number, enrolledFrom?: string|null, enrolledTo?: string|null }} options
 */
export const loadStudentPhaseEnrollmentMatrix = async (queryFn, options = {}) => {
  const {
    branchId = null,
    curriculumId = null,
    programId = null,
    classId = null,
    maxPhase = 10,
    enrolledFrom = null,
    enrolledTo = null,
  } = options;
  const phaseCount = Math.min(Math.max(parseInt(maxPhase, 10) || 10, 1), 10);

  const params = [phaseCount];
  let paramIdx = 2;
  let branchJoin = '';
  let curriculumJoin = '';
  let programJoin = '';
  let classJoin = '';
  if (branchId) {
    branchJoin = `AND c.branch_id = $${paramIdx}`;
    params.push(branchId);
    paramIdx += 1;
  }
  if (curriculumId) {
    curriculumJoin = `INNER JOIN programstbl p ON c.program_id = p.program_id AND p.curriculum_id = $${paramIdx}`;
    params.push(curriculumId);
    paramIdx += 1;
  }
  if (programId) {
    programJoin = `AND c.program_id = $${paramIdx}`;
    params.push(programId);
    paramIdx += 1;
  }
  if (classId) {
    classJoin = `AND cs.class_id = $${paramIdx}`;
    params.push(classId);
    paramIdx += 1;
  }
  let monthFilter = '';
  if (enrolledFrom && enrolledTo) {
    monthFilter = `
          AND cs.enrolled_at IS NOT NULL
          AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date >= $${paramIdx}::date
          AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date < $${paramIdx + 1}::date`;
    params.push(enrolledFrom, enrolledTo);
    paramIdx += 2;
  }

  const result = await queryFn(
    `
      WITH phase_series AS (
        SELECT generate_series(1, $1::int) AS phase_number
      ),
      scoped_rows AS (
        -- Phase records in scope; optional enrolled_at month window
        SELECT
          cs.classstudent_id,
          cs.student_id,
          cs.class_id,
          COALESCE(cs.phase_number, 0) AS phase_number,
          cs.program_enrollment_status,
          cs.removed_at,
          cs.enrolled_at,
          ${IS_FULL_PAYMENT_SQL} AS is_full_payment
        FROM classstudentstbl cs
        INNER JOIN classestbl c ON cs.class_id = c.class_id ${branchJoin}
        ${curriculumJoin}
        INNER JOIN userstbl u ON u.user_id = cs.student_id AND u.user_type = 'Student'
        WHERE COALESCE(cs.phase_number, 0) BETWEEN 1 AND $1::int
          AND COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
          ${programJoin}
          ${classJoin}
          ${monthFilter}
      ),
      cohort AS (
        SELECT DISTINCT student_id, class_id FROM scoped_rows
      ),
      track_first_enrolled AS (
        SELECT student_id, class_id, MIN(enrolled_at) AS first_enrolled_at
        FROM scoped_rows
        WHERE enrolled_at IS NOT NULL
        GROUP BY student_id, class_id
      ),
      student_phase_latest AS (
        -- Pick the latest row per student × class × phase (handles re-enroll/drop/rejoin history).
        SELECT
          sr.student_id,
          sr.class_id,
          sr.phase_number,
          sr.program_enrollment_status,
          sr.removed_at,
          sr.is_full_payment,
          ROW_NUMBER() OVER (
            PARTITION BY sr.student_id, sr.class_id, sr.phase_number
            ORDER BY COALESCE(sr.removed_at, sr.enrolled_at) DESC NULLS LAST, sr.classstudent_id DESC
          ) AS rn
        FROM scoped_rows sr
      ),
      matrix AS (
        -- Cross-join: every enrollment track × every phase slot
        SELECT
          co.student_id,
          co.class_id,
          ps.phase_number,
          spl.program_enrollment_status,
          spl.removed_at,
          spl.is_full_payment
        FROM cohort co
        CROSS JOIN phase_series ps
        LEFT JOIN student_phase_latest spl
          ON spl.student_id = co.student_id
         AND spl.class_id = co.class_id
         AND spl.phase_number = ps.phase_number
         AND spl.rn = 1
      )
      SELECT
        m.student_id,
        m.class_id,
        c.class_name,
        c.level_tag AS class_level_tag,
        u.full_name,
        m.phase_number,
        m.program_enrollment_status,
        m.removed_at,
        m.is_full_payment,
        tfe.first_enrolled_at
      FROM matrix m
      INNER JOIN userstbl u ON u.user_id = m.student_id
      INNER JOIN classestbl c ON c.class_id = m.class_id
      LEFT JOIN track_first_enrolled tfe
        ON tfe.student_id = m.student_id AND tfe.class_id = m.class_id
      ORDER BY tfe.first_enrolled_at ASC NULLS LAST, u.full_name ASC NULLS LAST, m.class_id ASC, m.phase_number ASC
    `,
    params
  );

  const phases = Array.from({ length: phaseCount }, (_, i) => {
    const phaseNumber = i + 1;
    return { key: phaseNumber, label: `Phase ${phaseNumber}` };
  });

  const studentMap = new Map();
  const normalizeStatusLabel = (status) => {
    if (!status) return '';
    const raw = String(status);
    switch (raw) {
      case 're_enrolled':
        return 're-enrolled';
      case 'pending_enrollment':
        return 'pending enrollment';
      default:
        return raw.replaceAll('_', ' ').toLowerCase();
    }
  };

  for (const row of result.rows || []) {
    const studentId = parseInt(row.student_id, 10);
    const classId = parseInt(row.class_id, 10);
    const phaseNumber = parseInt(row.phase_number, 10);
    const trackKey = enrollmentTrackKey(studentId, classId);
    if (!studentMap.has(trackKey)) {
      studentMap.set(
        trackKey,
        buildEnrollmentMatrixTrackRow({
          studentId,
          classId,
          fullName: row.full_name,
          className: row.class_name,
          classLevelTag: row.class_level_tag,
          firstEnrolledAt: row.first_enrolled_at,
          phases: {},
        })
      );
    }
    const status = row.program_enrollment_status || null;
    const removedAt = row.removed_at || null;
    const cell = buildPhaseMatrixCell(status, removedAt, normalizeStatusLabel);
    studentMap.get(trackKey).phases[phaseNumber] = {
      ...cell,
      is_full_payment: Boolean(row.is_full_payment),
    };
  }

  const siblingTracksByStudent = await loadUpsellSiblingTracksForPhaseMatrix(
    queryFn,
    studentMap,
    {
      branchId,
      phaseCount,
      enrolledFrom,
      enrolledTo,
    }
  );

  const cohortTracks = sortEnrollmentMatrixStudents(Array.from(studentMap.values()));
  const allTracks = [...cohortTracks];
  for (const siblingTracks of siblingTracksByStudent.values()) {
    for (const sibling of siblingTracks) {
      if (!allTracks.some((t) => t.enrollment_track_key === sibling.enrollment_track_key)) {
        allTracks.push(sibling);
      }
    }
  }

  const students = applyMatrixTrackDisplayNames(
    sortEnrollmentMatrixStudents(allTracks)
  );
  // Display-only normalization:
  // - Show "new" or "upsell" only on the student's first enrolled phase cell.
  // - If later enrolled phase cells still have status 'new' in DB, display as 're-enrolled'.
  // - Full-payment: last enrolled phase in scope shows 'completed' (matches installment fully-paid rule).
  for (const student of students) {
    const firstEnrolledPhase = phases.reduce((min, p) => {
      const cell = student.phases?.[p.key];
      if (cell?.mark === '1') return Math.min(min, p.key);
      return min;
    }, Number.POSITIVE_INFINITY);

    if (!Number.isFinite(firstEnrolledPhase)) continue;

    student.first_enrolled_phase = firstEnrolledPhase;

    let maxFullPayEnrolledPhase = 0;
    for (const p of phases) {
      const cell = student.phases?.[p.key];
      if (!cell || cell.mark !== '1') continue;
      if (cell.is_full_payment) {
        maxFullPayEnrolledPhase = Math.max(maxFullPayEnrolledPhase, p.key);
      }
      if (cell.status === 'upsell' && p.key === firstEnrolledPhase) {
        cell.label = 'upsell';
      } else if (cell.status === 'new' && p.key !== firstEnrolledPhase) {
        cell.label = normalizeStatusLabel('re_enrolled');
      } else if (cell.status === 're_enrolled') {
        cell.label = normalizeStatusLabel('re_enrolled');
      }
    }

    if (maxFullPayEnrolledPhase > firstEnrolledPhase) {
      const lastCell = student.phases[maxFullPayEnrolledPhase];
      if (lastCell?.mark === '1') {
        lastCell.label = 'completed';
      }
    }
  }

  applyUpsellMatrixDisplayRules(students, {
    periodKey: 'phases',
    siblingTracksByStudent,
  });
  applyMatrixTrackDisplayNames(students);
  const visibleStudents = filterHiddenMatrixTracks(students);
  const cohortSize = visibleStudents.length;
  const reEnrollmentStats = computeReEnrollmentPhaseStats(phases, visibleStudents);

  return {
    phases,
    students: visibleStudents,
    phase_stats: reEnrollmentStats.phase_stats,
    cohort_size: cohortSize,
    total_re_enrolled_count: reEnrollmentStats.total_re_enrolled_count,
    total_prior_phase_enrolled_count: reEnrollmentStats.total_prior_phase_enrolled_count,
    total_re_enrollment_rate: reEnrollmentStats.total_re_enrollment_rate,
    scope: enrolledFrom && enrolledTo ? 'month' : 'overall',
  };
};

/**
 * Shared label helper used by both matrix builders.
 * @param {string|null} status
 */
const normalizeEnrollmentLabel = (status) => {
  if (!status) return '';
  switch (status) {
    case 're_enrolled': return 're-enrolled';
    case 'pending_enrollment': return 'pending enrollment';
    default: return status.replaceAll('_', ' ').toLowerCase();
  }
};

/**
 * Load related enrollment tracks (lower or higher program level) for upsell merge when
 * the matrix scope (program/class filter) excludes them from the main cohort query.
 * Cross-program lookups intentionally ignore programId. Returns Map<studentId, track[]>.
 */
const loadUpsellSiblingTracksForMonthMatrix = async (
  queryFn,
  studentMap,
  {
    branchId = null,
    queryFromMonthStart,
    toMonthStart,
    fromMonthStart,
    firstEnrolledByTrack,
    firstEnrolledAtByTrack,
    lastFullPayMonthByTrack,
  }
) => {
  const visibleTracks = Array.from(studentMap.values());
  const studentIds = [...new Set(visibleTracks.map((t) => t.student_id))];
  if (!studentIds.length) return new Map();

  const existingKeys = new Set(studentMap.keys());
  const minLevelByStudent = new Map();
  const maxLevelByStudent = new Map();
  for (const track of visibleTracks) {
    const idx = levelTagIndex(track.class_level_tag);
    if (idx < 0) continue;
    const sid = track.student_id;
    const prevMin = minLevelByStudent.get(sid);
    const prevMax = maxLevelByStudent.get(sid);
    if (prevMin == null || idx < prevMin) minLevelByStudent.set(sid, idx);
    if (prevMax == null || idx > prevMax) maxLevelByStudent.set(sid, idx);
  }

  const params = [queryFromMonthStart, toMonthStart, fromMonthStart, studentIds];
  let paramIdx = 5;
  let branchJoin = '';
  if (branchId) {
    branchJoin = `AND c.branch_id = $${paramIdx}`;
    params.push(branchId);
    paramIdx += 1;
  }

  const result = await queryFn(
    `
      WITH month_series AS (
        SELECT gs::date AS month_start
        FROM generate_series($1::date, $2::date, '1 month'::interval) gs
      ),
      scoped_rows AS (
        SELECT
          cs.classstudent_id,
          cs.student_id,
          cs.class_id,
          COALESCE(cs.phase_number, 1) AS phase_number,
          cs.program_enrollment_status,
          cs.removed_at,
          cs.enrolled_at,
          c.start_date AS class_start_date,
          c.level_tag AS class_level_tag,
          ${IS_FULL_PAYMENT_SQL} AS is_full_payment
        FROM classstudentstbl cs
        INNER JOIN classestbl c ON cs.class_id = c.class_id ${branchJoin}
        INNER JOIN userstbl u ON u.user_id = cs.student_id AND u.user_type = 'Student'
        WHERE COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
          AND cs.student_id = ANY($4::int[])
          AND (cs.enrolled_at IS NOT NULL OR c.start_date IS NOT NULL)
      ),
      anchor AS (
        SELECT DISTINCT ON (student_id, class_id)
          student_id,
          class_id,
          phase_number AS base_phase,
          DATE_TRUNC('month', TIMEZONE('Asia/Manila', enrolled_at))::date AS base_month
        FROM scoped_rows
        WHERE enrolled_at IS NOT NULL
        ORDER BY student_id, class_id, phase_number ASC, enrolled_at ASC
      ),
      phase_billing AS (
        SELECT
          sr.student_id,
          sr.class_id,
          sr.phase_number,
          sr.program_enrollment_status,
          sr.removed_at,
          sr.classstudent_id,
          sr.is_full_payment,
          sr.class_level_tag,
          CASE
            WHEN sr.is_full_payment AND sr.class_start_date IS NOT NULL THEN
              (
                DATE_TRUNC('month', TIMEZONE('Asia/Manila', sr.class_start_date))::date
                + ((sr.phase_number - 1)::int * INTERVAL '1 month')
              )::date
            WHEN a.base_month IS NOT NULL THEN
              (a.base_month + ((sr.phase_number - a.base_phase)::int * INTERVAL '1 month'))::date
            ELSE NULL
          END AS billing_month
        FROM scoped_rows sr
        LEFT JOIN anchor a
          ON a.student_id = sr.student_id
         AND a.class_id = sr.class_id
      ),
      cohort AS (
        SELECT DISTINCT student_id, class_id
        FROM phase_billing
        WHERE billing_month IS NOT NULL
          AND billing_month >= $3::date
          AND billing_month <= $2::date
      ),
      student_month_status AS (
        SELECT DISTINCT ON (student_id, class_id, billing_month)
          student_id,
          class_id,
          billing_month,
          program_enrollment_status,
          removed_at,
          is_full_payment,
          class_level_tag
        FROM phase_billing
        WHERE billing_month IS NOT NULL
          AND billing_month >= $1::date
          AND billing_month <= $2::date
        ORDER BY
          student_id,
          class_id,
          billing_month,
          CASE
            WHEN program_enrollment_status IN ${ENROLLED_STATUSES} AND removed_at IS NULL THEN 0
            ELSE 1
          END ASC,
          removed_at DESC NULLS LAST,
          classstudent_id DESC
      ),
      matrix AS (
        SELECT
          co.student_id,
          co.class_id,
          ms.month_start,
          sms.program_enrollment_status,
          sms.removed_at,
          sms.is_full_payment,
          sms.class_level_tag
        FROM cohort co
        CROSS JOIN month_series ms
        LEFT JOIN student_month_status sms
          ON sms.student_id = co.student_id
         AND sms.class_id = co.class_id
         AND sms.billing_month = ms.month_start
      )
      SELECT
        m.student_id,
        m.class_id,
        c.class_name,
        m.class_level_tag,
        u.full_name,
        TO_CHAR(m.month_start, 'YYYY-MM') AS month_key,
        m.program_enrollment_status,
        m.removed_at,
        m.is_full_payment
      FROM matrix m
      INNER JOIN userstbl u ON u.user_id = m.student_id
      INNER JOIN classestbl c ON c.class_id = m.class_id
      ORDER BY m.student_id ASC, m.class_id ASC, m.month_start ASC
    `,
    params
  );

  const siblingTrackMap = new Map();
  for (const row of result.rows || []) {
    const studentId = parseInt(row.student_id, 10);
    const classId = parseInt(row.class_id, 10);
    const trackKey = enrollmentTrackKey(studentId, classId);
    if (existingKeys.has(trackKey)) continue;

    const rowLevel = levelTagIndex(row.class_level_tag);
    const minVisibleLevel = minLevelByStudent.get(studentId);
    const maxVisibleLevel = maxLevelByStudent.get(studentId);
    if (minVisibleLevel == null || maxVisibleLevel == null || rowLevel < 0) continue;
    const isHigherSibling = rowLevel > maxVisibleLevel;
    const isLowerSibling = rowLevel < minVisibleLevel;
    if (!isHigherSibling && !isLowerSibling) continue;

    if (!siblingTrackMap.has(trackKey)) {
      siblingTrackMap.set(
        trackKey,
        buildEnrollmentMatrixTrackRow({
          studentId,
          classId,
          fullName: row.full_name,
          className: row.class_name,
          classLevelTag: row.class_level_tag,
          firstEnrolledAt: firstEnrolledAtByTrack.get(trackKey) || null,
          firstEnrolledMonthKey: firstEnrolledByTrack.get(trackKey) || null,
          lastFullPayMonthKey: lastFullPayMonthByTrack.get(trackKey) || null,
          months: {},
        })
      );
    }

    const status = row.program_enrollment_status || null;
    const removedAt = row.removed_at || null;
    const isEnrolled = status && ENROLLED_STATUSES_LIST.includes(status) && removedAt == null;
    const mark = isEnrolled ? '1' : '-';
    const label = isEnrolled
      ? normalizeEnrollmentLabel(status)
      : status === 'dropped' || removedAt != null
        ? 'dropped/unenrolled'
        : normalizeEnrollmentLabel(status);

    siblingTrackMap.get(trackKey).months[row.month_key] = {
      mark,
      label,
      status,
      is_full_payment: Boolean(row.is_full_payment),
    };
  }

  if (siblingTrackMap.size > 0) {
    const metaParams = [studentIds];
    let metaBranchJoin = '';
    if (branchId) {
      metaParams.push(branchId);
      metaBranchJoin = `AND c.branch_id = $2`;
    }
    const metaResult = await queryFn(
      `
        WITH scoped_rows AS (
          SELECT
            cs.student_id,
            cs.class_id,
            COALESCE(cs.phase_number, 1) AS phase_number,
            cs.program_enrollment_status,
            cs.removed_at,
            cs.enrolled_at,
            c.start_date AS class_start_date,
            ${IS_FULL_PAYMENT_SQL} AS is_full_payment
          FROM classstudentstbl cs
          INNER JOIN classestbl c ON cs.class_id = c.class_id ${metaBranchJoin}
          WHERE cs.student_id = ANY($1::int[])
            AND COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
            AND (cs.enrolled_at IS NOT NULL OR c.start_date IS NOT NULL)
        ),
        anchor AS (
          SELECT DISTINCT ON (student_id, class_id)
            student_id,
            class_id,
            phase_number AS base_phase,
            DATE_TRUNC('month', TIMEZONE('Asia/Manila', enrolled_at))::date AS base_month
          FROM scoped_rows
          WHERE enrolled_at IS NOT NULL
          ORDER BY student_id, class_id, phase_number ASC, enrolled_at ASC
        ),
        phase_billing AS (
          SELECT
            sr.student_id,
            sr.class_id,
            sr.program_enrollment_status,
            sr.removed_at,
            sr.is_full_payment,
            CASE
              WHEN sr.is_full_payment AND sr.class_start_date IS NOT NULL THEN
                (
                  DATE_TRUNC('month', TIMEZONE('Asia/Manila', sr.class_start_date))::date
                  + ((sr.phase_number - 1)::int * INTERVAL '1 month')
                )::date
              WHEN a.base_month IS NOT NULL THEN
                (a.base_month + ((sr.phase_number - a.base_phase)::int * INTERVAL '1 month'))::date
              ELSE NULL
            END AS billing_month
          FROM scoped_rows sr
          LEFT JOIN anchor a
            ON a.student_id = sr.student_id
           AND a.class_id = sr.class_id
        ),
        first_enrolled AS (
          SELECT student_id, class_id, MIN(billing_month) AS first_billing_month
          FROM phase_billing
          WHERE billing_month IS NOT NULL
            AND program_enrollment_status IN ${ENROLLED_STATUSES}
            AND removed_at IS NULL
          GROUP BY student_id, class_id
        ),
        last_full_pay AS (
          SELECT student_id, class_id, MAX(billing_month) AS last_full_pay_billing_month
          FROM phase_billing
          WHERE billing_month IS NOT NULL
            AND is_full_payment = true
            AND program_enrollment_status IN ${ENROLLED_STATUSES}
            AND removed_at IS NULL
          GROUP BY student_id, class_id
        ),
        track_first_enrolled AS (
          SELECT student_id, class_id, MIN(enrolled_at) AS first_enrolled_at
          FROM scoped_rows
          WHERE enrolled_at IS NOT NULL
          GROUP BY student_id, class_id
        )
        SELECT
          tfe.student_id,
          tfe.class_id,
          tfe.first_enrolled_at,
          TO_CHAR(fe.first_billing_month, 'YYYY-MM') AS first_enrolled_month_key,
          TO_CHAR(lfp.last_full_pay_billing_month, 'YYYY-MM') AS last_full_pay_month_key
        FROM track_first_enrolled tfe
        LEFT JOIN first_enrolled fe
          ON fe.student_id = tfe.student_id AND fe.class_id = tfe.class_id
        LEFT JOIN last_full_pay lfp
          ON lfp.student_id = tfe.student_id AND lfp.class_id = tfe.class_id
      `,
      metaParams
    );

    for (const row of metaResult.rows || []) {
      const trackKey = enrollmentTrackKey(row.student_id, row.class_id);
      const track = siblingTrackMap.get(trackKey);
      if (!track) continue;
      track.first_enrolled_at =
        row.first_enrolled_at || firstEnrolledAtByTrack.get(trackKey) || null;
      track.first_enrolled_month_key =
        row.first_enrolled_month_key || firstEnrolledByTrack.get(trackKey) || null;
      track.last_full_pay_month_key =
        row.last_full_pay_month_key || lastFullPayMonthByTrack.get(trackKey) || null;
    }
  }

  const siblingByStudent = new Map();
  for (const track of siblingTrackMap.values()) {
    if (!siblingByStudent.has(track.student_id)) {
      siblingByStudent.set(track.student_id, []);
    }
    siblingByStudent.get(track.student_id).push(track);
  }
  return siblingByStudent;
};

/**
 * Load related phase-matrix tracks (lower or higher program) for upsell rows when
 * program/class filters exclude them from the main cohort query.
 */
const loadUpsellSiblingTracksForPhaseMatrix = async (
  queryFn,
  studentMap,
  { branchId = null, phaseCount = 10, enrolledFrom = null, enrolledTo = null }
) => {
  const visibleTracks = Array.from(studentMap.values());
  const studentIds = [...new Set(visibleTracks.map((t) => t.student_id))];
  if (!studentIds.length) return new Map();

  const existingKeys = new Set(studentMap.keys());
  const minLevelByStudent = new Map();
  const maxLevelByStudent = new Map();
  for (const track of visibleTracks) {
    const idx = levelTagIndex(track.class_level_tag);
    if (idx < 0) continue;
    const sid = track.student_id;
    const prevMin = minLevelByStudent.get(sid);
    const prevMax = maxLevelByStudent.get(sid);
    if (prevMin == null || idx < prevMin) minLevelByStudent.set(sid, idx);
    if (prevMax == null || idx > prevMax) maxLevelByStudent.set(sid, idx);
  }

  const params = [phaseCount, studentIds];
  let paramIdx = 3;
  let branchJoin = '';
  if (branchId) {
    branchJoin = `AND c.branch_id = $${paramIdx}`;
    params.push(branchId);
    paramIdx += 1;
  }
  let monthFilter = '';
  if (enrolledFrom && enrolledTo) {
    monthFilter = `
          AND cs.enrolled_at IS NOT NULL
          AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date >= $${paramIdx}::date
          AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date < $${paramIdx + 1}::date`;
    params.push(enrolledFrom, enrolledTo);
  }

  const result = await queryFn(
    `
      WITH phase_series AS (
        SELECT generate_series(1, $1::int) AS phase_number
      ),
      scoped_rows AS (
        SELECT
          cs.classstudent_id,
          cs.student_id,
          cs.class_id,
          COALESCE(cs.phase_number, 0) AS phase_number,
          cs.program_enrollment_status,
          cs.removed_at,
          cs.enrolled_at,
          c.level_tag AS class_level_tag,
          ${IS_FULL_PAYMENT_SQL} AS is_full_payment
        FROM classstudentstbl cs
        INNER JOIN classestbl c ON cs.class_id = c.class_id ${branchJoin}
        INNER JOIN userstbl u ON u.user_id = cs.student_id AND u.user_type = 'Student'
        WHERE COALESCE(cs.phase_number, 0) BETWEEN 1 AND $1::int
          AND COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
          AND cs.student_id = ANY($2::int[])
          ${monthFilter}
      ),
      cohort AS (
        SELECT DISTINCT student_id, class_id FROM scoped_rows
      ),
      track_first_enrolled AS (
        SELECT student_id, class_id, MIN(enrolled_at) AS first_enrolled_at
        FROM scoped_rows
        WHERE enrolled_at IS NOT NULL
        GROUP BY student_id, class_id
      ),
      student_phase_latest AS (
        SELECT
          sr.student_id,
          sr.class_id,
          sr.phase_number,
          sr.program_enrollment_status,
          sr.removed_at,
          sr.is_full_payment,
          sr.class_level_tag,
          ROW_NUMBER() OVER (
            PARTITION BY sr.student_id, sr.class_id, sr.phase_number
            ORDER BY COALESCE(sr.removed_at, sr.enrolled_at) DESC NULLS LAST, sr.classstudent_id DESC
          ) AS rn
        FROM scoped_rows sr
      ),
      matrix AS (
        SELECT
          co.student_id,
          co.class_id,
          ps.phase_number,
          spl.program_enrollment_status,
          spl.removed_at,
          spl.is_full_payment,
          spl.class_level_tag
        FROM cohort co
        CROSS JOIN phase_series ps
        LEFT JOIN student_phase_latest spl
          ON spl.student_id = co.student_id
         AND spl.class_id = co.class_id
         AND spl.phase_number = ps.phase_number
         AND spl.rn = 1
      )
      SELECT
        m.student_id,
        m.class_id,
        c.class_name,
        m.class_level_tag,
        u.full_name,
        m.phase_number,
        m.program_enrollment_status,
        m.removed_at,
        m.is_full_payment,
        tfe.first_enrolled_at
      FROM matrix m
      INNER JOIN userstbl u ON u.user_id = m.student_id
      INNER JOIN classestbl c ON c.class_id = m.class_id
      LEFT JOIN track_first_enrolled tfe
        ON tfe.student_id = m.student_id AND tfe.class_id = m.class_id
      ORDER BY m.student_id ASC, m.class_id ASC, m.phase_number ASC
    `,
    params
  );

  const normalizeStatusLabel = (status) => {
    if (!status) return '';
    switch (String(status)) {
      case 're_enrolled':
        return 're-enrolled';
      case 'pending_enrollment':
        return 'pending enrollment';
      default:
        return String(status).replaceAll('_', ' ').toLowerCase();
    }
  };

  const siblingTrackMap = new Map();
  for (const row of result.rows || []) {
    const studentId = parseInt(row.student_id, 10);
    const classId = parseInt(row.class_id, 10);
    const phaseNumber = parseInt(row.phase_number, 10);
    const trackKey = enrollmentTrackKey(studentId, classId);
    if (existingKeys.has(trackKey)) continue;

    const rowLevel = levelTagIndex(row.class_level_tag);
    const minVisibleLevel = minLevelByStudent.get(studentId);
    const maxVisibleLevel = maxLevelByStudent.get(studentId);
    if (minVisibleLevel == null || maxVisibleLevel == null || rowLevel < 0) continue;
    const isHigherSibling = rowLevel > maxVisibleLevel;
    const isLowerSibling = rowLevel < minVisibleLevel;
    if (!isHigherSibling && !isLowerSibling) continue;

    if (!siblingTrackMap.has(trackKey)) {
      siblingTrackMap.set(
        trackKey,
        buildEnrollmentMatrixTrackRow({
          studentId,
          classId,
          fullName: row.full_name,
          className: row.class_name,
          classLevelTag: row.class_level_tag,
          firstEnrolledAt: row.first_enrolled_at,
          phases: {},
        })
      );
    }

    const status = row.program_enrollment_status || null;
    const removedAt = row.removed_at || null;
    const cell = buildPhaseMatrixCell(status, removedAt, normalizeStatusLabel);
    siblingTrackMap.get(trackKey).phases[phaseNumber] = {
      ...cell,
      is_full_payment: Boolean(row.is_full_payment),
    };
  }

  const siblingByStudent = new Map();
  for (const track of siblingTrackMap.values()) {
    if (!siblingByStudent.has(track.student_id)) {
      siblingByStudent.set(track.student_id, []);
    }
    siblingByStudent.get(track.student_id).push(track);
  }
  return siblingByStudent;
};

/**
 * Student × month enrollment matrix — phase-offset billing model.
 *
 * WHY phase-offset instead of enrolled_at month:
 *   Invoices are generated on the 25th of month M, due 5th of M+1.
 *   A student may pay February's invoice on January 28 (before due date).
 *   In that case the Phase 2 row has enrolled_at = January 28, which would
 *   wrongly place them in January's column if we used enrolled_at month.
 *   Similarly, advance payments (paying Phase 3, 4, 5 in one go in January)
 *   must appear in March, April, May — not all in January.
 *
 * SOLUTION — two billing models:
 *
 *   Installment (has installmentinvoiceprofilestbl for student+class):
 *     1. ANCHOR = earliest phase + enrolled_at month of that phase.
 *     2. billing_month = anchor_month + (phase_number − anchor_phase) months
 *     Handles early/late payments vs invoice due dates.
 *
 *   Full-payment (no installment profile for student+class):
 *     billing_month = class.start_date month + (phase_number − 1) months
 *     Aligns phases to when the class actually runs, not when tuition was paid.
 *     Falls back to installment anchor logic when start_date is missing.
 *
 *   Cohort = students with at least one billing_month inside the display window.
 *
 * @param {Function} queryFn
 * @param {{ branchId?: number|null, programId?: number|null, classId?: number|null, year?: number|string|null, fromMonth?: string, toMonth?: string }} options
 *   year — calendar year (Jan–Dec). Takes precedence over fromMonth/toMonth.
 *   fromMonth / toMonth — YYYY-MM strings (inclusive). Used only when year is omitted.
 */
export const loadStudentMonthEnrollmentMatrix = async (queryFn, options = {}) => {
  const { branchId = null, programId = null, classId = null, year = null, fromMonth = null, toMonth = null } = options;

  const nowManila = new Date(
    new Date().toLocaleString('en-CA', { timeZone: 'Asia/Manila' })
  );
  const currentYear = nowManila.getFullYear();

  let fromYM;
  let toYM;
  let selectedYear = null;
  let monthLabelMode = 'short_year'; // 'short' = Jan, Feb … | 'short_year' = Jul 2025

  if (year != null && year !== '') {
    const y = parseInt(String(year), 10);
    if (!Number.isFinite(y) || y < 2000 || y > 2100) {
      throw new Error('year must be a valid calendar year');
    }
    selectedYear = y;
    fromYM = `${y}-01`;
    toYM = `${y}-12`;
    monthLabelMode = 'short';
  } else {
    toYM = toMonth || `${currentYear}-${String(nowManila.getMonth() + 1).padStart(2, '0')}`;
    fromYM = fromMonth || (() => {
      const d = new Date(`${toYM}-01`);
      d.setMonth(d.getMonth() - 11);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();
  }

  const fromMonthStart = `${fromYM}-01`;
  const toMonthStart = `${toYM}-01`;
  const queryFromMonthStart =
    selectedYear != null ? `${selectedYear - 1}-12-01` : fromMonthStart;

  const buildScopeJoins = (startIdx, targetParams) => {
    let idx = startIdx;
    let branchJoinSql = '';
    let programJoinSql = '';
    let classJoinSql = '';
    if (branchId) {
      branchJoinSql = `AND c.branch_id = $${idx}`;
      targetParams.push(branchId);
      idx += 1;
    }
    if (programId) {
      programJoinSql = `AND c.program_id = $${idx}`;
      targetParams.push(programId);
      idx += 1;
    }
    if (classId) {
      classJoinSql = `AND cs.class_id = $${idx}`;
      targetParams.push(classId);
      idx += 1;
    }
    return { branchJoin: branchJoinSql, programJoin: programJoinSql, classJoin: classJoinSql };
  };

  const params = [queryFromMonthStart, toMonthStart, fromMonthStart];
  const { branchJoin, programJoin, classJoin } = buildScopeJoins(4, params);

  const scopeParams = [];
  const { branchJoin: scopeBranchJoin, programJoin: scopeProgramJoin, classJoin: scopeClassJoin } =
    buildScopeJoins(1, scopeParams);

  const result = await queryFn(
    `
      WITH month_series AS (
        SELECT gs::date AS month_start
        FROM generate_series($1::date, $2::date, '1 month'::interval) gs
      ),

      -- All phase rows for the scoped student set (no date filter here —
      -- we need every phase to compute billing months correctly)
      scoped_rows AS (
        SELECT
          cs.classstudent_id,
          cs.student_id,
          cs.class_id,
          COALESCE(cs.phase_number, 1)                                           AS phase_number,
          cs.program_enrollment_status,
          cs.removed_at,
          cs.enrolled_at,
          c.start_date                                                           AS class_start_date,
          ${IS_FULL_PAYMENT_SQL}                                                                      AS is_full_payment
        FROM classstudentstbl cs
        INNER JOIN classestbl c ON cs.class_id = c.class_id ${branchJoin}
        INNER JOIN userstbl u ON u.user_id = cs.student_id AND u.user_type = 'Student'
        WHERE COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
          AND (
            cs.enrolled_at IS NOT NULL
            OR c.start_date IS NOT NULL
          )
          ${programJoin}
          ${classJoin}
      ),

      -- Installment anchor: earliest phase + enrolled_at month (payment-driven).
      anchor AS (
        SELECT DISTINCT ON (student_id, class_id)
          student_id,
          class_id,
          phase_number                                                           AS base_phase,
          DATE_TRUNC('month', TIMEZONE('Asia/Manila', enrolled_at))::date        AS base_month
        FROM scoped_rows
        WHERE enrolled_at IS NOT NULL
        ORDER BY student_id, class_id, phase_number ASC, enrolled_at ASC
      ),

      phase_billing AS (
        SELECT
          sr.student_id,
          sr.class_id,
          sr.phase_number,
          sr.program_enrollment_status,
          sr.removed_at,
          sr.classstudent_id,
          sr.is_full_payment,
          CASE
            WHEN sr.is_full_payment AND sr.class_start_date IS NOT NULL THEN
              (
                DATE_TRUNC('month', TIMEZONE('Asia/Manila', sr.class_start_date))::date
                + ((sr.phase_number - 1)::int * INTERVAL '1 month')
              )::date
            WHEN a.base_month IS NOT NULL THEN
              (a.base_month + ((sr.phase_number - a.base_phase)::int * INTERVAL '1 month'))::date
            ELSE NULL
          END AS billing_month
        FROM scoped_rows sr
        LEFT JOIN anchor a
          ON a.student_id = sr.student_id
         AND a.class_id   = sr.class_id
      ),

      -- Cohort = enrollment tracks with at least one billing_month inside the display window.
      cohort AS (
        SELECT DISTINCT student_id, class_id
        FROM phase_billing
        WHERE billing_month IS NOT NULL
          AND billing_month >= $3::date
          AND billing_month <= $2::date
      ),

      -- Per track per billing_month: pick the best status row.
      student_month_status AS (
        SELECT DISTINCT ON (student_id, class_id, billing_month)
          student_id,
          class_id,
          billing_month,
          program_enrollment_status,
          removed_at,
          is_full_payment
        FROM phase_billing
        WHERE billing_month IS NOT NULL
          AND billing_month >= $1::date
          AND billing_month <= $2::date
        ORDER BY
          student_id,
          class_id,
          billing_month,
          CASE
            WHEN program_enrollment_status IN ${ENROLLED_STATUSES} AND removed_at IS NULL THEN 0
            ELSE 1
          END ASC,
          removed_at DESC NULLS LAST,
          classstudent_id DESC
      ),

      matrix AS (
        SELECT
          co.student_id,
          co.class_id,
          ms.month_start,
          sms.program_enrollment_status,
          sms.removed_at,
          sms.is_full_payment
        FROM cohort co
        CROSS JOIN month_series ms
        LEFT JOIN student_month_status sms
          ON sms.student_id   = co.student_id
         AND sms.class_id     = co.class_id
         AND sms.billing_month = ms.month_start
      )

      SELECT
        m.student_id,
        m.class_id,
        c.class_name,
        c.level_tag AS class_level_tag,
        u.full_name,
        TO_CHAR(m.month_start, 'YYYY-MM')  AS month_key,
        TO_CHAR(m.month_start, 'Mon YYYY') AS month_label,
        m.program_enrollment_status,
        m.removed_at,
        m.is_full_payment
      FROM matrix m
      INNER JOIN userstbl u ON u.user_id = m.student_id
      INNER JOIN classestbl c ON c.class_id = m.class_id
      ORDER BY u.full_name ASC NULLS LAST, m.class_id ASC, m.student_id ASC, m.month_start ASC
    `,
    params
  );

  const firstEnrollResult = await queryFn(
    `
      WITH scoped_rows AS (
        SELECT
          cs.classstudent_id,
          cs.student_id,
          cs.class_id,
          COALESCE(cs.phase_number, 1)                                           AS phase_number,
          cs.program_enrollment_status,
          cs.removed_at,
          cs.enrolled_at,
          c.start_date                                                           AS class_start_date,
          ${IS_FULL_PAYMENT_SQL}                                                                      AS is_full_payment
        FROM classstudentstbl cs
        INNER JOIN classestbl c ON cs.class_id = c.class_id ${scopeBranchJoin}
        INNER JOIN userstbl u ON u.user_id = cs.student_id AND u.user_type = 'Student'
        WHERE COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
          AND (
            cs.enrolled_at IS NOT NULL
            OR c.start_date IS NOT NULL
          )
          ${scopeProgramJoin}
          ${scopeClassJoin}
      ),
      anchor AS (
        SELECT DISTINCT ON (student_id, class_id)
          student_id,
          class_id,
          phase_number                                                           AS base_phase,
          DATE_TRUNC('month', TIMEZONE('Asia/Manila', enrolled_at))::date        AS base_month
        FROM scoped_rows
        WHERE enrolled_at IS NOT NULL
        ORDER BY student_id, class_id, phase_number ASC, enrolled_at ASC
      ),
      phase_billing AS (
        SELECT
          sr.student_id,
          sr.class_id,
          sr.phase_number,
          sr.program_enrollment_status,
          sr.removed_at,
          sr.is_full_payment,
          CASE
            WHEN sr.is_full_payment AND sr.class_start_date IS NOT NULL THEN
              (
                DATE_TRUNC('month', TIMEZONE('Asia/Manila', sr.class_start_date))::date
                + ((sr.phase_number - 1)::int * INTERVAL '1 month')
              )::date
            WHEN a.base_month IS NOT NULL THEN
              (a.base_month + ((sr.phase_number - a.base_phase)::int * INTERVAL '1 month'))::date
            ELSE NULL
          END AS billing_month
        FROM scoped_rows sr
        LEFT JOIN anchor a
          ON a.student_id = sr.student_id
         AND a.class_id   = sr.class_id
      ),
      first_enrolled AS (
        SELECT
          student_id,
          class_id,
          MIN(billing_month) AS first_billing_month
        FROM phase_billing
        WHERE billing_month IS NOT NULL
          AND program_enrollment_status IN ${ENROLLED_STATUSES}
          AND removed_at IS NULL
        GROUP BY student_id, class_id
      ),
      last_full_pay AS (
        SELECT
          student_id,
          class_id,
          MAX(billing_month) AS last_full_pay_billing_month
        FROM phase_billing
        WHERE billing_month IS NOT NULL
          AND is_full_payment = true
          AND program_enrollment_status IN ${ENROLLED_STATUSES}
          AND removed_at IS NULL
        GROUP BY student_id, class_id
      ),
      track_first_enrolled AS (
        SELECT student_id, class_id, MIN(enrolled_at) AS first_enrolled_at
        FROM scoped_rows
        WHERE enrolled_at IS NOT NULL
        GROUP BY student_id, class_id
      )
      SELECT
        tfe.student_id,
        tfe.class_id,
        tfe.first_enrolled_at,
        TO_CHAR(fe.first_billing_month, 'YYYY-MM') AS first_enrolled_month_key,
        TO_CHAR(lfp.last_full_pay_billing_month, 'YYYY-MM') AS last_full_pay_month_key
      FROM track_first_enrolled tfe
      LEFT JOIN first_enrolled fe
        ON fe.student_id = tfe.student_id AND fe.class_id = tfe.class_id
      LEFT JOIN last_full_pay lfp
        ON lfp.student_id = tfe.student_id AND lfp.class_id = tfe.class_id
    `,
    scopeParams
  );

  const firstEnrolledByTrack = new Map();
  const firstEnrolledAtByTrack = new Map();
  const lastFullPayMonthByTrack = new Map();
  for (const row of firstEnrollResult.rows || []) {
    const studentId = parseInt(row.student_id, 10);
    const classId = parseInt(row.class_id, 10);
    const trackKey = enrollmentTrackKey(studentId, classId);
    if (row.first_enrolled_month_key) {
      firstEnrolledByTrack.set(trackKey, row.first_enrolled_month_key);
    }
    if (row.first_enrolled_at) {
      firstEnrolledAtByTrack.set(trackKey, row.first_enrolled_at);
    }
    if (row.last_full_pay_month_key) {
      lastFullPayMonthByTrack.set(trackKey, row.last_full_pay_month_key);
    }
  }

  // Build ordered months list from the query params (not from result rows, so empty months show)
  const months = [];
  {
    let cur = new Date(fromMonthStart);
    const end = new Date(toMonthStart);
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
      const label =
        monthLabelMode === 'short'
          ? cur.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
          : cur.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
      months.push({ key, label });
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
  }

  const studentMap = new Map();

  for (const row of result.rows || []) {
    const studentId = parseInt(row.student_id, 10);
    const classId = parseInt(row.class_id, 10);
    const monthKey = row.month_key;
    const trackKey = enrollmentTrackKey(studentId, classId);

    if (!studentMap.has(trackKey)) {
      studentMap.set(
        trackKey,
        buildEnrollmentMatrixTrackRow({
          studentId,
          classId,
          fullName: row.full_name,
          className: row.class_name,
          classLevelTag: row.class_level_tag,
          firstEnrolledAt: firstEnrolledAtByTrack.get(trackKey) || null,
          firstEnrolledMonthKey: firstEnrolledByTrack.get(trackKey) || null,
          lastFullPayMonthKey: lastFullPayMonthByTrack.get(trackKey) || null,
          months: {},
        })
      );
    }

    const status = row.program_enrollment_status || null;
    const removedAt = row.removed_at || null;
    const isEnrolled = status && ENROLLED_STATUSES_LIST.includes(status) && removedAt == null;
    const mark = isEnrolled ? '1' : '-';
    const label = isEnrolled
      ? normalizeEnrollmentLabel(status)
      : status === 'dropped' || removedAt != null
        ? 'dropped/unenrolled'
        : normalizeEnrollmentLabel(status);

    studentMap.get(trackKey).months[monthKey] = {
      mark,
      label,
      status,
      is_full_payment: Boolean(row.is_full_payment),
    };
  }

  const displayMonthKeys = new Set(months.map((m) => m.key));
  const displayEnrolledToExclusive = (() => {
    const end = new Date(`${toYM}-01T00:00:00.000Z`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return end.toISOString().slice(0, 10);
  })();
  const calendarOverlayParams = [fromMonthStart, displayEnrolledToExclusive];
  const {
    branchJoin: calendarBranchJoin,
    programJoin: calendarProgramJoin,
    classJoin: calendarClassJoin,
  } = buildScopeJoins(3, calendarOverlayParams);

  const ensureMatrixStudent = (studentId, classId, fullName, className = '', classLevelTag = '') => {
    const trackKey = enrollmentTrackKey(studentId, classId);
    if (!studentMap.has(trackKey)) {
      studentMap.set(
        trackKey,
        buildEnrollmentMatrixTrackRow({
          studentId,
          classId,
          fullName,
          className,
          classLevelTag,
          firstEnrolledAt: firstEnrolledAtByTrack.get(trackKey) || null,
          firstEnrolledMonthKey: firstEnrolledByTrack.get(trackKey) || null,
          lastFullPayMonthKey: lastFullPayMonthByTrack.get(trackKey) || null,
          months: {},
        })
      );
    }
    return studentMap.get(trackKey);
  };

  // Dropped/unenrolled by removed_at calendar month (matches operational dashboard).
  const droppedCalendarResult = await queryFn(
    `
      SELECT DISTINCT
        cs.student_id,
        cs.class_id,
        c.class_name,
        c.level_tag AS class_level_tag,
        u.full_name,
        TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM') AS month_key
      FROM classstudentstbl cs
      INNER JOIN classestbl c ON cs.class_id = c.class_id ${calendarBranchJoin}
      INNER JOIN userstbl u ON u.user_id = cs.student_id AND u.user_type = 'Student'
      WHERE cs.program_enrollment_status = 'dropped'
        AND cs.removed_at IS NOT NULL
        AND COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
        AND (
          (cs.enrolled_at IS NOT NULL AND cs.enrolled_at < cs.removed_at)
          OR (
            cs.enrolled_at IS NULL
            AND COALESCE(cs.enrolled_by, '') ILIKE '%Drop marker%'
          )
        )
        AND TIMEZONE('Asia/Manila', cs.removed_at)::date >= $1::date
        AND TIMEZONE('Asia/Manila', cs.removed_at)::date < $2::date
        ${calendarProgramJoin}
        ${calendarClassJoin}
    `,
    calendarOverlayParams
  );

  for (const row of droppedCalendarResult.rows || []) {
    const studentId = parseInt(row.student_id, 10);
    const classId = parseInt(row.class_id, 10);
    const monthKey = row.month_key;
    if (!displayMonthKeys.has(monthKey)) continue;

    const student = ensureMatrixStudent(studentId, classId, row.full_name, row.class_name);
    student.months[monthKey] = {
      mark: '-',
      label: 'dropped/unenrolled',
      status: 'dropped',
      calendar_dropped: true,
      is_full_payment: Boolean(student.months[monthKey]?.is_full_payment),
    };
  }

  // Orphan installment (paid downpayment, no profile): class-start month = first "new".
  const installmentStartParams = [];
  const {
    branchJoin: installmentStartBranchJoin,
    programJoin: installmentStartProgramJoin,
    classJoin: installmentStartClassJoin,
  } = buildScopeJoins(1, installmentStartParams);

  const installmentStartResult = await queryFn(
    `
      SELECT DISTINCT
        cs.student_id,
        cs.class_id,
        c.class_name,
        c.level_tag AS class_level_tag,
        u.full_name,
        TO_CHAR(
          DATE_TRUNC('month', TIMEZONE('Asia/Manila', c.start_date))::date,
          'YYYY-MM'
        ) AS month_key
      FROM classstudentstbl cs
      INNER JOIN classestbl c ON cs.class_id = c.class_id ${installmentStartBranchJoin}
      INNER JOIN userstbl u ON u.user_id = cs.student_id AND u.user_type = 'Student'
      INNER JOIN invoicestudentstbl ist ON ist.student_id = cs.student_id
      INNER JOIN invoicestbl i ON i.invoice_id = ist.invoice_id
      WHERE cs.removed_at IS NULL
        AND cs.program_enrollment_status IN ${ENROLLED_STATUSES}
        AND c.start_date IS NOT NULL
        AND i.status = 'Paid'
        AND i.invoice_description ILIKE '%downpayment%'
        AND i.remarks ILIKE ('%CLASS_ID:' || cs.class_id::text || '%')
        AND NOT EXISTS (
          SELECT 1
          FROM installmentinvoiceprofilestbl ip
          WHERE ip.student_id = cs.student_id
            AND ip.class_id = cs.class_id
        )
        ${installmentStartProgramJoin}
        ${installmentStartClassJoin}
    `,
    installmentStartParams
  );

  for (const row of installmentStartResult.rows || []) {
    const studentId = parseInt(row.student_id, 10);
    const classId = parseInt(row.class_id, 10);
    const monthKey = row.month_key;
    if (!displayMonthKeys.has(monthKey)) continue;

    const student = ensureMatrixStudent(studentId, classId, row.full_name, row.class_name);
    student.months[monthKey] = {
      mark: '1',
      label: 'new',
      status: 'new',
      calendar_installment_start: true,
      is_full_payment: false,
    };
    if (!student.first_enrolled_month_key || monthKey < student.first_enrolled_month_key) {
      student.first_enrolled_month_key = monthKey;
    }
  }

  // Rejoin by enrolled_at calendar month (matches operational dashboard).
  const rejoinCalendarResult = await queryFn(
    `
      SELECT DISTINCT
        cs.student_id,
        cs.class_id,
        c.class_name,
        c.level_tag AS class_level_tag,
        u.full_name,
        TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM') AS month_key
      FROM classstudentstbl cs
      INNER JOIN classestbl c ON cs.class_id = c.class_id ${calendarBranchJoin}
      INNER JOIN userstbl u ON u.user_id = cs.student_id AND u.user_type = 'Student'
      WHERE cs.program_enrollment_status = 'rejoin'
        AND cs.enrolled_at IS NOT NULL
        AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date >= $1::date
        AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date < $2::date
        ${calendarProgramJoin}
        ${calendarClassJoin}
    `,
    calendarOverlayParams
  );

  for (const row of rejoinCalendarResult.rows || []) {
    const studentId = parseInt(row.student_id, 10);
    const classId = parseInt(row.class_id, 10);
    const monthKey = row.month_key;
    if (!displayMonthKeys.has(monthKey)) continue;

    const student = ensureMatrixStudent(studentId, classId, row.full_name, row.class_name);
    const firstEverMonthKey = toManilaMonthKey(student.first_enrolled_at);
    // First calendar month in the program should stay "new", not "rejoin".
    if (firstEverMonthKey && monthKey === firstEverMonthKey) continue;

    student.months[monthKey] = {
      mark: '1',
      label: 'rejoin',
      status: 'rejoin',
      calendar_rejoin: true,
      is_full_payment: Boolean(student.months[monthKey]?.is_full_payment),
    };
  }

  // Upsell by enrolled_at calendar month — first month in a higher program after completing lower.
  const upsellCalendarResult = await queryFn(
    `
      SELECT DISTINCT
        cs.student_id,
        cs.class_id,
        c.class_name,
        c.level_tag AS class_level_tag,
        u.full_name,
        TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM') AS month_key
      FROM classstudentstbl cs
      INNER JOIN classestbl c ON cs.class_id = c.class_id ${calendarBranchJoin}
      INNER JOIN userstbl u ON u.user_id = cs.student_id AND u.user_type = 'Student'
      WHERE cs.program_enrollment_status = 'upsell'
        AND COALESCE(cs.phase_number, 1) = 1
        AND cs.enrolled_at IS NOT NULL
        AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date >= $1::date
        AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date < $2::date
        ${calendarProgramJoin}
        ${calendarClassJoin}
    `,
    calendarOverlayParams
  );

  for (const row of upsellCalendarResult.rows || []) {
    const studentId = parseInt(row.student_id, 10);
    const classId = parseInt(row.class_id, 10);
    const monthKey = row.month_key;
    if (!displayMonthKeys.has(monthKey)) continue;

    const student = ensureMatrixStudent(
      studentId,
      classId,
      row.full_name,
      row.class_name,
      row.class_level_tag
    );
    student.months[monthKey] = {
      mark: '1',
      label: 'upsell',
      status: 'upsell',
      calendar_upsell: true,
      is_full_payment: Boolean(student.months[monthKey]?.is_full_payment),
    };
    if (!student.first_enrolled_month_key || monthKey < student.first_enrolled_month_key) {
      student.first_enrolled_month_key = monthKey;
    }
  }

  // New by enrolled_at calendar month — applied last so it wins over billing-month dropped.
  // Phase 1 only: installment phase 2+ rows are often stored as status 'new' when paid but are
  // continuations; those stay on billing-month logic and display as re-enrolled.
  const newCalendarResult = await queryFn(
    `
      SELECT DISTINCT
        cs.student_id,
        cs.class_id,
        c.class_name,
        c.level_tag AS class_level_tag,
        u.full_name,
        TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM') AS month_key
      FROM classstudentstbl cs
      INNER JOIN classestbl c ON cs.class_id = c.class_id ${calendarBranchJoin}
      INNER JOIN userstbl u ON u.user_id = cs.student_id AND u.user_type = 'Student'
      WHERE cs.program_enrollment_status = 'new'
        AND COALESCE(cs.phase_number, 1) = 1
        AND cs.enrolled_at IS NOT NULL
        AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date >= $1::date
        AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date < $2::date
        ${calendarProgramJoin}
        ${calendarClassJoin}
    `,
    calendarOverlayParams
  );

  for (const row of newCalendarResult.rows || []) {
    const studentId = parseInt(row.student_id, 10);
    const classId = parseInt(row.class_id, 10);
    const monthKey = row.month_key;
    if (!displayMonthKeys.has(monthKey)) continue;

    const student = ensureMatrixStudent(
      studentId,
      classId,
      row.full_name,
      row.class_name,
      row.class_level_tag
    );
    const trackKey = enrollmentTrackKey(studentId, classId);
    const firstBillingKey =
      student.first_enrolled_month_key || firstEnrolledByTrack.get(trackKey) || null;
    const firstEverMonthKey = toManilaMonthKey(student.first_enrolled_at);

    if (student.months[monthKey]?.status === 'upsell') {
      continue;
    }

    // Phase 1 activated after downpayment/class-start month → continuation month.
    if (
      firstBillingKey &&
      firstEverMonthKey &&
      monthKey === firstEverMonthKey &&
      monthKey > firstBillingKey
    ) {
      student.months[monthKey] = {
        mark: '1',
        label: 're-enrolled',
        status: 're_enrolled',
        calendar_continuation: true,
        is_full_payment: Boolean(student.months[monthKey]?.is_full_payment),
      };
      continue;
    }

    const canonicalNewKey = resolveCanonicalFirstNewMonthKey(firstBillingKey, firstEverMonthKey);
    if (canonicalNewKey && monthKey !== canonicalNewKey) continue;

    student.months[monthKey] = {
      mark: '1',
      label: 'new',
      status: 'new',
      calendar_new: true,
      is_full_payment: Boolean(student.months[monthKey]?.is_full_payment),
    };

    if (!student.first_enrolled_month_key || monthKey < student.first_enrolled_month_key) {
      student.first_enrolled_month_key = monthKey;
    }
  }

  const siblingTracksByStudent = await loadUpsellSiblingTracksForMonthMatrix(
    queryFn,
    studentMap,
    {
      branchId,
      queryFromMonthStart,
      toMonthStart,
      fromMonthStart,
      firstEnrolledByTrack,
      firstEnrolledAtByTrack,
      lastFullPayMonthByTrack,
    }
  );

  const cohortTracks = sortEnrollmentMatrixStudents(Array.from(studentMap.values()));
  const allTracks = [...cohortTracks];
  for (const siblingTracks of siblingTracksByStudent.values()) {
    for (const sibling of siblingTracks) {
      if (!allTracks.some((t) => t.enrollment_track_key === sibling.enrollment_track_key)) {
        allTracks.push(sibling);
      }
    }
  }

  const students = applyMatrixTrackDisplayNames(
    sortEnrollmentMatrixStudents(allTracks)
  );

  // Display-only:
  // - "new" only on first enrolled month; later DB "new" → "re-enrolled"
  for (const student of students) {
    const firstEverKey = toManilaMonthKey(student.first_enrolled_at);
    const firstBillingKey = student.first_enrolled_month_key || null;
    const firstEnrolledKey =
      resolveCanonicalFirstNewMonthKey(firstBillingKey, firstEverKey) ||
      months.reduce((first, m) => {
        const cell = student.months?.[m.key];
        if (cell?.mark === '1') return first ?? m.key;
        return first;
      }, null);

    if (!firstEnrolledKey) continue;

    for (const m of months) {
      const cell = student.months?.[m.key];
      if (!cell || cell.mark !== '1') continue;
      if (cell.status === 'upsell' && m.key === firstEnrolledKey) {
        cell.label = 'upsell';
      } else if (cell.status === 'new' && m.key !== firstEnrolledKey) {
        cell.label = 're-enrolled';
      } else if (cell.status === 're_enrolled' || cell.calendar_continuation) {
        cell.label = 're-enrolled';
      }
    }
  }

  applyUpsellMatrixDisplayRules(students, {
    periodKey: 'months',
    siblingTracksByStudent,
    displayMonthKeys,
  });

  // Full-payment: final package billing month → "completed" (non-merged tracks only;
  // merged upsell anchors are handled during applyUpsellMonthMatrixSameRowRules).
  for (const student of students) {
    if (student.matrix_merged_upsell_anchor) continue;

    const firstEverKey = toManilaMonthKey(student.first_enrolled_at);
    const firstBillingKey = student.first_enrolled_month_key || null;
    const firstEnrolledKey =
      resolveCanonicalFirstNewMonthKey(firstBillingKey, firstEverKey) ||
      months.reduce((first, m) => {
        const cell = student.months?.[m.key];
        if (cell?.mark === '1') return first ?? m.key;
        return first;
      }, null);

    if (!firstEnrolledKey) continue;

    const lastFullPayMonthKey = student.last_full_pay_month_key || null;
    if (
      lastFullPayMonthKey &&
      lastFullPayMonthKey > firstEnrolledKey &&
      displayMonthKeys.has(lastFullPayMonthKey)
    ) {
      const lastCell = student.months[lastFullPayMonthKey];
      if (lastCell?.mark === '1') {
        lastCell.label = 'completed';
        lastCell.status = 'completed';
      }
    }
  }

  const visibleStudents = filterHiddenMatrixTracks(students);
  const cohortSize = visibleStudents.length;

  const reEnrollmentStats = computeReEnrollmentMonthStats(months, visibleStudents, {
    selectedYear,
  });

  return {
    months,
    students: visibleStudents,
    month_stats: reEnrollmentStats.month_stats,
    cohort_size: cohortSize,
    total_re_enrolled_count: reEnrollmentStats.total_re_enrolled_count,
    total_prior_month_enrolled_count: reEnrollmentStats.total_prior_month_enrolled_count,
    total_re_enrollment_rate: reEnrollmentStats.total_re_enrollment_rate,
    from_month: fromYM,
    to_month: toYM,
    selected_year: selectedYear,
  };
};

/**
 * Count matrix cell labels for one display month (after calendar overlays + display rules).
 * Matches visible cells on the Month Re-enrollment matrix table.
 */
export const countMonthMatrixStatusLabels = (students, monthKey) => {
  let newEnrolleesCount = 0;
  let reEnrollmentCount = 0;
  let droppedUnenrolledCount = 0;
  let rejoinCount = 0;

  for (const student of students) {
    const cell = student.months?.[monthKey];
    if (!cell?.label) continue;

    switch (cell.label) {
      case 'new':
        newEnrolleesCount += 1;
        break;
      case 're-enrolled':
      case 'upsell':
        reEnrollmentCount += 1;
        break;
      case 'dropped/unenrolled':
        droppedUnenrolledCount += 1;
        break;
      case 'rejoin':
        rejoinCount += 1;
        break;
      default:
        break;
    }
  }

  return {
    new_enrollees_count: newEnrolleesCount,
    re_enrollment_count: reEnrollmentCount,
    dropped_unenrolled_count: droppedUnenrolledCount,
    rejoin_count: rejoinCount,
  };
};

/**
 * Month matrix KPIs for the monthly operational dashboard — one matrix load, same rules as
 * the Month Re-enrollment matrix (including calendar overlays for new / dropped / rejoin).
 */
export const loadMonthMatrixOperationalStatsForMonth = async (queryFn, options = {}) => {
  const { branchId = null, programId = null, classId = null, monthKey } = options;
  if (!monthKey || !/^\d{4}-\d{2}$/.test(String(monthKey))) {
    throw new Error('monthKey must be YYYY-MM');
  }

  const year = parseInt(String(monthKey).slice(0, 4), 10);
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    branchId,
    programId,
    classId,
    year,
  });

  const monthRateStat =
    (matrix.month_stats || []).find((row) => row.month_key === monthKey) || null;
  const statusCounts = countMonthMatrixStatusLabels(matrix.students || [], monthKey);

  return {
    month_key: monthKey,
    ...statusCounts,
    re_enrollment_rate_retained_count: monthRateStat?.re_enrolled_count ?? 0,
    re_enrollment_rate_prior_count: monthRateStat?.prior_month_enrolled_count ?? 0,
    re_enrollment_rate: monthRateStat?.re_enrollment_rate ?? null,
    has_prior_month: Boolean(monthRateStat?.has_prior_month),
  };
};

/** @deprecated Use loadMonthMatrixOperationalStatsForMonth */
export const loadMonthReEnrollmentStatForMonth = loadMonthMatrixOperationalStatsForMonth;
