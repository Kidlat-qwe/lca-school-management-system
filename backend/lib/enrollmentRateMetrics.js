/**
 * Enrollment rate by phase and enrollment dashboard snapshot metrics.
 * Used by GET /dashboard/enrollment and daily/monthly operational dashboards.
 */

import { levelTagIndex } from '../utils/enrollmentStatus.js';
import { todayYmdManila } from '../utils/dateUtils.js';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when both dates are valid YYYY-MM-DD and `ymd` falls strictly before `otherYmd`. */
const isYmdBefore = (ymd, otherYmd) => {
  const left = String(ymd || '').slice(0, 10);
  const right = String(otherYmd || '').slice(0, 10);
  if (!YMD_RE.test(left) || !YMD_RE.test(right)) return false;
  return left < right;
};

const ENROLLED_STATUSES = "('new', 're_enrolled', 'upsell', 'rejoin', 'completed')";
const ACTIVE_PROGRAM_STATUSES = "('new', 're_enrolled', 'upsell', 'rejoin')";
const ENROLLED_STATUSES_LIST = ['new', 're_enrolled', 'upsell', 'rejoin', 'completed'];

/** Billing anchor: earliest enrolled-status phase (new/re_enrolled/…).
 * Includes historical rows with removed_at set after a later drop so Feb/Mar
 * billing months still resolve when the student is already dropped. */
const MATRIX_BILLING_ANCHOR_ACTIVE_WHERE = `
  AND program_enrollment_status IN ${ENROLLED_STATUSES}
`;

/**
 * Installment phase billing month from anchor phase + enrolled_at month, floored at class
 * start month. Early first payment (e.g. June) before class start (July) → phase 1 in July.
 */
const INSTALLMENT_BILLING_MONTH_FROM_ANCHOR_SQL = `
  (
    GREATEST(
      a.base_month,
      CASE
        WHEN sr.class_start_date IS NOT NULL THEN
          DATE_TRUNC('month', TIMEZONE('Asia/Manila', sr.class_start_date))::date
        ELSE a.base_month
      END
    ) + ((sr.phase_number - a.base_phase)::int * INTERVAL '1 month')
  )::date`;

/** Latest installment profile phase_start for matrix row (NULL when no profile). */
const INSTALLMENT_PROFILE_PHASE_START_SUBQUERY = `
  (
    SELECT NULLIF(ip.phase_start, 0)
    FROM installmentinvoiceprofilestbl ip
    WHERE ip.student_id = cs.student_id
      AND ip.class_id = cs.class_id
    ORDER BY ip.installmentinvoiceprofiles_id DESC
    LIMIT 1
  )`;

/** Latest installment profile total_phases for matrix row (0 when no profile). */
const INSTALLMENT_PROFILE_TOTAL_PHASES_SUBQUERY = `
  (
    SELECT COALESCE(NULLIF(ip.total_phases, 0), 0)
    FROM installmentinvoiceprofilestbl ip
    WHERE ip.student_id = cs.student_id
      AND ip.class_id = cs.class_id
    ORDER BY ip.installmentinvoiceprofiles_id DESC
    LIMIT 1
  )`;

/** Dropped rows below installment package phase_start are orphan repair artifacts — omit from matrix. */
const MATRIX_EXCLUDE_ORPHAN_DROPPED_BELOW_PHASE_START_SQL = `
  AND NOT (
    cs.program_enrollment_status = 'dropped'
    AND COALESCE(cs.phase_number, 1) < COALESCE(${INSTALLMENT_PROFILE_PHASE_START_SUBQUERY}, 1)
  )`;

/**
 * Installment plans with phase_start > 1: omit class phases before the plan start
 * (e.g. legacy phase 1 row when the student begins at phase 2).
 */
const MATRIX_EXCLUDE_INSTALLMENT_PRE_START_PHASE_ROWS_SQL = `
  AND NOT (
    COALESCE(cs.phase_number, 1) < COALESCE(${INSTALLMENT_PROFILE_PHASE_START_SUBQUERY}, 1)
    AND EXISTS (
      SELECT 1
      FROM installmentinvoiceprofilestbl ip
      WHERE ip.student_id = cs.student_id
        AND ip.class_id = cs.class_id
    )
  )`;

const MATRIX_EXCLUDE_INSTALLMENT_PHASE_START_SQL = `
  ${MATRIX_EXCLUDE_ORPHAN_DROPPED_BELOW_PHASE_START_SQL}
  ${MATRIX_EXCLUDE_INSTALLMENT_PRE_START_PHASE_ROWS_SQL}`;

/** Installment profiles included in matrix/lifecycle (active or with generated invoice history). */
const INSTALLMENT_PROFILE_MATRIX_VISIBILITY_SQL = (lifecycleScope) =>
  lifecycleScope
    ? `AND (
        COALESCE(ip.is_active, true) = true
        OR COALESCE(ip.generated_count, 0) > 0
      )`
    : `AND COALESCE(ip.is_active, true) = true`;

/**
 * Billing class ids per student for installment plans (includes inactive profiles with history).
 * Used to skip calendar overlays on profile classes and link display-class rows.
 */
const loadInstallmentProfileBillingClassMap = async (queryFn, studentIds = []) => {
  const map = new Map();
  if (!studentIds.length) return map;

  const result = await queryFn(
    `
      SELECT ip.student_id, ip.class_id
      FROM installmentinvoiceprofilestbl ip
      WHERE ip.student_id = ANY($1::int[])
        AND (
          COALESCE(ip.is_active, true) = true
          OR COALESCE(ip.generated_count, 0) > 0
        )
    `,
    [studentIds]
  );

  for (const row of result.rows || []) {
    const studentId = parseInt(row.student_id, 10);
    const classId = parseInt(row.class_id, 10);
    if (!Number.isFinite(studentId) || !Number.isFinite(classId)) continue;
    if (!map.has(studentId)) map.set(studentId, new Set());
    map.get(studentId).add(classId);
  }
  return map;
};

const copyInstallmentBillingMonthsOntoTrack = (displayTrack, billingTrack, monthKeys) => {
  if (!displayTrack?.months || !billingTrack?.months) return;
  for (const monthKey of monthKeys) {
    const billingCell = billingTrack.months[monthKey];
    if (!billingCell) continue;
    const hasBillingLabel =
      billingCell.mark === '1' ||
      billingCell.status === 'dropped' ||
      billingCell.label === 'dropped/unenrolled' ||
      billingCell.label === 'dropped';
    if (!hasBillingLabel) continue;
    displayTrack.months[monthKey] = {
      ...billingCell,
      matrix_billing_from_class_id: billingTrack.class_id,
    };
  }
  if (billingTrack.first_enrolled_month_key) {
    displayTrack.first_enrolled_month_key = billingTrack.first_enrolled_month_key;
  }
  if (billingTrack.first_enrolled_at) {
    displayTrack.first_enrolled_at = billingTrack.first_enrolled_at;
  }
};

const billingTrackHasMatrixMonthCell = (track, monthKey) => {
  const cell = track?.months?.[monthKey];
  if (!cell) return false;
  if (isDroppedMonthMatrixCell(cell)) return true;
  return (
    cell.mark === '1' &&
    ENROLLED_STATUSES_LIST.includes(String(cell?.status || '').toLowerCase())
  );
};

/**
 * (e.g. auto-enroll on teacher class), copy billing-month cells onto the display row.
 */
const applyInstallmentCrossClassDisplayMatrixLink = (students, profileBillingClassByStudent) => {
  if (!profileBillingClassByStudent?.size) return;

  const trackByKey = new Map(
    (students || []).map((track) => [track.enrollment_track_key, track])
  );

  for (const [studentId, billingClassIds] of profileBillingClassByStudent) {
    for (const billingClassId of billingClassIds) {
      const billingTrack = trackByKey.get(enrollmentTrackKey(studentId, billingClassId));
      if (!billingTrack) continue;

      for (const track of students) {
        if (track.student_id !== studentId) continue;
        if (track.class_id === billingClassId) continue;
        if (track.hide_from_matrix) continue;
        // Full-payment short courses (e.g. ACC) are independent enrollments — never
        // proxy installment billing from another class onto them.
        if (trackIsFullPaymentEnrollment(track)) continue;
        // Two installment billing classes for the same student are separate matrix rows.
        if (billingClassIds.has(track.class_id)) continue;

        const hasDisplayEnrollment = Object.values(track.months || {}).some(
          (cell) =>
            cell?.mark === '1' &&
            ['new', 're_enrolled', 'upsell', 'rejoin', 'completed'].includes(
              String(cell?.status || '').toLowerCase()
            )
        );
        if (!hasDisplayEnrollment) continue;

        track.matrix_installment_class_id = billingClassId;
        const monthKeys = new Set([
          ...Object.keys(billingTrack.months || {}),
          ...Object.keys(track.months || {}),
        ]);
        copyInstallmentBillingMonthsOntoTrack(track, billingTrack, monthKeys);

        for (const monthKey of Object.keys(track.months || {})) {
          const cell = track.months[monthKey];
          if (cell?.matrix_billing_from_class_id != null) continue;
          if (
            cell?.mark === '1' &&
            ENROLLED_STATUSES_LIST.includes(String(cell?.status || '').toLowerCase()) &&
            !billingTrackHasMatrixMonthCell(billingTrack, monthKey)
          ) {
            delete track.months[monthKey];
          }
        }

        billingTrack.hide_from_matrix = true;
        billingTrack.matrix_merged_into_anchor = track.enrollment_track_key;
      }
    }
  }
};

/** Dashboard "reserved" from reservedstudentstbl only after the reservation fee is paid. */
const RESERVATION_FEE_PAID_SQL = `(
  r.status = 'Fee Paid'
  OR r.reservation_fee_paid_at IS NOT NULL
  OR (
    r.invoice_id IS NOT NULL
    AND COALESCE(inv.status, '') IN ('Paid', 'Partially Paid')
  )
)`;

/** Scope classes by primary or associated teacher (classteacherstbl). */
const appendClassTeacherScope = (teacherId, paramIdx, targetParams) => {
  if (!teacherId) {
    return { sql: '', nextIdx: paramIdx };
  }
  const sql = `AND (
    c.teacher_id = $${paramIdx}
    OR EXISTS (
      SELECT 1 FROM classteacherstbl ct
      WHERE ct.class_id = c.class_id
        AND ct.teacher_id = $${paramIdx}
    )
  )`;
  targetParams.push(teacherId);
  return { sql, nextIdx: paramIdx + 1 };
};

/**
 * Phase-matrix cell display.
 * Drop flow keeps paid phases as new/re_enrolled/... with removed_at set (historical);
 * only the drop-marker row uses status "dropped". removed_at alone must not imply dropped.
 */
const MATRIX_ACTIVE_NON_ENROLLED_STATUSES = new Set(['reserved', 'pending_enrollment']);

const matrixCellPhaseNumber = (value, fallback = null) => {
  const parsed = parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const fb = parseInt(fallback, 10);
  return Number.isFinite(fb) && fb > 0 ? fb : null;
};

const buildPhaseMatrixCell = (status, removedAt, normalizeLabel) => {
  const programStatus = status || null;
  if (programStatus && ENROLLED_STATUSES_LIST.includes(programStatus)) {
    return {
      mark: '1',
      label: normalizeLabel(programStatus),
      status: programStatus,
    };
  }
  if (programStatus && MATRIX_ACTIVE_NON_ENROLLED_STATUSES.has(programStatus)) {
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
    mark: programStatus ? '1' : '-',
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
  classNumberOfPhase = null,
  installmentPlanTotalPhases = null,
  installmentPackageComplete = false,
  packageCompleteMonthKey = null,
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
    class_number_of_phase:
      classNumberOfPhase != null ? parseInt(classNumberOfPhase, 10) || 1 : null,
    installment_plan_total_phases:
      installmentPlanTotalPhases != null
        ? parseInt(installmentPlanTotalPhases, 10) || 0
        : null,
    installment_package_complete: Boolean(installmentPackageComplete),
    package_complete_month_key: packageCompleteMonthKey || null,
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

/**
 * True when the enrollment cell was soft-removed on or before this billing month
 * (Asia/Manila). Used to stop mid-month unenrolls from counting as Active
 * (e.g. Zion Capalad Playgroup class 151 removed Jul 23 while July still showed "new").
 * Historical months before removal keep their enrolled badges.
 */
const isMatrixCellRemovedOnOrBeforeBillingMonth = (cell, monthKey) => {
  if (!cell?.removed_at || !monthKey) return false;
  const removedMonthKey = toManilaMonthKey(cell.removed_at);
  if (!removedMonthKey) return false;
  return removedMonthKey <= String(monthKey).slice(0, 7);
};

/**
 * Clear enrolled-status badges for billing months on/after soft-removal.
 * Does not alter explicit dropped markers. Runs before payment-lifecycle overlay
 * so Active/Inactive is not anchored on a removed "new"/"re-enrolled" cell.
 */
const clearEnrolledMatrixCellsRemovedOnOrBeforeBillingMonth = (students, periods, periodKey = 'months') => {
  for (const student of students || []) {
    const bucket = periodKey === 'months' ? student.months : student.phases;
    if (!bucket) continue;
    for (const period of periods || []) {
      const cell = bucket[period.key];
      if (!cell || cell.mark !== '1') continue;
      if (cell.payment_lifecycle) continue;
      const status = String(cell.status || '').toLowerCase();
      if (!ENROLLED_STATUSES_LIST.includes(status)) continue;
      if (!isMatrixCellRemovedOnOrBeforeBillingMonth(cell, period.key)) continue;
      cell.mark = '-';
      cell.label = null;
      cell.cleared_after_removal = true;
    }
  }
};


/** Earliest month that should display as "new" (billing anchor vs first enrolled_at). */
const resolveCanonicalFirstNewMonthKey = (firstBillingKey, firstEverMonthKey) => {
  if (firstBillingKey && firstEverMonthKey) {
    if (firstBillingKey > firstEverMonthKey) {
      return firstBillingKey;
    }
    return firstBillingKey <= firstEverMonthKey ? firstBillingKey : firstEverMonthKey;
  }
  return firstBillingKey || firstEverMonthKey || null;
};

/**
 * First enrolled month for rate cohort rules — aligned with matrix display
 * (billing anchor vs enrolled_at), not billing month alone.
 */
const resolveMatrixCanonicalFirstEnrolledMonthKey = (student, displayMonths = []) => {
  const firstEverKey = toManilaMonthKey(student.first_enrolled_at);
  const firstBillingKey = student.first_enrolled_month_key || null;
  const canonical = resolveCanonicalFirstNewMonthKey(firstBillingKey, firstEverKey);
  if (canonical) return canonical;

  for (const month of displayMonths) {
    const cell = student.months?.[month.key];
    if (cell?.mark === '1') return month.key;
  }

  return firstBillingKey;
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
  if (track.package_complete_month_key) return track.package_complete_month_key;
  const lfp = track.last_full_pay_month_key;
  if (lfp && cells[lfp]?.mark === '1') return lfp;
  return null;
};

const isDroppedMonthMatrixCell = (cell) =>
  String(cell?.status || '').toLowerCase() === 'dropped' ||
  cell?.label === 'dropped/unenrolled' ||
  cell?.label === 'dropped' ||
  cell?.calendar_dropped === true;

const getMatrixDropAnchorTime = (dropCell) => {
  if (!dropCell) return null;
  const raw = dropCell.removed_at || dropCell.enrolled_at || null;
  if (!raw) return null;
  const t = new Date(raw);
  return Number.isNaN(t.getTime()) ? null : t;
};

/**
 * True comeback after a drop — rejoin, or enrolled row created after the drop timestamp.
 * Stale pre-drop enrollment rows (e.g. phase 3 re_enrolled before drop at phase 2) are excluded.
 */
const isValidMatrixComebackAfterDrop = (cell, dropCell) => {
  if (!cell || cell.mark !== '1') return false;
  const status = String(cell.status || '').toLowerCase();
  if (status === 'rejoin' || cell.label === 'rejoin') return true;
  if (!ENROLLED_STATUSES_LIST.includes(status)) return false;
  if (cell.removed_at) return false;
  const dropAt = getMatrixDropAnchorTime(dropCell);
  const enrollAt = cell.enrolled_at ? new Date(cell.enrolled_at) : null;
  if (dropAt && enrollAt && !Number.isNaN(enrollAt.getTime())) {
    return enrollAt > dropAt;
  }
  return false;
};

const isActiveMonthMatrixCell = (cell) =>
  cell?.mark === '1' &&
  ENROLLED_STATUSES_LIST.includes(String(cell?.status || '').toLowerCase());

/**
 * Installment delinquency drop → pay/rejoin on a later phase:
 * keep the dropped billing month, leave intermediate months blank ("-"),
 * and keep the real comeback month as rejoin (do not invent gap rejoins or
 * rename the comeback rejoin to re-enrolled).
 */
const applyDropRejoinGapMonthMatrixRules = (students, displayMonths) => {
  const monthKeys = displayMonths.map((m) => m.key);

  for (const student of students) {
    if (!student.months) continue;
    if (student.matrix_installment_class_id != null) continue;

    for (const key of monthKeys) {
      const cell = student.months[key];
      if (isDroppedMonthMatrixCell(cell)) {
        cell.label = 'dropped';
        cell.status = 'dropped';
      }
    }

    for (let i = 0; i < monthKeys.length; i += 1) {
      const dropKey = monthKeys[i];
      const dropCell = student.months[dropKey];
      if (!isDroppedMonthMatrixCell(dropCell)) continue;

      let comebackIdx = -1;
      for (let j = i + 1; j < monthKeys.length; j += 1) {
        const cell = student.months[monthKeys[j]];
        if (isValidMatrixComebackAfterDrop(cell, dropCell)) {
          comebackIdx = j;
          break;
        }
        if (isDroppedMonthMatrixCell(cell)) break;
      }
      if (comebackIdx < 0) {
        for (let j = i + 1; j < monthKeys.length; j += 1) {
          const gapKey = monthKeys[j];
          const gapCell = student.months[gapKey];
          if (String(gapCell?.label || '').toLowerCase() === 'inactive') continue;
          if (gapCell?.mark === '1' || isValidMatrixComebackAfterDrop(gapCell, dropCell)) continue;
          student.months[gapKey] = {
            mark: '-',
            label: null,
            status: null,
            phase_number: null,
            matrix_drop_rejoin_cleared: true,
          };
        }
        continue;
      }

      const gapStart = i + 1;
      const gapEnd = comebackIdx - 1;

      // Clear synthetic / intermediate marks between first drop and real comeback.
      if (gapStart <= gapEnd) {
        for (let g = gapStart; g <= gapEnd; g += 1) {
          const gapKey = monthKeys[g];
          const gapCell = student.months[gapKey];
          // Keep lifecycle Inactive on the immediate post-drop month when already set.
          if (g === i + 1 && String(gapCell?.label || '').toLowerCase() === 'inactive') {
            continue;
          }
          // Remove invented rejoins and other enrollment marks in the gap.
          if (
            !gapCell ||
            gapCell.matrix_drop_rejoin_gap ||
            gapCell.mark === '1' ||
            gapCell.label === 'rejoin' ||
            gapCell.status === 'rejoin'
          ) {
            student.months[gapKey] = {
              mark: '-',
              label: null,
              status: null,
              phase_number: null,
              matrix_drop_rejoin_cleared: true,
            };
          }
        }
      }

      const comebackCell = student.months[monthKeys[comebackIdx]];
      if (!comebackCell) continue;

      // Keep the real comeback as rejoin when it is a rejoin (do not rename to re-enrolled).
      if (
        comebackCell.status === 'rejoin' ||
        comebackCell.calendar_rejoin ||
        comebackCell.label === 'rejoin' ||
        comebackCell.matrix_rejoin_shifted
      ) {
        comebackCell.mark = '1';
        comebackCell.label = 'rejoin';
        comebackCell.status = 'rejoin';
        delete comebackCell.matrix_rejoin_shifted;
      }
    }
  }
};

/** Phase-matrix drop/rejoin gap rules (mirrors month matrix; uses enrolled_at vs drop time). */
const applyDropRejoinGapPhaseMatrixRules = (students, phases) => {
  const phaseKeys = phases.map((p) => p.key);

  for (const student of students) {
    if (!student.phases) continue;

    for (const key of phaseKeys) {
      const cell = student.phases[key];
      if (isDroppedMonthMatrixCell(cell)) {
        cell.label = 'dropped';
        cell.status = 'dropped';
      }
    }

    for (let i = 0; i < phaseKeys.length; i += 1) {
      const dropKey = phaseKeys[i];
      const dropCell = student.phases[dropKey];
      if (!isDroppedMonthMatrixCell(dropCell)) continue;

      let comebackIdx = -1;
      for (let j = i + 1; j < phaseKeys.length; j += 1) {
        const cell = student.phases[phaseKeys[j]];
        if (isValidMatrixComebackAfterDrop(cell, dropCell)) {
          comebackIdx = j;
          break;
        }
        if (isDroppedMonthMatrixCell(cell)) break;
      }

      if (comebackIdx < 0) {
        for (let j = i + 1; j < phaseKeys.length; j += 1) {
          const gapKey = phaseKeys[j];
          const gapCell = student.phases[gapKey];
          if (String(gapCell?.label || '').toLowerCase() === 'inactive') continue;
          student.phases[gapKey] = {
            mark: '-',
            label: '',
            status: null,
            phase_number: parseInt(gapKey, 10) || null,
            matrix_drop_rejoin_cleared: true,
          };
        }
        continue;
      }

      const gapStart = i + 1;
      const gapEnd = comebackIdx - 1;
      if (gapStart <= gapEnd) {
        for (let g = gapStart; g <= gapEnd; g += 1) {
          const gapKey = phaseKeys[g];
          const gapCell = student.phases[gapKey];
          if (g === i + 1 && String(gapCell?.label || '').toLowerCase() === 'inactive') {
            continue;
          }
          if (
            !gapCell ||
            gapCell.matrix_drop_rejoin_gap ||
            gapCell.mark === '1' ||
            gapCell.label === 'rejoin' ||
            gapCell.status === 'rejoin'
          ) {
            student.phases[gapKey] = {
              mark: '-',
              label: '',
              status: null,
              phase_number: parseInt(gapKey, 10) || null,
              matrix_drop_rejoin_cleared: true,
            };
          }
        }
      }

      const comebackCell = student.phases[phaseKeys[comebackIdx]];
      if (
        comebackCell &&
        (comebackCell.status === 'rejoin' ||
          comebackCell.label === 'rejoin' ||
          comebackCell.calendar_rejoin)
      ) {
        comebackCell.mark = '1';
        comebackCell.label = 'rejoin';
        comebackCell.status = 'rejoin';
      }
    }
  }
};

/** Inclusive consecutive YYYY-MM keys from first through last. */
const listConsecutiveMonthKeys = (firstKey, lastKey) => {
  if (!firstKey || !lastKey || firstKey > lastKey) return [];
  const keys = [];
  let cur = firstKey;
  for (;;) {
    keys.push(cur);
    if (cur === lastKey) break;
    cur = nextCalendarMonthKey(cur);
  }
  return keys;
};

/**
 * All higher-program billing months for upsell merge indexing (stable across year views).
 * Uses first/last billing metadata so phases0…N map to the same display columns in 2026 vs 2027.
 */
const getHigherTrackMergeBillingMonths = (higher) => {
  const fromCells = Object.keys(higher.months || {})
    .filter((k) => higher.months[k]?.mark === '1')
    .sort();
  const first = higher.first_enrolled_month_key || fromCells[0] || null;
  const last =
    higher.last_full_pay_month_key ||
    findLastEnrolledMonthKey(higher) ||
    fromCells[fromCells.length - 1] ||
    null;
  const consecutive = listConsecutiveMonthKeys(first, last);
  return consecutive.length ? consecutive : fromCells;
};

const trackQualifiesForUpsellMerge = (track) =>
  trackHasEnrolledMonth(track, 'months') ||
  Boolean(track.package_complete_month_key || track.first_enrolled_month_key);

/** Last billing month with any enrolled cell (used for level-up when lower track has no "completed"). */
const findLastEnrolledMonthKey = (track) => {
  const cells = track?.months || {};
  const keys = Object.keys(cells)
    .filter((k) => cells[k]?.mark === '1')
    .sort();
  return keys.length ? keys[keys.length - 1] : null;
};

const trackHasEnrolledMonth = (track, periodKey) =>
  Object.values(track?.[periodKey] || {}).some((cell) => cell?.mark === '1');

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
 * Month matrix upsell: one row per student on the lower-program anchor.
 * Higher-program phases merge sequentially from the month after lower completion:
 * first → upsell, later → re-enrolled (completed on terminal phase). The higher-class
 * row is hidden. Billing-month metadata keeps phase index stable so later year views
 * show continuation months (e.g. Jan–Mar 2027) on the same row.
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

    const enrolledTracks = studentTracks.filter(trackQualifiesForUpsellMerge);
    if (enrolledTracks.length < 2) continue;

    const higherTracks = enrolledTracks
      .filter((t) => levelTagIndex(t.class_level_tag) >= 0)
      .sort(
        (a, b) =>
          levelTagIndex(a.class_level_tag) - levelTagIndex(b.class_level_tag)
      );

    const maxHigherIdx = higherTracks.reduce(
      (max, t) => Math.max(max, levelTagIndex(t.class_level_tag)),
      -1
    );
    if (maxHigherIdx < 0) continue;

    const anchor = enrolledTracks
      .filter((t) => {
        const idx = levelTagIndex(t.class_level_tag);
        if (idx < 0 || idx >= maxHigherIdx) return false;
        if (!trackIsFullPaymentEnrollment(t)) return true;
        // Installment progression (e.g. Nursery → Pre-K) must not anchor on unrelated
        // full-payment Playgroup short courses that happen to share a lower level_tag.
        const hasInstallmentAbove = enrolledTracks.some((other) => {
          if (other.class_id === t.class_id) return false;
          const otherIdx = levelTagIndex(other.class_level_tag);
          return otherIdx > idx && !trackIsFullPaymentEnrollment(other);
        });
        return !hasInstallmentAbove;
      })
      .reduce((best, t) => {
        const idx = levelTagIndex(t.class_level_tag);
        if (!best) return t;
        const bestIdx = levelTagIndex(best.class_level_tag);
        return bestIdx < 0 || idx < bestIdx ? t : best;
      }, null);
    if (!anchor) continue;

    const anchorIdx = levelTagIndex(anchor.class_level_tag);
    // Prefer a completed handoff; fall back to last enrolled month when the lower
    // track ended without "completed" (e.g. dropped, then moved to a higher program).
    const handoffMonthKey =
      findLastCompletedMonthKey(anchor) || findLastEnrolledMonthKey(anchor);
    if (!handoffMonthKey) continue;

    const handoffUpsellMonthKey = nextCalendarMonthKey(handoffMonthKey);

    const higherTracksForMerge = enrolledTracks
      .filter((t) => {
        if (t.class_id === anchor.class_id) return false;
        const idx = levelTagIndex(t.class_level_tag);
        return idx > anchorIdx;
      })
      .sort(
        (a, b) =>
          levelTagIndex(a.class_level_tag) - levelTagIndex(b.class_level_tag)
      );

    if (!higherTracksForMerge.length) continue;

    const hasHigherEnrollment = higherTracksForMerge.some((higher) =>
      trackHasEnrolledMonth(higher, 'months')
    );
    if (!hasHigherEnrollment) continue;

    let upsellPlaced = false;
    const mergedMonthKeys = new Set();
    let higherPhaseIndex = 0;

    for (const higher of higherTracksForMerge) {
      const higherCells = higher.months || {};
      const enrolledBillingMonths = getHigherTrackMergeBillingMonths(higher);
      if (!enrolledBillingMonths.length) continue;

      // Higher program may start later than the month after lower completion
      // (e.g. Nursery completed April, Pre-K starts June — May stays empty).
      const higherFirstBillingMonth =
        enrolledBillingMonths[0] || higher.first_enrolled_month_key || null;
      let displayStartMonthKey = handoffUpsellMonthKey;
      if (
        higherFirstBillingMonth &&
        higherFirstBillingMonth > displayStartMonthKey
      ) {
        displayStartMonthKey = higherFirstBillingMonth;
      }

      const srcBillingMonthToDisplayMonth = new Map();

      for (const srcKey of enrolledBillingMonths) {
        const displayMonth = addCalendarMonthsToKey(
          displayStartMonthKey,
          higherPhaseIndex
        );
        const srcCell = higherCells[srcKey];
        const src = srcCell
          ? { ...srcCell, merged_from_class_id: higher.class_id }
          : {
              mark: '1',
              status: 're_enrolled',
              is_full_payment: trackIsFullPaymentEnrollment(higher),
              merged_from_class_id: higher.class_id,
            };

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
      const primaryHigher = higherTracksForMerge[higherTracksForMerge.length - 1];
      if (primaryHigher?.class_id != null) {
        anchor.matrix_installment_class_id = primaryHigher.class_id;
      }
      let maxMergedHigherPhases = parseInt(anchor.matrix_merged_higher_number_of_phase, 10) || 0;
      for (const higher of higherTracksForMerge) {
        const higherPhases = parseInt(higher.class_number_of_phase, 10) || 0;
        if (higherPhases > maxMergedHigherPhases) maxMergedHigherPhases = higherPhases;
      }
      if (maxMergedHigherPhases > 0) {
        anchor.matrix_merged_higher_number_of_phase = maxMergedHigherPhases;
      }
    }
  }

  return tracks;
};

/**
 * Phase matrix: upsell students stay on their own row (higher program track).
 * First enrolled phase shows "upsell" when a lower program was completed or
 * previously enrolled (including drop-then-level-up).
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

      const hasLowerProgramHistory = studentTracks.some((other) => {
        if (other.class_id === track.class_id) return false;
        const otherIdx = levelTagIndex(other.class_level_tag);
        if (otherIdx < 0 || otherIdx >= curIdx) return false;
        return (
          trackHasCompletedEnrollment(other, 'phases') ||
          trackHasEnrolledMonth(other, 'phases') ||
          Object.values(other.phases || {}).some((cell) =>
            isDroppedMonthMatrixCell(cell)
          )
        );
      });
      if (!hasLowerProgramHistory) continue;

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
 * Month matrix: same row as completed lower program (cross-year continuation).
 * Phase matrix: separate row per upsell track.
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

/** Curriculum phase count for a class (defaults to 1). Scalar subquery avoids join alias clashes. */
const CLASS_NUMBER_OF_PHASE_SQL = `(
  SELECT COALESCE(NULLIF(cu.number_of_phase, 0), 1)
  FROM programstbl cprog
  INNER JOIN curriculumstbl cu ON cu.curriculum_id = cprog.curriculum_id
  WHERE cprog.program_id = c.program_id
)`;

/** All installment phase invoices paid for student + class. */
const INSTALLMENT_PACKAGE_COMPLETE_SQL = `
  EXISTS (
    SELECT 1
    FROM installmentinvoiceprofilestbl ip
    WHERE ip.student_id = cs.student_id
      AND ip.class_id = cs.class_id
      AND COALESCE(ip.total_phases, 0) > 0
      AND (
        SELECT COUNT(DISTINCT CASE
          WHEN i.status = 'Paid' THEN COALESCE(i.invoice_chain_root_id, i.invoice_id)
          ELSE NULL
        END)::integer
        FROM invoicestbl i
        WHERE i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
          AND (
            ip.downpayment_invoice_id IS NULL
            OR COALESCE(i.invoice_chain_root_id, i.invoice_id) <> ip.downpayment_invoice_id::INTEGER
          )
      ) >= COALESCE(ip.total_phases, 0)
  )`;

/**
 * Display-only: mark terminal phase as completed for single-phase classes when paid,
 * or last full-payment phase when the student progressed past the first phase.
 */
const applyPhaseMatrixTerminalCompletedLabel = (student, phases, normalizeStatusLabel) => {
  const firstEnrolledPhase = phases.reduce((min, p) => {
    const cell = student.phases?.[p.key];
    if (cell?.mark === '1') return Math.min(min, p.key);
    return min;
  }, Number.POSITIVE_INFINITY);

  if (!Number.isFinite(firstEnrolledPhase)) return;

  student.first_enrolled_phase = firstEnrolledPhase;

  const classPhases = Math.max(1, parseInt(student.class_number_of_phase, 10) || 1);
  let maxFullPayEnrolledPhase = 0;

  for (const p of phases) {
    const cell = student.phases?.[p.key];
    if (!cell || cell.mark !== '1') continue;
    if (cell.is_full_payment) {
      maxFullPayEnrolledPhase = Math.max(maxFullPayEnrolledPhase, p.key);
    }
    if (cell.status === 'upsell' && p.key === firstEnrolledPhase) {
      cell.label = 'upsell';
    } else if (cell.status === 'reserved') {
      cell.label = normalizeStatusLabel('reserved');
    } else if (cell.status === 'pending_enrollment') {
      cell.label = normalizeStatusLabel('pending_enrollment');
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
      lastCell.status = 'completed';
    }
    return;
  }

  const planPhases = resolveInstallmentPlanTotalPhases(student);
  const singlePhaseTrack = isSinglePhaseEnrollmentTrack(student);

  if (student.installment_package_complete && singlePhaseTrack) {
    const terminalCell = student.phases[firstEnrolledPhase];
    if (terminalCell?.mark === '1') {
      terminalCell.label = 'completed';
      terminalCell.status = 'completed';
    }
    return;
  }

  if (student.installment_package_complete && classPhases > 1 && planPhases !== 1) {
    let maxEnrolledPhase = 0;
    for (const p of phases) {
      const cell = student.phases?.[p.key];
      if (cell?.mark === '1') {
        maxEnrolledPhase = Math.max(maxEnrolledPhase, p.key);
      }
    }
    if (maxEnrolledPhase > firstEnrolledPhase) {
      const terminalCell = student.phases[maxEnrolledPhase];
      if (terminalCell?.mark === '1') {
        terminalCell.label = 'completed';
        terminalCell.status = 'completed';
      }
    }
    return;
  }

  if (!singlePhaseTrack) return;

  const terminalCell = student.phases[firstEnrolledPhase];
  if (terminalCell?.mark !== '1') return;

  const packageFinished =
    terminalCell.status === 'completed' ||
    Boolean(terminalCell.is_full_payment) ||
    Boolean(student.installment_package_complete);

  if (packageFinished) {
    terminalCell.label = 'completed';
    terminalCell.status = 'completed';
  }
};

const resolveInstallmentPlanTotalPhases = (student) => {
  const parsed = parseInt(student?.installment_plan_total_phases, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/** True when the track is a one-phase class or a one-phase installment plan. */
const isSinglePhaseEnrollmentTrack = (student) => {
  const classPhases = Math.max(1, parseInt(student.class_number_of_phase, 10) || 1);
  const planPhases = resolveInstallmentPlanTotalPhases(student);
  return classPhases === 1 || planPhases === 1;
};

/**
 * Mark completed cells on single-phase *classes* (e.g. Active Champs, number_of_phase = 1)
 * so the UI can use a distinct badge color from multi-phase completed.
 * Uses class phase count only — not installment plan length — so a 10-phase class
 * with a short plan is not recolored.
 */
const flagSinglePhaseCompletedCells = (students, periodKey = 'months') => {
  for (const student of students || []) {
    const classPhases = Math.max(1, parseInt(student.class_number_of_phase, 10) || 1);
    if (classPhases !== 1) continue;
    const bucket = student?.[periodKey];
    if (!bucket) continue;
    for (const cell of Object.values(bucket)) {
      if (!cell) continue;
      const label = String(cell.label || '').trim().toLowerCase();
      const status = String(cell.status || '').trim().toLowerCase();
      if (label === 'completed' || status === 'completed') {
        cell.single_phase_completed = true;
      }
    }
  }
};

/** Resolve billing month that should display as completed on the month matrix. */
const resolveTerminalCompletionMonthKey = (student, firstEnrolledKey) => {
  if (!firstEnrolledKey) return null;

  const singlePhaseTrack = isSinglePhaseEnrollmentTrack(student);
  let terminalKey =
    student.package_complete_month_key ||
    student.last_full_pay_month_key ||
    null;

  if (!terminalKey && singlePhaseTrack && student.installment_package_complete) {
    terminalKey = firstEnrolledKey;
  }

  if (!terminalKey) return null;

  const allowSameMonth = singlePhaseTrack;
  if (allowSameMonth ? terminalKey >= firstEnrolledKey : terminalKey > firstEnrolledKey) {
    return terminalKey;
  }
  return null;
};

/**
 * Phase count for completed KPI on upsell-merged anchor rows (lower class metadata
 * may be 1 phase while merged higher-program completion is multi-phase).
 */
const resolveMatrixTrackPhaseCountForCompletionKpi = (student, cell = null) => {
  const mergedHigherPhases = parseInt(student?.matrix_merged_higher_number_of_phase, 10);
  const isMergedUpsellCell =
    student?.matrix_merged_upsell_anchor &&
    (cell?.merged_from_class_id ||
      cell?.display_upsell_merged ||
      cell?.display_upsell_synthetic);
  if (isMergedUpsellCell && Number.isFinite(mergedHigherPhases) && mergedHigherPhases > 0) {
    return mergedHigherPhases;
  }
  return Math.max(1, parseInt(student?.class_number_of_phase, 10) || 1);
};

/**
 * Visible matrix labels that count as prior enrollment history for a later
 * completed cell (numerator and denominator both use this). Upsell alone
 * does not qualify a later completed cell.
 */
const isPriorActiveEnrollmentLabel = (label) => {
  const normalizedLabel = String(label || '').trim().toLowerCase();
  return (
    normalizedLabel === 'new' ||
    normalizedLabel === 're-enrolled' ||
    normalizedLabel === 're_enrolled' ||
    normalizedLabel === 'rejoin'
  );
};

const isVisibleReEnrolledLabel = (label) => {
  const normalizedLabel = String(label || '').trim().toLowerCase();
  return normalizedLabel === 're-enrolled' || normalizedLabel === 're_enrolled';
};

const isVisibleCompletedLabel = (label) =>
  String(label || '').trim().toLowerCase() === 'completed';

/** Payment-lifecycle Active (✓) — counts toward rate numerator as retained. */
const isVisibleActiveLifecycleCell = (cell) => {
  if (!cell) return false;
  const label = String(cell.label || '').trim().toLowerCase();
  const status = String(cell.status || '').trim().toLowerCase();
  return cell.mark === '✓' || label === 'active' || status === 'active';
};

/** Payment-lifecycle Inactive (X) — never counts toward rate numerator. */
const isVisibleInactiveLifecycleCell = (cell) => {
  if (!cell) return false;
  const label = String(cell.label || '').trim().toLowerCase();
  const status = String(cell.status || '').trim().toLowerCase();
  return (
    cell.mark === 'X' ||
    label === 'inactive' ||
    status === 'inactive'
  );
};

/**
 * True when this student already had a visible new, re-enrolled, or rejoin cell in an
 * earlier month/phase than currentKey (same matrix row / track).
 */
const studentHasPriorActiveEnrollmentCell = (student, currentKey, periodCellsAccessor) => {
  const currentKeyStr = String(currentKey);
  const isMonthKey = /^\d{4}-\d{2}$/.test(currentKeyStr);
  const bucket = isMonthKey ? student?.months || {} : student?.phases || {};

  for (const key of Object.keys(bucket)) {
    if (isMonthKey) {
      if (String(key) >= currentKeyStr) continue;
    } else if (!(Number(key) < Number(currentKey))) {
      continue;
    }

    const priorCell = periodCellsAccessor(student, key);
    if (!priorCell?.label || priorCell.mark !== '1') continue;
    if (isPriorActiveEnrollmentLabel(priorCell.label)) return true;
  }

  return false;
};

/**
 * Re-enrollment KPI / purple badge: visible re-enrolled labels only.
 * Completed is handled separately on the Completed card and (conditionally) on the rate numerator.
 */
const matrixLabelCountsTowardReEnrollmentKpi = (label, _student = null, _cell = null) =>
  isVisibleReEnrolledLabel(label);

/**
 * Rate-header numerator:
 * - Always count visible re-enrolled cells.
 * - Count Active (✓) lifecycle cells as retained (same as re-enrolled for the rate).
 * - Never count Inactive (X).
 * - Count completed only when the same student already had a prior new, re-enrolled,
 *   or rejoin cell. Standalone completed (no prior active enrollment) is excluded.
 */
const matrixCellCountsTowardReEnrollmentRate = (
  cell,
  student,
  currentKey = null,
  periodCellsAccessor = null
) => {
  if (!cell?.label) return false;

  // Lifecycle overlays use mark ✓ / X (not "1").
  if (isVisibleInactiveLifecycleCell(cell)) return false;
  if (isVisibleActiveLifecycleCell(cell)) return true;

  if (cell.mark !== '1') return false;

  if (isVisibleReEnrolledLabel(cell.label)) return true;

  if (isVisibleCompletedLabel(cell.label)) {
    if (currentKey == null || typeof periodCellsAccessor !== 'function') return false;
    return studentHasPriorActiveEnrollmentCell(student, currentKey, periodCellsAccessor);
  }

  return false;
};

/** Whether a prior-month/phase cell counts toward the rate header denominator (excluding completed). */
const matrixLabelCountsTowardRateDenominator = (label, cell = null) => {
  const normalizedLabel = String(label || '').trim().toLowerCase();
  const status = String(cell?.status || '').trim().toLowerCase();

  switch (normalizedLabel) {
    case 're-enrolled':
    case 're_enrolled':
    case 'new':
    case 'rejoin':
    case 'upsell':
      return true;
    default:
      break;
  }

  return (
    status === 're_enrolled' ||
    status === 'new' ||
    status === 'rejoin' ||
    status === 'upsell'
  );
};

/**
 * Rate header denominator cell check:
 * - Prior-month/phase cells labeled new, re-enrolled, rejoin, or upsell always count.
 * - completed counts only when that same prior-month completed cell already had an
 *   earlier new, re-enrolled, or rejoin cell on the same student row (same rule as
 *   the numerator's completed-with-history check).
 * - Pending enrollment, reserved, dropped, and standalone completed are excluded.
 */
const matrixCellCountsTowardRateDenominator = (
  cell,
  student,
  priorKey = null,
  periodCellsAccessor = null
) => {
  if (!cell?.label || cell.mark !== '1') return false;

  if (matrixLabelCountsTowardRateDenominator(cell.label, cell)) return true;

  if (isVisibleCompletedLabel(cell.label)) {
    if (priorKey == null || typeof periodCellsAccessor !== 'function') return false;
    return studentHasPriorActiveEnrollmentCell(student, priorKey, periodCellsAccessor);
  }

  return false;
};

const countMatrixRateHeaderDenominator = (
  students,
  prevKey,
  currentPeriodKey,
  periodCellsAccessor,
  firstEnrolledKeyAccessor
) => {
  let count = 0;
  for (const student of students) {
    const firstEnrolledKey = firstEnrolledKeyAccessor(student);
    if (firstEnrolledKey != null && currentPeriodKey === firstEnrolledKey) continue;

    const cell = periodCellsAccessor(student, prevKey);
    if (matrixCellCountsTowardRateDenominator(cell, student, prevKey, periodCellsAccessor)) {
      count += 1;
    }
  }
  return count;
};

/** @deprecated Use countMatrixRateHeaderDenominator for matrix rate rows. */
const countMatrixPriorPeriodEnrolledStudents = (
  students,
  prevKey,
  currentPeriodKey,
  periodCellsAccessor,
  firstEnrolledKeyAccessor = (student) => student.first_enrolled_month_key ?? null
) => {
  let count = 0;
  for (const student of students) {
    const firstEnrolledKey = firstEnrolledKeyAccessor(student);
    if (firstEnrolledKey != null && currentPeriodKey === firstEnrolledKey) continue;

    const wasEnrolledPrev = periodCellsAccessor(student, prevKey)?.mark === '1';
    if (!wasEnrolledPrev) continue;

    count += 1;
  }
  return count;
};

/**
 * Re-enrollment rate header numerator:
 * visible re-enrolled + completed that follow a prior new/re-enrolled on the same row.
 */
const countMatrixRateHeaderNumerator = (students, currentKey, periodCellsAccessor) => {
  let count = 0;
  for (const student of students) {
    const cell = periodCellsAccessor(student, currentKey);
    if (!cell?.label) continue;

    if (matrixCellCountsTowardReEnrollmentRate(cell, student, currentKey, periodCellsAccessor)) {
      count += 1;
    }
  }
  return count;
};

/** Visible month-matrix rate header numerator. */
export const countMonthMatrixRateHeaderNumerator = (students, monthKey) =>
  countMatrixRateHeaderNumerator(
    students,
    monthKey,
    (student, key) => student.months?.[key]
  );

const emptyRateBreakdown = () => ({
  new: 0,
  re_enrolled: 0,
  upsell: 0,
  rejoin: 0,
  completed: 0,
  active: 0,
  total: 0,
});

const countMatrixRateHeaderNumeratorBreakdown = (students, currentKey, periodCellsAccessor) => {
  const breakdown = emptyRateBreakdown();
  for (const student of students) {
    const cell = periodCellsAccessor(student, currentKey);
    if (
      !matrixCellCountsTowardReEnrollmentRate(cell, student, currentKey, periodCellsAccessor)
    ) {
      continue;
    }

    if (isVisibleActiveLifecycleCell(cell)) {
      breakdown.active += 1;
    } else if (isVisibleCompletedLabel(cell.label)) {
      breakdown.completed += 1;
    } else {
      breakdown.re_enrolled += 1;
    }
  }
  breakdown.total = breakdown.re_enrolled + breakdown.completed + breakdown.active;
  return breakdown;
};

const countMatrixRateHeaderDenominatorBreakdown = (
  students,
  prevKey,
  currentPeriodKey,
  periodCellsAccessor,
  firstEnrolledKeyAccessor
) => {
  const breakdown = emptyRateBreakdown();
  for (const student of students) {
    const firstEnrolledKey = firstEnrolledKeyAccessor(student);
    if (firstEnrolledKey != null && currentPeriodKey === firstEnrolledKey) continue;

    const cell = periodCellsAccessor(student, prevKey);
    if (
      !matrixCellCountsTowardRateDenominator(cell, student, prevKey, periodCellsAccessor)
    ) {
      continue;
    }

    const normalizedLabel = String(cell.label || '').trim().toLowerCase();
    const status = String(cell?.status || '').trim().toLowerCase();

    if (isVisibleCompletedLabel(cell.label)) {
      breakdown.completed += 1;
    } else if (normalizedLabel === 'new' || status === 'new') {
      breakdown.new += 1;
    } else if (
      normalizedLabel === 're-enrolled' ||
      normalizedLabel === 're_enrolled' ||
      status === 're_enrolled'
    ) {
      breakdown.re_enrolled += 1;
    } else if (normalizedLabel === 'upsell' || status === 'upsell') {
      breakdown.upsell += 1;
    } else if (normalizedLabel === 'rejoin' || status === 'rejoin') {
      breakdown.rejoin += 1;
    }
  }
  breakdown.total =
    breakdown.new + breakdown.re_enrolled + breakdown.upsell + breakdown.rejoin + breakdown.completed;
  return breakdown;
};

/** Visible month-matrix rate header denominator (prior month active enrollment statuses). */
export const countMonthMatrixRateHeaderDenominator = (
  students,
  prevMonthKey,
  currentMonthKey,
  displayMonths = []
) => {
  const firstMonthKeyAccessor = (student) =>
    resolveMatrixCanonicalFirstEnrolledMonthKey(student, displayMonths);
  return countMatrixRateHeaderDenominator(
    students,
    prevMonthKey,
    currentMonthKey,
    (student, key) => student.months?.[key],
    firstMonthKeyAccessor
  );
};

/**
 * Re-enrollment rate per display month (spreadsheet logic):
 * - Numerator: visible re-enrolled cells, Active (✓) lifecycle cells, and completed
 *   cells that already had a prior new, re-enrolled, or rejoin cell on the same row.
 * - Inactive (X) and standalone completed are excluded from the numerator.
 * - Denominator: prior-month cells labeled new, re-enrolled, rejoin, or upsell, plus
 *   completed cells that already had a prior new/re-enrolled/rejoin cell (same rule
 *   as the numerator). Standalone completed and upsell-preceded completed are excluded.
 */
export const computeReEnrollmentMonthStats = (displayMonths, students, options = {}) => {
  const { selectedYear = null } = options;
  let totalReEnrolled = 0;
  let totalPriorMonthEnrolled = 0;
  const monthCells = (student, monthKey) => student.months?.[monthKey];
  const firstMonthKeyAccessor = (student) =>
    resolveMatrixCanonicalFirstEnrolledMonthKey(student, displayMonths);

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

    const priorMonthEnrolledCount = countMatrixRateHeaderDenominator(
      students,
      prevKey,
      key,
      monthCells,
      firstMonthKeyAccessor
    );
    const reEnrolledCount = countMatrixRateHeaderNumerator(
      students,
      key,
      monthCells
    );
    const numeratorBreakdown = countMatrixRateHeaderNumeratorBreakdown(
      students,
      key,
      monthCells
    );
    const denominatorBreakdown = countMatrixRateHeaderDenominatorBreakdown(
      students,
      prevKey,
      key,
      monthCells,
      firstMonthKeyAccessor
    );
    const priorPeriodLabel =
      index > 0
        ? displayMonths[index - 1].label
        : selectedYear != null
          ? `Dec ${selectedYear - 1}`
          : null;

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
      prior_period_label: priorPeriodLabel,
      numerator_breakdown: numeratorBreakdown,
      denominator_breakdown: denominatorBreakdown,
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
 * Re-enrollment rate per phase (same KPI rules as monthly matrix, by phase):
 * - Numerator: visible re-enrolled, Active (✓), and completed with a prior new/re-enrolled/rejoin.
 * - Denominator: prior-phase cells labeled new, re-enrolled, rejoin, or upsell, plus
 *   completed cells with a prior new/re-enrolled/rejoin cell (same rule as the numerator).
 * - Inactive, standalone completed, and reserved/dropped/pending are excluded.
 * - First phase has no prior (N/A).
 */
export const computeReEnrollmentPhaseStats = (displayPhases, students) => {
  let totalReEnrolled = 0;
  let totalPriorPhaseEnrolled = 0;
  const phaseCells = (student, phaseKey) => student.phases?.[phaseKey];

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
    const priorPhaseEnrolledCount = countMatrixRateHeaderDenominator(
      students,
      prevKey,
      key,
      phaseCells,
      (student) => student.first_enrolled_phase ?? null
    );
    const reEnrolledCount = countMatrixRateHeaderNumerator(
      students,
      key,
      phaseCells
    );
    const numeratorBreakdown = countMatrixRateHeaderNumeratorBreakdown(
      students,
      key,
      phaseCells
    );
    const denominatorBreakdown = countMatrixRateHeaderDenominatorBreakdown(
      students,
      prevKey,
      key,
      phaseCells,
      (student) => student.first_enrolled_phase ?? null
    );
    const priorPeriodLabel = displayPhases[index - 1]?.label ?? null;

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
      prior_period_label: priorPeriodLabel,
      numerator_breakdown: numeratorBreakdown,
      denominator_breakdown: denominatorBreakdown,
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
 * Active reservations with paid reservation fee (for dashboard KPI).
 * Excludes unpaid Reserved, Expired, Cancelled, and Upgraded.
 * @param {Function} queryFn
 * @param {{ branchId?: number|null, classId?: number|null, curriculumId?: number|null }} options
 */
export const loadReservedStudentsCount = async (queryFn, options = {}) => {
  const { branchId = null, classId = null, curriculumId = null } = options;
  const params = [];
  let paramIdx = 1;
  let curriculumJoin = '';
  const filters = [RESERVATION_FEE_PAID_SQL, 'r.expired_at IS NULL'];

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
 * Reservation rows for enrollment matrices — reservation fee must be paid.
 * @returns {Promise<Array<{ student_id, class_id, phase_number, class_name, class_level_tag, full_name, reserved_at }>>}
 */
export const loadActiveReservedMatrixRows = async (queryFn, options = {}) => {
  const {
    branchId = null,
    classId = null,
    curriculumId = null,
    programId = null,
    teacherId = null,
    enrolledFrom = null,
    enrolledTo = null,
  } = options;

  const params = [];
  let paramIdx = 1;
  let curriculumJoin = '';
  const filters = [
    RESERVATION_FEE_PAID_SQL,
    'r.expired_at IS NULL',
    `NOT EXISTS (
      SELECT 1 FROM classstudentstbl cs
      WHERE cs.student_id = r.student_id
        AND cs.class_id = r.class_id
        AND cs.removed_at IS NULL
        AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'completed', 'pending_enrollment')
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
  if (programId) {
    filters.push(`c.program_id = $${paramIdx}`);
    params.push(programId);
    paramIdx += 1;
  }
  if (curriculumId) {
    curriculumJoin = `INNER JOIN programstbl p ON c.program_id = p.program_id AND p.curriculum_id = $${paramIdx}`;
    params.push(curriculumId);
    paramIdx += 1;
  }
  if (teacherId) {
    const teacherScope = appendClassTeacherScope(teacherId, paramIdx, params);
    filters.push(teacherScope.sql.replace(/^AND /, ''));
    paramIdx = teacherScope.nextIdx;
  }
  if (enrolledFrom && enrolledTo) {
    filters.push(
      `COALESCE(r.reservation_fee_paid_at, r.reserved_at) IS NOT NULL
       AND TIMEZONE('Asia/Manila', COALESCE(r.reservation_fee_paid_at, r.reserved_at))::date >= $${paramIdx}::date
       AND TIMEZONE('Asia/Manila', COALESCE(r.reservation_fee_paid_at, r.reserved_at))::date < $${paramIdx + 1}::date`
    );
    params.push(enrolledFrom, enrolledTo);
    paramIdx += 2;
  }

  const result = await queryFn(
    `
      SELECT
        r.student_id,
        r.class_id,
        COALESCE(r.phase_number, 1) AS phase_number,
        COALESCE(r.reservation_fee_paid_at, r.reserved_at) AS reserved_at,
        c.class_name,
        c.level_tag AS class_level_tag,
        u.full_name
      FROM reservedstudentstbl r
      INNER JOIN classestbl c ON r.class_id = c.class_id
      INNER JOIN userstbl u ON u.user_id = r.student_id AND u.user_type = 'Student'
      LEFT JOIN invoicestbl inv ON r.invoice_id = inv.invoice_id
      ${curriculumJoin}
      WHERE ${filters.join(' AND ')}
      ORDER BY r.reserved_at ASC, u.full_name ASC
    `,
    params
  );

  return result.rows || [];
};

/**
 * Tracks where a paid reservation converted to enrollment (upgrade or active phase-1 row).
 * Used to show "Previous reserved" on matrix "new" cells.
 */
export const loadReservationToEnrollmentTrackKeys = async (queryFn, options = {}) => {
  const { branchId = null, programId = null, classId = null, studentIds = [] } = options;
  if (!studentIds.length) return new Set();

  const params = [studentIds];
  let paramIdx = 2;
  const filters = [];
  let programJoin = '';

  if (branchId) {
    filters.push(`(r.branch_id = $${paramIdx} OR c.branch_id = $${paramIdx})`);
    params.push(branchId);
    paramIdx += 1;
  }
  if (programId) {
    programJoin = `INNER JOIN programstbl prog ON c.program_id = prog.program_id`;
    filters.push(`c.program_id = $${paramIdx}`);
    params.push(programId);
    paramIdx += 1;
  }
  if (classId) {
    filters.push(`r.class_id = $${paramIdx}`);
    params.push(classId);
    paramIdx += 1;
  }

  const result = await queryFn(
    `
      SELECT DISTINCT r.student_id, r.class_id
      FROM reservedstudentstbl r
      INNER JOIN classestbl c ON r.class_id = c.class_id
      LEFT JOIN invoicestbl inv ON r.invoice_id = inv.invoice_id
      ${programJoin}
      WHERE r.student_id = ANY($1::int[])
        AND ${RESERVATION_FEE_PAID_SQL}
        AND (
          r.status = 'Upgraded'
          OR EXISTS (
            SELECT 1
            FROM classstudentstbl cs
            WHERE cs.student_id = r.student_id
              AND cs.class_id = r.class_id
              AND cs.removed_at IS NULL
              AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'completed')
              AND COALESCE(cs.phase_number, 1) = 1
          )
        )
        ${filters.length ? `AND ${filters.join(' AND ')}` : ''}
    `,
    params
  );

  return new Set(
    (result.rows || []).map((row) =>
      enrollmentTrackKey(parseInt(row.student_id, 10), parseInt(row.class_id, 10))
    )
  );
};

/** Mark "new" matrix cells that followed a paid reservation on the same class track. */
const applyFromPreviousReservedCellFlags = (students, periodKey, trackKeys) => {
  if (!trackKeys?.size) return;

  for (const student of students) {
    if (!trackKeys.has(student.enrollment_track_key)) continue;
    const cells = student[periodKey] || {};
    for (const cell of Object.values(cells)) {
      if (cell?.label === 'new') {
        cell.from_previous_reserved = true;
      }
    }
  }
};

const trackHasActiveEnrollmentCell = (track, periodKey) => {
  const cells = track?.[periodKey] || {};
  return Object.values(cells).some((cell) => {
    const status = String(cell?.status || '').toLowerCase();
    return (
      cell?.mark === '1' &&
      (ENROLLED_STATUSES_LIST.includes(status) ||
        MATRIX_ACTIVE_NON_ENROLLED_STATUSES.has(status))
    );
  });
};

const mergeReservedRowsIntoPhaseMatrix = (studentMap, reservedRows, phases, normalizeStatusLabel) => {
  for (const row of reservedRows) {
    const studentId = parseInt(row.student_id, 10);
    const classId = parseInt(row.class_id, 10);
    const phaseNumber = parseInt(row.phase_number, 10) || 1;
    const trackKey = enrollmentTrackKey(studentId, classId);
    const cell = {
      mark: '1',
      label: normalizeStatusLabel('reserved'),
      status: 'reserved',
      phase_number: phaseNumber,
      is_full_payment: false,
    };

    if (!studentMap.has(trackKey)) {
      studentMap.set(
        trackKey,
        buildEnrollmentMatrixTrackRow({
          studentId,
          classId,
          fullName: row.full_name,
          className: row.class_name,
          classLevelTag: row.class_level_tag,
          firstEnrolledAt: row.reserved_at || null,
          phases: { [phaseNumber]: cell },
        })
      );
      continue;
    }

    const track = studentMap.get(trackKey);
    if (trackHasActiveEnrollmentCell(track, 'phases')) continue;
    if (!track.phases) track.phases = {};
    if (!track.phases[phaseNumber] || track.phases[phaseNumber].mark !== '1') {
      track.phases[phaseNumber] = cell;
    }
    if (!track.first_enrolled_at && row.reserved_at) {
      track.first_enrolled_at = row.reserved_at;
    }
  }
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

/**
 * Re-enrollment rate for operational dashboards — same billing-month logic as
 * Month Re-enrollment dashboard ({@link computeReEnrollmentMonthStats}) for
 * one calendar month. KPI counts on operational dashboards stay payment issue_date;
 * only the rate % and its numerator/denominator come from the month matrix.
 *
 * @param {Function} queryFn
 * @param {{ branchId?: number|null, programId?: number|null, classId?: number|null, summaryMonth?: string }} options summaryMonth = YYYY-MM
 */
export async function loadOperationalReEnrollmentRateFromMonthMatrix(queryFn, options = {}) {
  const { branchId = null, programId = null, classId = null, summaryMonth = null } = options;
  const monthKey = String(summaryMonth || '').trim().slice(0, 7);

  const empty = {
    re_enrollment_rate: 0,
    re_enrollment_rate_retained_count: 0,
    re_enrollment_rate_prior_count: 0,
    retention_base_count: 0,
    retention_re_enrollment_count: 0,
    prior_period_label: null,
    prior_period_type: null,
    retention_rate_mode: 'month_matrix_billing_month',
    re_enrollment_rate_source: 'month_re_enrollment_matrix',
    has_prior_month: false,
    matrix_month_label: null,
  };

  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    return empty;
  }

  const year = parseInt(monthKey.slice(0, 4), 10);
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    branchId,
    programId,
    classId,
    year,
  });

  const monthStat = (matrix.month_stats || []).find((row) => row.month_key === monthKey);
  const monthMeta = (matrix.months || []).find((row) => row.key === monthKey);
  const monthIndex = (matrix.months || []).findIndex((row) => row.key === monthKey);

  let priorPeriodLabel = null;
  if (monthIndex > 0) {
    priorPeriodLabel = matrix.months[monthIndex - 1]?.label ?? null;
  } else if (monthIndex === 0) {
    priorPeriodLabel = `Dec ${year - 1}`;
  }

  const retained = parseInt(monthStat?.re_enrolled_count, 10) || 0;
  const prior = parseInt(monthStat?.prior_month_enrolled_count, 10) || 0;
  const rawRate = monthStat?.re_enrollment_rate;
  const rate = rawRate == null ? 0 : Number(rawRate);

  return {
    re_enrollment_rate: rate,
    re_enrollment_rate_retained_count: retained,
    re_enrollment_rate_prior_count: prior,
    retention_base_count: prior,
    retention_re_enrollment_count: retained,
    prior_period_label: priorPeriodLabel,
    prior_period_type: 'prior_billing_month',
    retention_rate_mode: 'month_matrix_billing_month',
    re_enrollment_rate_source: 'month_re_enrollment_matrix',
    has_prior_month: Boolean(monthStat?.has_prior_month),
    matrix_month_label: monthMeta?.label ?? monthKey,
  };
}

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
    teacherId = null,
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
  let teacherJoin = '';
  if (teacherId) {
    const teacherScope = appendClassTeacherScope(teacherId, paramIdx, params);
    teacherJoin = teacherScope.sql;
    paramIdx = teacherScope.nextIdx;
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
          ${IS_FULL_PAYMENT_SQL} AS is_full_payment,
          ${CLASS_NUMBER_OF_PHASE_SQL} AS class_number_of_phase,
          ${INSTALLMENT_PACKAGE_COMPLETE_SQL} AS installment_package_complete,
          ${INSTALLMENT_PROFILE_TOTAL_PHASES_SUBQUERY} AS installment_plan_total_phases
        FROM classstudentstbl cs
        INNER JOIN classestbl c ON cs.class_id = c.class_id ${branchJoin}
        ${curriculumJoin}
        INNER JOIN userstbl u ON u.user_id = cs.student_id AND u.user_type = 'Student'
        WHERE COALESCE(cs.phase_number, 0) BETWEEN 1 AND $1::int
          AND COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
          ${programJoin}
          ${classJoin}
          ${teacherJoin}
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
      track_meta AS (
        SELECT DISTINCT ON (student_id, class_id)
          student_id,
          class_id,
          class_number_of_phase,
          installment_package_complete,
          installment_plan_total_phases
        FROM scoped_rows
        ORDER BY student_id, class_id, classstudent_id DESC
      ),
      student_phase_latest AS (
        -- Pick the latest row per student × class × phase (handles re-enroll/drop/rejoin history).
        SELECT
          sr.student_id,
          sr.class_id,
          sr.phase_number,
          sr.program_enrollment_status,
          sr.removed_at,
          sr.enrolled_at,
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
          spl.enrolled_at,
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
        m.enrolled_at,
        m.is_full_payment,
        tfe.first_enrolled_at,
        tm.class_number_of_phase,
        tm.installment_package_complete,
        tm.installment_plan_total_phases
      FROM matrix m
      INNER JOIN userstbl u ON u.user_id = m.student_id
      INNER JOIN classestbl c ON c.class_id = m.class_id
      LEFT JOIN track_first_enrolled tfe
        ON tfe.student_id = m.student_id AND tfe.class_id = m.class_id
      LEFT JOIN track_meta tm
        ON tm.student_id = m.student_id AND tm.class_id = m.class_id
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
      case 'reserved':
        return 'reserved';
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
          classNumberOfPhase: row.class_number_of_phase,
          installmentPlanTotalPhases: row.installment_plan_total_phases,
          installmentPackageComplete: row.installment_package_complete,
          phases: {},
        })
      );
    }
    const status = row.program_enrollment_status || null;
    const removedAt = row.removed_at || null;
    const cell = buildPhaseMatrixCell(status, removedAt, normalizeStatusLabel);
    studentMap.get(trackKey).phases[phaseNumber] = {
      ...cell,
      phase_number: phaseNumber,
      is_full_payment: Boolean(row.is_full_payment),
      enrolled_at: row.enrolled_at || null,
      removed_at: removedAt,
    };
  }

  const reservedRows = await loadActiveReservedMatrixRows(queryFn, {
    branchId,
    curriculumId,
    programId,
    classId,
    teacherId,
    enrolledFrom,
    enrolledTo,
  });
  mergeReservedRowsIntoPhaseMatrix(studentMap, reservedRows, phases, normalizeStatusLabel);

  const siblingTracksByStudent = await loadUpsellSiblingTracksForPhaseMatrix(
    queryFn,
    studentMap,
    {
      branchId,
      teacherId,
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
  // - Full-payment: last enrolled phase in scope shows 'completed'.
  // - Single-phase class: mark completed when the only phase is paid (full or installment).
  for (const student of students) {
    applyPhaseMatrixTerminalCompletedLabel(student, phases, normalizeStatusLabel);
  }

  applyUpsellMatrixDisplayRules(students, {
    periodKey: 'phases',
    siblingTracksByStudent,
  });
  applyMatrixTrackDisplayNames(students);

  applyDropRejoinGapPhaseMatrixRules(students, phases);

  const reservationTrackKeys = await loadReservationToEnrollmentTrackKeys(queryFn, {
    branchId,
    programId,
    classId,
    studentIds: [...new Set(students.map((s) => s.student_id))],
  });
  applyFromPreviousReservedCellFlags(students, 'phases', reservationTrackKeys);

  const lifecycleStudentIds = [...new Set(students.map((s) => s.student_id))];
  const lifecycleScope = {
    studentIds: lifecycleStudentIds,
    branchId,
    programId,
    classId,
    teacherId,
    lifecycleScope: true,
  };
  const {
    installmentTrackKeys,
    installmentCompleteByTrack,
    installmentProfileActiveByTrack,
  } = await loadInstallmentPaymentLifecycleContext(queryFn, lifecycleScope);
  const paymentLifecycleRows = await loadInstallmentInvoiceBillingLifecycle(
    queryFn,
    lifecycleScope
  );
  applyMatrixPaymentLifecycleOverlay(students, phases, paymentLifecycleRows, {
    periodKey: 'phases',
    installmentTrackKeys,
    installmentCompleteByTrack,
    installmentProfileActiveByTrack,
  });
  applyFullPaymentCompletedNextPeriodInactive(students, phases, 'phases');

  flagSinglePhaseCompletedCells(students, 'phases');

  const visibleStudents = filterHiddenMatrixTracks(students);
  const cohortSize = visibleStudents.length;
  const kpiTotals = aggregatePhaseMatrixKpiTotals(visibleStudents, phases);
  const reEnrollmentStats = computeReEnrollmentPhaseStats(phases, visibleStudents);

  // kpi_totals.re_enrollment_count = Re-enrollment KPI (excludes single-phase completed).
  // phase_stats / total_re_enrolled_count = rate-header numerators
  // (re-enrolled + completed with prior new/re-enrolled).
  return {
    phases,
    students: visibleStudents,
    phase_stats: reEnrollmentStats.phase_stats,
    cohort_size: cohortSize,
    total_re_enrolled_count: reEnrollmentStats.total_re_enrolled_count,
    total_prior_phase_enrolled_count: reEnrollmentStats.total_prior_phase_enrolled_count,
    total_re_enrollment_rate: reEnrollmentStats.total_re_enrollment_rate,
    kpi_totals: kpiTotals,
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
    case 'reserved': return 'reserved';
    default: return status.replaceAll('_', ' ').toLowerCase();
  }
};

const MATRIX_ENROLLED_OVERLAY_BLOCK_STATUSES = new Set([
  'new',
  're_enrolled',
  'upsell',
  'rejoin',
  'completed',
  'reserved',
  'pending_enrollment',
]);

/**
 * Statuses that anchor Active/Inactive on the *next* billing month.
 * pending_enrollment is included so the month after pending is marked Inactive
 * (Phase 1 not yet paid — not Active).
 */
const MATRIX_LIFECYCLE_ANCHOR_STATUSES = new Set([
  'new',
  're_enrolled',
  'upsell',
  'rejoin',
  'completed',
  'reserved',
  'pending_enrollment',
]);

/** Skip payment-lifecycle overlay when cell already shows enrolled or dropped status. */
const cellBlocksPaymentLifecycleOverlay = (cell) => {
  if (!cell) return false;
  const status = String(cell.status || '').toLowerCase();
  if (status === 'dropped' || cell.label === 'dropped/unenrolled') return true;
  if (cell.mark === '1' && MATRIX_ENROLLED_OVERLAY_BLOCK_STATUSES.has(status)) return true;
  return false;
};

const buildPaymentLifecycleCell = (isActive, phaseNumber, dueDateYmd = null) => ({
  mark: isActive ? '✓' : 'X',
  label: isActive ? 'Active' : 'Inactive',
  status: isActive ? 'active' : 'inactive',
  phase_number: phaseNumber ?? null,
  payment_lifecycle: true,
  invoice_due_date: dueDateYmd,
});

/**
 * True when the track's only enrollment badge is "completed"
 * (Active/Inactive lifecycle cells are ignored). Used to suppress a redundant
 * Active after a finished single-status / single-phase package.
 */
const trackHasOnlyCompletedEnrollmentStatus = (cellBucket) => {
  let enrolledCount = 0;
  let completedCount = 0;
  for (const cell of Object.values(cellBucket || {})) {
    if (!cell || cell.payment_lifecycle) continue;
    const status = String(cell.status || '').toLowerCase();
    if (cell.mark !== '1') continue;
    if (!MATRIX_LIFECYCLE_ANCHOR_STATUSES.has(status)) continue;
    enrolledCount += 1;
    if (status === 'completed') completedCount += 1;
  }
  return enrolledCount === 1 && completedCount === 1;
};

/**
 * Full-payment multi-phase tracks: after the terminal completed month/phase,
 * paint the immediate next empty period Inactive (same as finished installment).
 * Example: July completed → August Inactive. Does not run for single-status
 * short courses (completed alone is enough).
 */
export const applyFullPaymentCompletedNextPeriodInactive = (
  students,
  periods,
  periodKey = 'months'
) => {
  if (!periods?.length) return;

  for (const student of students || []) {
    if (!trackIsFullPaymentEnrollment(student)) continue;
    if (isSinglePhaseEnrollmentTrack(student)) continue;

    const cellBucket = periodKey === 'months' ? student.months : student.phases;
    if (!cellBucket) continue;
    if (trackHasOnlyCompletedEnrollmentStatus(cellBucket)) continue;

    const latestIdx = findLatestInstallmentLifecycleAnchorIndex(cellBucket, periods);
    if (latestIdx < 0 || latestIdx >= periods.length - 1) continue;

    const anchorCell = cellBucket[periods[latestIdx].key];
    if (String(anchorCell?.status || '').toLowerCase() !== 'completed') continue;

    const nextPeriod = periods[latestIdx + 1];
    if (cellBlocksPaymentLifecycleOverlay(cellBucket[nextPeriod.key])) continue;

    const inferredPhase =
      anchorCell?.phase_number != null ? Number(anchorCell.phase_number) + 1 : null;
    cellBucket[nextPeriod.key] = buildPaymentLifecycleCell(false, inferredPhase, null);
  }
};

/** Map student_id → installment track keys (student_id:class_id) in matrix scope. */
const buildInstallmentTrackKeysByStudent = (installmentTrackKeys) => {
  const byStudent = new Map();
  for (const trackKey of installmentTrackKeys || []) {
    const [studentIdRaw, classIdRaw] = String(trackKey).split(':');
    const studentId = parseInt(studentIdRaw, 10);
    const classId = parseInt(classIdRaw, 10);
    if (!Number.isFinite(studentId) || !Number.isFinite(classId)) continue;
    if (!byStudent.has(studentId)) byStudent.set(studentId, []);
    byStudent.get(studentId).push({ trackKey, classId });
  }
  return byStudent;
};

/** Collect class_ids merged onto an upsell anchor row (higher program billing). */
const collectMergedUpsellClassIds = (student, periodKey = 'months') => {
  const mergedClassIds = new Set();
  const bucket = student?.[periodKey] || {};
  for (const cell of Object.values(bucket)) {
    const mergedClassId = parseInt(cell?.merged_from_class_id, 10);
    if (Number.isFinite(mergedClassId)) mergedClassIds.add(mergedClassId);
  }
  return mergedClassIds;
};

/**
 * Resolve which installment profile track applies to a matrix row.
 * Upsell-merged anchor rows use the lower-program class_id while billing lives on the higher class.
 */
const resolveInstallmentTrackKeyForMatrixRow = (
  student,
  installmentTrackKeys,
  periodKey = 'months',
  installmentCompleteByTrack = null
) => {
  if (!student?.student_id || !installmentTrackKeys?.size) return null;

  const studentId = parseInt(student.student_id, 10);
  const pickIncompleteCandidate = (candidates = []) => {
    for (const candidate of candidates) {
      if (!installmentTrackKeys.has(candidate.trackKey)) continue;
      if (installmentCompleteByTrack?.get(candidate.trackKey)) continue;
      return candidate.trackKey;
    }
    for (const candidate of candidates) {
      if (installmentTrackKeys.has(candidate.trackKey)) return candidate.trackKey;
    }
    return null;
  };

  if (student.matrix_installment_class_id != null) {
    const mergedInstallmentKey = enrollmentTrackKey(
      student.student_id,
      student.matrix_installment_class_id
    );
    if (installmentTrackKeys.has(mergedInstallmentKey)) {
      return mergedInstallmentKey;
    }
  }

  const directKey =
    student.enrollment_track_key ||
    enrollmentTrackKey(student.student_id, student.class_id);
  if (installmentTrackKeys.has(directKey)) return directKey;

  const byStudent = buildInstallmentTrackKeysByStudent(installmentTrackKeys);
  const candidateKeys = byStudent.get(studentId) || [];
  if (!candidateKeys.length) return null;

  const mergedClassIds = collectMergedUpsellClassIds(student, periodKey);
  if (mergedClassIds.size) {
    const mergedCandidates = candidateKeys.filter((c) => mergedClassIds.has(c.classId));
    const mergedMatch = pickIncompleteCandidate(mergedCandidates);
    if (mergedMatch) return mergedMatch;
  }

  const hasUpsellCell = Object.values(student?.[periodKey] || {}).some((cell) => {
    const status = String(cell?.status || '').toLowerCase();
    return status === 'upsell' || cell?.calendar_upsell || cell?.display_upsell_synthetic;
  });
  if (hasUpsellCell || student.matrix_upsell_track) {
    const upsellRowCandidate = candidateKeys.find((c) => c.classId === student.class_id);
    if (upsellRowCandidate && installmentTrackKeys.has(upsellRowCandidate.trackKey)) {
      return upsellRowCandidate.trackKey;
    }
  }

  return pickIncompleteCandidate(candidateKeys);
};

const resolveInstallmentLifecycleRow = (
  installmentTrackKey,
  studentId,
  periodValue,
  lifecycleByTrackPeriod
) => {
  const direct = lifecycleByTrackPeriod.get(`${installmentTrackKey}|${periodValue}`);
  if (direct) return direct;

  const sid = parseInt(studentId, 10);
  if (!Number.isFinite(sid)) return null;
  const periodText = String(periodValue);
  for (const [key, row] of lifecycleByTrackPeriod.entries()) {
    const sep = key.lastIndexOf('|');
    if (sep < 0) continue;
    const trackKeyPart = key.slice(0, sep);
    const periodPart = key.slice(sep + 1);
    if (parseInt(trackKeyPart.split(':')[0], 10) !== sid) continue;
    if (periodPart === periodText) return row;
  }
  return null;
};

/** student_id|class_id keys for tracks on an installment invoice profile (recurring billing). */
const loadInstallmentTrackKeys = async (queryFn, options = {}) => {
  const {
    studentIds = [],
    branchId = null,
    programId = null,
    classId = null,
    teacherId = null,
    lifecycleScope = false,
  } = options;
  if (!studentIds.length) return new Set();

  const params = [studentIds];
  let paramIdx = 2;
  let branchJoin = '';
  let programJoin = '';
  let classJoin = '';
  let teacherJoin = '';
  if (branchId) {
    branchJoin = `AND c.branch_id = $${paramIdx}`;
    params.push(branchId);
    paramIdx += 1;
  }
  if (!lifecycleScope && programId) {
    programJoin = `AND c.program_id = $${paramIdx}`;
    params.push(programId);
    paramIdx += 1;
  }
  if (!lifecycleScope && classId) {
    classJoin = `AND ip.class_id = $${paramIdx}`;
    params.push(classId);
    paramIdx += 1;
  }
  if (!lifecycleScope && teacherId) {
    const teacherScope = appendClassTeacherScope(teacherId, paramIdx, params);
    teacherJoin = teacherScope.sql;
  }

  const result = await queryFn(
    `
      SELECT DISTINCT ip.student_id, ip.class_id
      FROM installmentinvoiceprofilestbl ip
      INNER JOIN classestbl c ON c.class_id = ip.class_id ${branchJoin}
      WHERE ip.student_id = ANY($1::int[])
        ${INSTALLMENT_PROFILE_MATRIX_VISIBILITY_SQL(lifecycleScope)}
        ${programJoin}
        ${classJoin}
        ${teacherJoin}
    `,
    params
  );

  return new Set(
    (result.rows || []).map((row) => enrollmentTrackKey(row.student_id, row.class_id))
  );
};

/** Package-complete flag per installment track for payment-lifecycle overlay. */
const loadInstallmentPackageCompleteByTrack = async (queryFn, options = {}) => {
  const { studentIds = [], branchId = null, lifecycleScope = false } = options;
  if (!studentIds.length) return new Map();

  const params = [studentIds];
  let branchJoin = '';
  if (branchId) {
    branchJoin = `AND c.branch_id = $2`;
    params.push(branchId);
  }

  const result = await queryFn(
    `
      SELECT
        ip.student_id,
        ip.class_id,
        (
          COALESCE(ip.total_phases, 0) > 0
          AND (
            SELECT COUNT(DISTINCT CASE
              WHEN i.status = 'Paid' THEN COALESCE(i.invoice_chain_root_id, i.invoice_id)
              ELSE NULL
            END)::integer
            FROM invoicestbl i
            WHERE i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
              AND (
                ip.downpayment_invoice_id IS NULL
                OR COALESCE(i.invoice_chain_root_id, i.invoice_id) <> ip.downpayment_invoice_id::INTEGER
              )
          ) >= COALESCE(ip.total_phases, 0)
        ) AS installment_package_complete
      FROM installmentinvoiceprofilestbl ip
      INNER JOIN classestbl c ON c.class_id = ip.class_id ${branchJoin}
      WHERE ip.student_id = ANY($1::int[])
        ${INSTALLMENT_PROFILE_MATRIX_VISIBILITY_SQL(lifecycleScope)}
    `,
    params
  );

  const completeByTrack = new Map();
  for (const row of result.rows || []) {
    completeByTrack.set(
      enrollmentTrackKey(row.student_id, row.class_id),
      Boolean(row.installment_package_complete)
    );
  }
  return completeByTrack;
};

/** Latest installment profile active flag per student+class track. */
const loadInstallmentProfileActiveByTrack = async (queryFn, options = {}) => {
  const { studentIds = [], branchId = null, lifecycleScope = false } = options;
  if (!studentIds.length) return new Map();

  const params = [studentIds];
  let branchJoin = '';
  if (branchId) {
    branchJoin = `AND c.branch_id = $2`;
    params.push(branchId);
  }

  const result = await queryFn(
    `
      SELECT DISTINCT ON (ip.student_id, ip.class_id)
        ip.student_id,
        ip.class_id,
        COALESCE(ip.is_active, true) AS profile_is_active
      FROM installmentinvoiceprofilestbl ip
      INNER JOIN classestbl c ON c.class_id = ip.class_id ${branchJoin}
      WHERE ip.student_id = ANY($1::int[])
        ${INSTALLMENT_PROFILE_MATRIX_VISIBILITY_SQL(lifecycleScope)}
      ORDER BY
        ip.student_id,
        ip.class_id,
        ip.installmentinvoiceprofiles_id DESC
    `,
    params
  );

  const activeByTrack = new Map();
  for (const row of result.rows || []) {
    activeByTrack.set(
      enrollmentTrackKey(row.student_id, row.class_id),
      Boolean(row.profile_is_active)
    );
  }
  return activeByTrack;
};

const loadInstallmentPaymentLifecycleContext = async (queryFn, options = {}) => {
  const lifecycleOptions = { ...options, lifecycleScope: true };
  const [installmentTrackKeys, installmentCompleteByTrack, installmentProfileActiveByTrack] =
    await Promise.all([
    loadInstallmentTrackKeys(queryFn, lifecycleOptions),
    loadInstallmentPackageCompleteByTrack(queryFn, lifecycleOptions),
    loadInstallmentProfileActiveByTrack(queryFn, lifecycleOptions),
  ]);
  return {
    installmentTrackKeys,
    installmentCompleteByTrack,
    installmentProfileActiveByTrack,
  };
};

/**
 * Installment phase invoices mapped to billing month (same anchor rules as month matrix).
 * Returns unpaid rows only — paid phases should already show re-enrolled from enrollment rows.
 */
const loadInstallmentInvoiceBillingLifecycle = async (queryFn, options = {}) => {
  const {
    studentIds = [],
    branchId = null,
    programId = null,
    classId = null,
    teacherId = null,
    lifecycleScope = false,
  } = options;
  if (!studentIds.length) return [];

  const params = [studentIds];
  let paramIdx = 2;
  let branchJoin = '';
  let programJoin = '';
  let classJoin = '';
  let teacherJoin = '';
  if (branchId) {
    branchJoin = `AND c.branch_id = $${paramIdx}`;
    params.push(branchId);
    paramIdx += 1;
  }
  if (!lifecycleScope && programId) {
    programJoin = `AND c.program_id = $${paramIdx}`;
    params.push(programId);
    paramIdx += 1;
  }
  if (!lifecycleScope && classId) {
    classJoin = `AND ip.class_id = $${paramIdx}`;
    params.push(classId);
    paramIdx += 1;
  }
  if (!lifecycleScope && teacherId) {
    const teacherScope = appendClassTeacherScope(teacherId, paramIdx, params);
    teacherJoin = teacherScope.sql;
    paramIdx = teacherScope.nextIdx;
  }

  const result = await queryFn(
    `
      WITH scoped_rows AS (
        SELECT
          cs.student_id,
          cs.class_id,
          COALESCE(cs.phase_number, 1) AS phase_number,
          cs.enrolled_at,
          cs.program_enrollment_status,
          cs.removed_at,
          cs.classstudent_id,
          c.start_date AS class_start_date
        FROM classstudentstbl cs
        INNER JOIN classestbl c ON cs.class_id = c.class_id ${branchJoin}
        INNER JOIN installmentinvoiceprofilestbl ip
          ON ip.student_id = cs.student_id
         AND ip.class_id = cs.class_id
        WHERE cs.student_id = ANY($1::int[])
          AND COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
          -- Late-start plans: ignore enrollments below phase_start so the billing
          -- anchor matches the month matrix (orphan pre-start rows must not shift
          -- unpaid due months — e.g. Xahari Miranda phase 2 kept Aug Active).
          AND COALESCE(cs.phase_number, 1) >= COALESCE(NULLIF(ip.phase_start, 0), 1)
          ${programJoin}
          ${classJoin}
          ${teacherJoin}
      ),
      anchor AS (
        SELECT DISTINCT ON (student_id, class_id)
          student_id,
          class_id,
          phase_number AS base_phase,
          DATE_TRUNC('month', TIMEZONE('Asia/Manila', enrolled_at))::date AS base_month
        FROM scoped_rows
        WHERE enrolled_at IS NOT NULL
          ${MATRIX_BILLING_ANCHOR_ACTIVE_WHERE}
        ORDER BY student_id, class_id, phase_number ASC, enrolled_at ASC
      ),
      -- Prefer TARGET_PHASE / "phase N" remarks; otherwise rank by issue_date
      -- (same fallback as paid-phase matrix overlay). Older plans often lack
      -- TARGET_PHASE — without this, unpaid invoices never map to a billing
      -- month and the next cell incorrectly stays Active (e.g. Clyde Falcon).
      invoice_ranked AS (
        SELECT
          ip.student_id,
          ip.class_id,
          COALESCE(NULLIF(ip.phase_start, 0), 1) AS phase_start,
          COALESCE(
            (regexp_match(i.remarks, 'TARGET_PHASE:(\\d+)', 'i'))[1]::int,
            (regexp_match(i.invoice_description, 'phase\\s*(\\d+)', 'i'))[1]::int
          ) AS target_phase,
          ROW_NUMBER() OVER (
            PARTITION BY ip.installmentinvoiceprofiles_id
            ORDER BY i.issue_date ASC NULLS LAST, i.invoice_id ASC
          )::int AS local_phase,
          TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due_date_ymd,
          LOWER(TRIM(i.status)) = 'paid' AS is_paid
        FROM installmentinvoiceprofilestbl ip
        INNER JOIN invoicestbl i
          ON i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
        INNER JOIN invoicestudentstbl ist
          ON ist.invoice_id = i.invoice_id
         AND ist.student_id = ip.student_id
        INNER JOIN classestbl c ON c.class_id = ip.class_id ${branchJoin}
        WHERE ip.student_id = ANY($1::int[])
          AND i.due_date IS NOT NULL
          AND COALESCE(i.status, '') NOT IN ('Cancelled', 'Canceled')
          AND COALESCE(i.invoice_description, '') NOT ILIKE '%downpayment%'
          AND (
            ip.downpayment_invoice_id IS NULL
            OR COALESCE(i.invoice_chain_root_id, i.invoice_id) <> ip.downpayment_invoice_id
          )
          ${programJoin}
          ${classJoin}
          ${teacherJoin}
      ),
      invoice_phase AS (
        SELECT
          student_id,
          class_id,
          COALESCE(target_phase, phase_start + local_phase - 1) AS phase_number,
          due_date_ymd,
          is_paid
        FROM invoice_ranked
      ),
      invoice_billing AS (
        SELECT
          inv.student_id,
          inv.class_id,
          inv.phase_number,
          inv.due_date_ymd,
          inv.is_paid,
          TO_CHAR(
            (
              GREATEST(
                a.base_month,
                CASE
                  WHEN c.start_date IS NOT NULL THEN
                    DATE_TRUNC('month', TIMEZONE('Asia/Manila', c.start_date))::date
                  ELSE a.base_month
                END
              ) + ((inv.phase_number - a.base_phase)::int * INTERVAL '1 month')
            )::date,
            'YYYY-MM'
          ) AS billing_month_key
        FROM invoice_phase inv
        INNER JOIN anchor a
          ON a.student_id = inv.student_id
         AND a.class_id = inv.class_id
        INNER JOIN classestbl c ON c.class_id = inv.class_id
        WHERE inv.phase_number IS NOT NULL
          AND inv.phase_number >= a.base_phase
      ),
      unpaid_billing AS (
        SELECT
          student_id,
          class_id,
          billing_month_key,
          MAX(phase_number) AS phase_number,
          MAX(due_date_ymd) AS due_date_ymd
        FROM invoice_billing
        WHERE NOT is_paid
          AND billing_month_key IS NOT NULL
          AND due_date_ymd IS NOT NULL
        GROUP BY student_id, class_id, billing_month_key
      )
      SELECT
        student_id,
        class_id,
        billing_month_key,
        phase_number,
        due_date_ymd,
        false AS is_paid
      FROM unpaid_billing
    `,
    params
  );

  return (result.rows || []).map((row) => ({
    student_id: parseInt(row.student_id, 10),
    class_id: parseInt(row.class_id, 10),
    billing_month_key: row.billing_month_key,
    phase_number: parseInt(row.phase_number, 10) || null,
    due_date_ymd: row.due_date_ymd,
    is_paid: false,
  }));
};

/**
 * Paid installment phases with billing months where no classstudent row exists
 * for that phase (e.g. phase 2 paid but only phase 1 + 3 enrolled — fills matrix gaps).
 * Does not synthesize over dropped/removed phase rows — those cells must keep
 * invoice/enrollment "dropped" (not false re-enrolled from a later paid invoice).
 */
const loadPaidInstallmentPhaseMatrixOverlay = async (queryFn, options = {}) => {
  const {
    branchId = null,
    programId = null,
    classId = null,
    teacherId = null,
    fromMonthStart,
    toMonthStart,
  } = options;
  if (!fromMonthStart || !toMonthStart) return [];

  const params = [fromMonthStart, toMonthStart];
  let paramIdx = 3;
  let branchJoin = '';
  let programJoin = '';
  let classJoin = '';
  let teacherJoin = '';
  if (branchId) {
    branchJoin = `AND c.branch_id = $${paramIdx}`;
    params.push(branchId);
    paramIdx += 1;
  }
  if (programId) {
    programJoin = `AND c.program_id = $${paramIdx}`;
    params.push(programId);
    paramIdx += 1;
  }
  if (classId) {
    classJoin = `AND ip.class_id = $${paramIdx}`;
    params.push(classId);
    paramIdx += 1;
  }
  if (teacherId) {
    const teacherScope = appendClassTeacherScope(teacherId, paramIdx, params);
    teacherJoin = teacherScope.sql;
  }

  const result = await queryFn(
    `
      WITH scoped_rows AS (
        SELECT
          cs.student_id,
          cs.class_id,
          COALESCE(cs.phase_number, 1) AS phase_number,
          cs.enrolled_at,
          cs.program_enrollment_status,
          cs.removed_at,
          cs.classstudent_id,
          c.start_date AS class_start_date
        FROM classstudentstbl cs
        INNER JOIN classestbl c ON cs.class_id = c.class_id ${branchJoin}
        INNER JOIN installmentinvoiceprofilestbl ip
          ON ip.student_id = cs.student_id
         AND ip.class_id = cs.class_id
        WHERE COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
          AND COALESCE(cs.phase_number, 1) >= COALESCE(NULLIF(ip.phase_start, 0), 1)
          ${programJoin}
          ${classJoin}
          ${teacherJoin}
      ),
      anchor AS (
        SELECT DISTINCT ON (student_id, class_id)
          student_id,
          class_id,
          phase_number AS base_phase,
          DATE_TRUNC('month', TIMEZONE('Asia/Manila', enrolled_at))::date AS base_month
        FROM scoped_rows
        WHERE enrolled_at IS NOT NULL
          ${MATRIX_BILLING_ANCHOR_ACTIVE_WHERE}
        ORDER BY student_id, class_id, phase_number ASC, enrolled_at ASC
      ),
      invoice_ranked AS (
        SELECT
          ip.student_id,
          ip.class_id,
          ip.installmentinvoiceprofiles_id,
          COALESCE(NULLIF(ip.phase_start, 0), 1) AS phase_start,
          COALESCE(
            (regexp_match(i.remarks, 'TARGET_PHASE:(\\d+)', 'i'))[1]::int,
            NULL
          ) AS target_phase,
          ROW_NUMBER() OVER (
            PARTITION BY ip.installmentinvoiceprofiles_id
            ORDER BY i.issue_date ASC NULLS LAST, i.invoice_id ASC
          )::int AS local_phase
        FROM installmentinvoiceprofilestbl ip
        INNER JOIN invoicestbl i
          ON i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
        INNER JOIN invoicestudentstbl ist
          ON ist.invoice_id = i.invoice_id
         AND ist.student_id = ip.student_id
        INNER JOIN classestbl c ON c.class_id = ip.class_id ${branchJoin}
        WHERE i.due_date IS NOT NULL
          -- Only fully Paid invoices advance the phase sequence. Partially Paid
          -- must not consume a slot (otherwise later Paid invoices shift forward
          -- and paint false re-enrolled months — e.g. Lorenzo Ardina July).
          AND LOWER(TRIM(i.status)) = 'paid'
          AND COALESCE(i.invoice_description, '') NOT ILIKE '%downpayment%'
          AND (
            ip.downpayment_invoice_id IS NULL
            OR i.invoice_id <> ip.downpayment_invoice_id
          )
          ${programJoin}
          ${classJoin}
          ${teacherJoin}
      ),
      invoice_phase AS (
        SELECT
          student_id,
          class_id,
          phase_start,
          COALESCE(target_phase, phase_start + local_phase - 1) AS phase_number
        FROM invoice_ranked
      ),
      invoice_billing AS (
        SELECT
          inv.student_id,
          inv.class_id,
          inv.phase_number,
          inv.phase_start,
          (
            GREATEST(
              a.base_month,
              CASE
                WHEN c.start_date IS NOT NULL THEN
                  DATE_TRUNC('month', TIMEZONE('Asia/Manila', c.start_date))::date
                ELSE a.base_month
              END
            ) + ((inv.phase_number - a.base_phase)::int * INTERVAL '1 month')
          )::date AS billing_month
        FROM invoice_phase inv
        INNER JOIN anchor a
          ON a.student_id = inv.student_id
         AND a.class_id = inv.class_id
        INNER JOIN classestbl c ON c.class_id = inv.class_id
        WHERE inv.phase_number IS NOT NULL
          AND inv.phase_number >= a.base_phase
      )
      SELECT DISTINCT
        ib.student_id,
        ib.class_id,
        ib.phase_number,
        ib.phase_start,
        TO_CHAR(ib.billing_month, 'YYYY-MM') AS billing_month_key,
        u.full_name,
        c.class_name,
        c.level_tag AS class_level_tag
      FROM invoice_billing ib
      INNER JOIN userstbl u ON u.user_id = ib.student_id AND u.user_type = 'Student'
      INNER JOIN classestbl c ON c.class_id = ib.class_id
      WHERE ib.billing_month >= $1::date
        AND ib.billing_month <= $2::date
        AND NOT EXISTS (
          SELECT 1
          FROM classstudentstbl cs2
          WHERE cs2.student_id = ib.student_id
            AND cs2.class_id = ib.class_id
            AND COALESCE(cs2.phase_number, 1) = ib.phase_number
            AND COALESCE(cs2.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
            AND (
              (
                cs2.removed_at IS NULL
                AND cs2.program_enrollment_status IN ${ENROLLED_STATUSES}
              )
              OR cs2.program_enrollment_status = 'dropped'
              OR cs2.removed_at IS NOT NULL
            )
        )
    `,
    params
  );

  return result.rows || [];
};

/** Latest billing anchor for installment lifecycle (enrolled or dropped month). */
const findLatestInstallmentLifecycleAnchorIndex = (cellBucket, periods) => {
  let latestIdx = -1;
  for (let i = 0; i < periods.length; i += 1) {
    const cell = cellBucket[periods[i].key];
    if (!cell) continue;
    const status = String(cell?.status || '').toLowerCase();
    if (cell.mark === '1' && MATRIX_LIFECYCLE_ANCHOR_STATUSES.has(status)) {
      if (cell.removed_at) continue;
      latestIdx = i;
    } else if (isDroppedMonthMatrixCell(cell)) {
      latestIdx = i;
    }
  }
  return latestIdx;
};

/**
 * Overlay Active (✓) / Inactive (X) on the immediate billing month/phase after
 * the latest enrolled, pending, or dropped cell for recurring (installment) tracks.
 *
 * - After **dropped**, the immediate next period is always **Inactive**.
 * - After **pending_enrollment**, the immediate next period is always **Inactive**
 *   (downpayment paid but Phase 1 not settled — not yet Active).
 * - After enrolled cells: **Active** while the next unpaid invoice due date is
 *   still on/after today (Manila). Once past due — including "Under grace period" —
 *   the next cell is **Inactive**.
 * - When the track's **only** enrollment status is **completed**, do not overlay Active/Inactive
 *   (single-status short course — completed alone is enough).
 * - When the latest anchor is **completed** (multi-phase / recurring finished), the next
 *   month/phase is always **Inactive** — never Active after recurring invoices are done
 *   (e.g. April completed → May Inactive; student counts inactive for that month).
 * - When the installment package is already complete, never paint Active on the next cell
 *   (force Inactive when a lifecycle cell is shown).
 * - Paid periods keep re-enrolled / new from enrollment rows.
 */
const applyMatrixPaymentLifecycleOverlay = (students, periods, lifecycleRows, options = {}) => {
  const {
    periodKey = 'months',
    installmentTrackKeys = new Set(),
    installmentCompleteByTrack = new Map(),
    installmentProfileActiveByTrack = new Map(),
  } = options;
  if (!periods?.length || !installmentTrackKeys.size) return;

  const todayYmd = todayYmdManila();
  const lifecycleByTrackPeriod = new Map();
  for (const row of lifecycleRows || []) {
    const trackKey = enrollmentTrackKey(row.student_id, row.class_id);
    const periodValue = periodKey === 'months' ? row.billing_month_key : row.phase_number;
    if (periodValue == null || periodValue === '') continue;
    lifecycleByTrackPeriod.set(`${trackKey}|${periodValue}`, row);
  }

  for (const student of students) {
    const cellBucket = periodKey === 'months' ? student.months : student.phases;
    if (!cellBucket) continue;

    const installmentTrackKey = resolveInstallmentTrackKeyForMatrixRow(
      student,
      installmentTrackKeys,
      periodKey,
      installmentCompleteByTrack
    );
    if (!installmentTrackKey) continue;
    const packageIsComplete = Boolean(installmentCompleteByTrack.get(installmentTrackKey));
    const profileIsInactive = installmentProfileActiveByTrack.get(installmentTrackKey) === false;

    // Single-status completed tracks (e.g. Active Champs short course): show completed only.
    if (trackHasOnlyCompletedEnrollmentStatus(cellBucket)) continue;

    const latestEnrolledIdx = findLatestInstallmentLifecycleAnchorIndex(cellBucket, periods);
    if (latestEnrolledIdx < 0 || latestEnrolledIdx >= periods.length - 1) continue;

    const anchorCell = cellBucket[periods[latestEnrolledIdx].key];
    const anchorStatus = String(anchorCell?.status || '').toLowerCase();
    const anchorIsDropped = isDroppedMonthMatrixCell(anchorCell);
    const anchorIsPending = anchorStatus === 'pending_enrollment';
    const anchorIsCompleted = anchorStatus === 'completed';
    const nextPeriod = periods[latestEnrolledIdx + 1];
    const nextPeriodValue = nextPeriod.key;
    if (cellBlocksPaymentLifecycleOverlay(cellBucket[nextPeriodValue])) continue;

    const lifecycle = resolveInstallmentLifecycleRow(
      installmentTrackKey,
      student.student_id,
      nextPeriodValue,
      lifecycleByTrackPeriod
    );
    const dueDateYmd = lifecycle?.due_date_ymd || null;
    // Past due (including under grace) → Inactive. On/before due → Active.
    const unpaidPastDue = Boolean(lifecycle) && isYmdBefore(dueDateYmd, todayYmd);
    const inferredPhaseAfterDrop =
      anchorIsDropped && anchorCell?.phase_number != null
        ? Number(anchorCell.phase_number) + 1
        : null;
    const inferredPhaseAfterInactiveProfile =
      profileIsInactive && anchorCell?.phase_number != null
        ? Number(anchorCell.phase_number) + 1
        : null;
    const inferredPhaseAfterCompleted =
      anchorIsCompleted && anchorCell?.phase_number != null
        ? Number(anchorCell.phase_number) + 1
        : null;
    const phaseNumber =
      lifecycle?.phase_number ??
      inferredPhaseAfterDrop ??
      inferredPhaseAfterInactiveProfile ??
      inferredPhaseAfterCompleted ??
      (anchorIsPending ? anchorCell?.phase_number ?? null : null) ??
      (periodKey === 'phases' ? parseInt(nextPeriodValue, 10) || null : null);

    // Pending, dropped, completed recurring, inactive profiles, and finished packages
    // force Inactive on the next cell — never Active after recurring invoices are done.
    const isActive =
      anchorIsDropped ||
      anchorIsPending ||
      anchorIsCompleted ||
      profileIsInactive ||
      packageIsComplete
        ? false
        : !unpaidPastDue;

    cellBucket[nextPeriodValue] = buildPaymentLifecycleCell(
      isActive,
      phaseNumber,
      dueDateYmd
    );
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
    packageCompleteMonthByTrack,
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
              ${INSTALLMENT_BILLING_MONTH_FROM_ANCHOR_SQL}
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
      cohort_with_upsell_anchors AS (
        SELECT student_id, class_id FROM cohort
        UNION
        SELECT DISTINCT pb.student_id, pb.class_id
        FROM phase_billing pb
        INNER JOIN cohort co ON co.student_id = pb.student_id
        INNER JOIN classestbl c_co ON c_co.class_id = co.class_id
        INNER JOIN classestbl c_pb ON c_pb.class_id = pb.class_id
        WHERE (
          CASE c_pb.level_tag
            WHEN 'Playgroup' THEN 0
            WHEN 'Nursery' THEN 1
            WHEN 'Pre-Kindergarten' THEN 2
            WHEN 'Kindergarten' THEN 3
            WHEN 'Grade School' THEN 4
            ELSE -1
          END
        ) < (
          CASE c_co.level_tag
            WHEN 'Playgroup' THEN 0
            WHEN 'Nursery' THEN 1
            WHEN 'Pre-Kindergarten' THEN 2
            WHEN 'Kindergarten' THEN 3
            WHEN 'Grade School' THEN 4
            ELSE -1
          END
        )
        AND (
          CASE c_pb.level_tag
            WHEN 'Playgroup' THEN 0
            WHEN 'Nursery' THEN 1
            WHEN 'Pre-Kindergarten' THEN 2
            WHEN 'Kindergarten' THEN 3
            WHEN 'Grade School' THEN 4
            ELSE -1
          END
        ) >= 0
      ),
      student_month_status AS (
        SELECT DISTINCT ON (student_id, class_id, billing_month)
          student_id,
          class_id,
          billing_month,
          phase_number,
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
          sms.class_level_tag,
          sms.phase_number
        FROM cohort_with_upsell_anchors co
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
        c.level_tag AS class_level_tag,
        u.full_name,
        TO_CHAR(m.month_start, 'YYYY-MM') AS month_key,
        m.program_enrollment_status,
        m.removed_at,
        m.is_full_payment,
        m.phase_number
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
          packageCompleteMonthKey: packageCompleteMonthByTrack?.get(trackKey) || null,
          months: {},
        })
      );
    }

    const status = row.program_enrollment_status || null;
    const removedAt = row.removed_at || null;
    // Historical paid phases keep new/re_enrolled with removed_at after a later drop.
    // Only status "dropped" is the drop marker — removed_at alone must not imply dropped.
    const isEnrolled = status && ENROLLED_STATUSES_LIST.includes(status);
    const mark = isEnrolled ? '1' : '-';
    const label = isEnrolled
      ? normalizeEnrollmentLabel(status)
      : status === 'dropped'
        ? 'dropped/unenrolled'
        : normalizeEnrollmentLabel(status);

    siblingTrackMap.get(trackKey).months[row.month_key] = {
      mark,
      label,
      status,
      phase_number: matrixCellPhaseNumber(row.phase_number),
      is_full_payment: Boolean(row.is_full_payment),
      enrolled_at: row.enrolled_at || null,
      removed_at: removedAt,
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
                ${INSTALLMENT_BILLING_MONTH_FROM_ANCHOR_SQL}
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
  { branchId = null, teacherId = null, phaseCount = 10, enrolledFrom = null, enrolledTo = null }
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
  let teacherJoin = '';
  if (teacherId) {
    const teacherScope = appendClassTeacherScope(teacherId, paramIdx, params);
    teacherJoin = teacherScope.sql;
    paramIdx = teacherScope.nextIdx;
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
          ${teacherJoin}
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
      phase_number: phaseNumber,
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
 *     2. billing_month = max(anchor_month, class.start_date month)
 *        + (phase_number − anchor_phase) months
 *     Early first payment before class start (e.g. pay June, class starts July) →
 *     phase 1 "new" displays in July, not the payment month.
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
  const {
    branchId = null,
    programId = null,
    classId = null,
    teacherId = null,
    year = null,
    fromMonth = null,
    toMonth = null,
  } = options;

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

  const buildScopeJoins = (startIdx, targetParams, options = {}) => {
    const { classIdColumn = 'cs.class_id' } = options;
    let idx = startIdx;
    let branchJoinSql = '';
    let programJoinSql = '';
    let classJoinSql = '';
    let teacherJoinSql = '';
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
      classJoinSql = `AND ${classIdColumn} = $${idx}`;
      targetParams.push(classId);
      idx += 1;
    }
    if (teacherId) {
      const teacherScope = appendClassTeacherScope(teacherId, idx, targetParams);
      teacherJoinSql = teacherScope.sql;
      idx = teacherScope.nextIdx;
    }
    return {
      branchJoin: branchJoinSql,
      programJoin: programJoinSql,
      classJoin: classJoinSql,
      teacherJoin: teacherJoinSql,
    };
  };

  const params = [queryFromMonthStart, toMonthStart, fromMonthStart];
  const { branchJoin, programJoin, classJoin, teacherJoin } = buildScopeJoins(4, params);

  const scopeParams = [];
  const {
    branchJoin: scopeBranchJoin,
    programJoin: scopeProgramJoin,
    classJoin: scopeClassJoin,
    teacherJoin: scopeTeacherJoin,
  } = buildScopeJoins(1, scopeParams);

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
          ${MATRIX_EXCLUDE_INSTALLMENT_PHASE_START_SQL}
          AND (
            cs.enrolled_at IS NOT NULL
            OR c.start_date IS NOT NULL
          )
          ${programJoin}
          ${classJoin}
          ${teacherJoin}
      ),

      -- Installment anchor: earliest active enrolled phase + enrolled_at month.
      anchor AS (
        SELECT DISTINCT ON (student_id, class_id)
          student_id,
          class_id,
          phase_number                                                           AS base_phase,
          DATE_TRUNC('month', TIMEZONE('Asia/Manila', enrolled_at))::date        AS base_month
        FROM scoped_rows
        WHERE enrolled_at IS NOT NULL
          ${MATRIX_BILLING_ANCHOR_ACTIVE_WHERE}
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
              ${INSTALLMENT_BILLING_MONTH_FROM_ANCHOR_SQL}
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
          phase_number,
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
          sms.is_full_payment,
          sms.phase_number
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
        m.is_full_payment,
        m.phase_number
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
          ${IS_FULL_PAYMENT_SQL}                                                                      AS is_full_payment,
          ${CLASS_NUMBER_OF_PHASE_SQL}                                           AS class_number_of_phase,
          ${INSTALLMENT_PACKAGE_COMPLETE_SQL}                                      AS installment_package_complete,
          ${INSTALLMENT_PROFILE_TOTAL_PHASES_SUBQUERY}                             AS installment_plan_total_phases
        FROM classstudentstbl cs
        INNER JOIN classestbl c ON cs.class_id = c.class_id ${scopeBranchJoin}
        INNER JOIN userstbl u ON u.user_id = cs.student_id AND u.user_type = 'Student'
        WHERE COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
          ${MATRIX_EXCLUDE_INSTALLMENT_PHASE_START_SQL}
          AND (
            cs.enrolled_at IS NOT NULL
            OR c.start_date IS NOT NULL
          )
          ${scopeProgramJoin}
          ${scopeClassJoin}
          ${scopeTeacherJoin}
      ),
      track_meta AS (
        SELECT DISTINCT ON (student_id, class_id)
          student_id,
          class_id,
          class_number_of_phase,
          installment_package_complete,
          installment_plan_total_phases
        FROM scoped_rows
        ORDER BY student_id, class_id, classstudent_id DESC
      ),
      anchor AS (
        SELECT DISTINCT ON (student_id, class_id)
          student_id,
          class_id,
          phase_number                                                           AS base_phase,
          DATE_TRUNC('month', TIMEZONE('Asia/Manila', enrolled_at))::date        AS base_month
        FROM scoped_rows
        WHERE enrolled_at IS NOT NULL
          ${MATRIX_BILLING_ANCHOR_ACTIVE_WHERE}
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
              ${INSTALLMENT_BILLING_MONTH_FROM_ANCHOR_SQL}
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
      package_complete AS (
        SELECT
          pb.student_id,
          pb.class_id,
          MAX(pb.billing_month) AS terminal_billing_month
        FROM phase_billing pb
        INNER JOIN track_meta tm
          ON tm.student_id = pb.student_id
         AND tm.class_id = pb.class_id
        WHERE pb.billing_month IS NOT NULL
          AND pb.program_enrollment_status IN ${ENROLLED_STATUSES}
          AND pb.removed_at IS NULL
          AND (
            pb.is_full_payment = true
            OR pb.program_enrollment_status = 'completed'
            OR tm.installment_package_complete = true
          )
        GROUP BY pb.student_id, pb.class_id
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
        TO_CHAR(lfp.last_full_pay_billing_month, 'YYYY-MM') AS last_full_pay_month_key,
        TO_CHAR(pc.terminal_billing_month, 'YYYY-MM') AS package_complete_month_key,
        tm.class_number_of_phase,
        tm.installment_package_complete,
        tm.installment_plan_total_phases
      FROM track_first_enrolled tfe
      LEFT JOIN first_enrolled fe
        ON fe.student_id = tfe.student_id AND fe.class_id = tfe.class_id
      LEFT JOIN last_full_pay lfp
        ON lfp.student_id = tfe.student_id AND lfp.class_id = tfe.class_id
      LEFT JOIN package_complete pc
        ON pc.student_id = tfe.student_id AND pc.class_id = tfe.class_id
      LEFT JOIN track_meta tm
        ON tm.student_id = tfe.student_id AND tm.class_id = tfe.class_id
    `,
    scopeParams
  );

  const firstEnrolledByTrack = new Map();
  const firstEnrolledAtByTrack = new Map();
  const lastFullPayMonthByTrack = new Map();
  const packageCompleteMonthByTrack = new Map();
  const classNumberOfPhaseByTrack = new Map();
  const installmentPackageCompleteByTrack = new Map();
  const installmentPlanTotalPhasesByTrack = new Map();
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
    if (row.package_complete_month_key) {
      packageCompleteMonthByTrack.set(trackKey, row.package_complete_month_key);
    }
    if (row.class_number_of_phase != null) {
      classNumberOfPhaseByTrack.set(trackKey, parseInt(row.class_number_of_phase, 10) || 1);
    }
    if (row.installment_package_complete) {
      installmentPackageCompleteByTrack.set(trackKey, true);
    }
    if (row.installment_plan_total_phases != null) {
      installmentPlanTotalPhasesByTrack.set(
        trackKey,
        parseInt(row.installment_plan_total_phases, 10) || 0
      );
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
          classNumberOfPhase: classNumberOfPhaseByTrack.get(trackKey) ?? null,
          installmentPlanTotalPhases: installmentPlanTotalPhasesByTrack.get(trackKey) ?? null,
          installmentPackageComplete: installmentPackageCompleteByTrack.get(trackKey) || false,
          packageCompleteMonthKey: packageCompleteMonthByTrack.get(trackKey) || null,
          months: {},
        })
      );
    }

    const status = row.program_enrollment_status || null;
    const removedAt = row.removed_at || null;
    // Historical paid phases keep new/re_enrolled with removed_at after a later drop.
    // Only status "dropped" is the drop marker — removed_at alone must not imply dropped.
    const isEnrolled = status && ENROLLED_STATUSES_LIST.includes(status);
    const isReservedOrPending =
      status === 'reserved' || status === 'pending_enrollment';
    const mark = isEnrolled || isReservedOrPending ? '1' : '-';
    const label = isEnrolled || isReservedOrPending
      ? normalizeEnrollmentLabel(status)
      : status === 'dropped'
        ? 'dropped/unenrolled'
        : normalizeEnrollmentLabel(status);

    studentMap.get(trackKey).months[monthKey] = {
      mark,
      label,
      status,
      phase_number: matrixCellPhaseNumber(row.phase_number),
      is_full_payment: Boolean(row.is_full_payment),
      enrolled_at: row.enrolled_at || null,
      removed_at: removedAt,
    };
  }

  const displayMonthKeys = new Set(months.map((m) => m.key));
  const matrixCohortStudentIds = [
    ...new Set(
      (result.rows || [])
        .map((row) => parseInt(row.student_id, 10))
        .filter((id) => Number.isFinite(id))
    ),
  ];
  const installmentProfileBillingByStudent = await loadInstallmentProfileBillingClassMap(
    queryFn,
    matrixCohortStudentIds
  );
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
    teacherJoin: calendarTeacherJoin,
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
        COALESCE(cs.phase_number, 1) AS phase_number,
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
        ${calendarTeacherJoin}
    `,
    calendarOverlayParams
  );

  for (const row of droppedCalendarResult.rows || []) {
    const studentId = parseInt(row.student_id, 10);
    const classId = parseInt(row.class_id, 10);
    const monthKey = row.month_key;
    if (!displayMonthKeys.has(monthKey)) continue;

    const billingClasses = installmentProfileBillingByStudent.get(studentId);
    if (billingClasses?.has(classId)) {
      continue;
    }

    const student = ensureMatrixStudent(studentId, classId, row.full_name, row.class_name);
    const existing = student.months[monthKey];
    if (
      existing?.mark === '1' &&
      ENROLLED_STATUSES_LIST.includes(String(existing.status || '').toLowerCase())
    ) {
      continue;
    }
    student.months[monthKey] = {
      mark: '-',
      label: 'dropped/unenrolled',
      status: 'dropped',
      phase_number: matrixCellPhaseNumber(row.phase_number, existing?.phase_number),
      calendar_dropped: true,
      is_full_payment: Boolean(existing?.is_full_payment),
    };
  }

  // Orphan installment (paid downpayment, no profile): class-start month = first "new".
  const installmentStartParams = [];
  const {
    branchJoin: installmentStartBranchJoin,
    programJoin: installmentStartProgramJoin,
    classJoin: installmentStartClassJoin,
    teacherJoin: installmentStartTeacherJoin,
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
        ${installmentStartTeacherJoin}
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
      phase_number: 1,
      calendar_installment_start: true,
      is_full_payment: false,
    };
    if (!student.first_enrolled_month_key || monthKey < student.first_enrolled_month_key) {
      student.first_enrolled_month_key = monthKey;
    }
  }

  const paidInstallmentOverlayRows = await loadPaidInstallmentPhaseMatrixOverlay(queryFn, {
    branchId,
    programId,
    classId,
    teacherId,
    fromMonthStart,
    toMonthStart,
  });
  for (const row of paidInstallmentOverlayRows) {
    const studentId = parseInt(row.student_id, 10);
    const classId = parseInt(row.class_id, 10);
    const monthKey = row.billing_month_key;
    if (!displayMonthKeys.has(monthKey)) continue;

    const student = ensureMatrixStudent(
      studentId,
      classId,
      row.full_name,
      row.class_name,
      row.class_level_tag
    );
    const existing = student.months[monthKey];
    // Never paint over real enrollment or dropped cells — paid gap-fill is
    // only for missing phase rows (invoice paid, no classstudent for phase).
    if (
      (existing?.mark === '1' &&
        ENROLLED_STATUSES_LIST.includes(String(existing.status || '').toLowerCase())) ||
      isDroppedMonthMatrixCell(existing)
    ) {
      continue;
    }

    const phaseStart = parseInt(row.phase_start, 10) || 1;
    const phaseNumber = parseInt(row.phase_number, 10) || phaseStart;
    const status = phaseNumber === phaseStart ? 'new' : 're_enrolled';

    student.months[monthKey] = {
      mark: '1',
      label: status === 'new' ? 'new' : 're-enrolled',
      status,
      phase_number: phaseNumber,
      matrix_paid_installment_phase: true,
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
        COALESCE(cs.phase_number, 1) AS phase_number,
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
        ${calendarTeacherJoin}
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

    const existing = student.months[monthKey];
    // Billing-month cells win over enrolled_at calendar month (installment phase-offset model).
    if (existing?.mark === '1') continue;

    student.months[monthKey] = {
      mark: '1',
      label: 'rejoin',
      status: 'rejoin',
      phase_number: matrixCellPhaseNumber(row.phase_number, existing?.phase_number),
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
        ${calendarTeacherJoin}
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
      phase_number: 1,
      calendar_upsell: true,
      is_full_payment: Boolean(student.months[monthKey]?.is_full_payment),
    };
    if (!student.first_enrolled_month_key || monthKey < student.first_enrolled_month_key) {
      student.first_enrolled_month_key = monthKey;
    }
  }

  // Active reservations by reserved_at month (before "new" overlay so paid enrollments win).
  const reservedCalendarParams = [fromMonthStart, displayEnrolledToExclusive];
  const {
    branchJoin: reservedBranchJoin,
    programJoin: reservedProgramJoin,
    classJoin: reservedClassJoin,
    teacherJoin: reservedTeacherJoin,
  } = buildScopeJoins(3, reservedCalendarParams, {
    classIdColumn: 'r.class_id',
  });

  const reservedCalendarResult = await queryFn(
    `
      SELECT DISTINCT
        r.student_id,
        r.class_id,
        c.class_name,
        c.level_tag AS class_level_tag,
        u.full_name,
        TO_CHAR(
          TIMEZONE('Asia/Manila', COALESCE(r.reservation_fee_paid_at, r.reserved_at)),
          'YYYY-MM'
        ) AS month_key,
        COALESCE(r.reservation_fee_paid_at, r.reserved_at) AS reserved_at
      FROM reservedstudentstbl r
      INNER JOIN classestbl c ON r.class_id = c.class_id ${reservedBranchJoin}
      INNER JOIN userstbl u ON u.user_id = r.student_id AND u.user_type = 'Student'
      LEFT JOIN invoicestbl inv ON r.invoice_id = inv.invoice_id
      WHERE ${RESERVATION_FEE_PAID_SQL}
        AND r.expired_at IS NULL
        AND COALESCE(r.reservation_fee_paid_at, r.reserved_at) IS NOT NULL
        AND TIMEZONE('Asia/Manila', COALESCE(r.reservation_fee_paid_at, r.reserved_at))::date >= $1::date
        AND TIMEZONE('Asia/Manila', COALESCE(r.reservation_fee_paid_at, r.reserved_at))::date < $2::date
        AND NOT EXISTS (
          SELECT 1 FROM classstudentstbl cs
          WHERE cs.student_id = r.student_id
            AND cs.class_id = r.class_id
            AND cs.removed_at IS NULL
            AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'completed', 'pending_enrollment')
        )
        ${reservedProgramJoin}
        ${reservedClassJoin}
        ${reservedTeacherJoin}
    `,
    reservedCalendarParams
  );

  for (const row of reservedCalendarResult.rows || []) {
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
    const existing = student.months[monthKey];
    if (
      existing?.mark === '1' &&
      ['new', 're_enrolled', 'upsell', 'rejoin', 'completed', 'pending_enrollment'].includes(
        String(existing.status || '').toLowerCase()
      )
    ) {
      continue;
    }
    student.months[monthKey] = {
      mark: '1',
      label: 'reserved',
      status: 'reserved',
      phase_number: matrixCellPhaseNumber(existing?.phase_number, 1),
      calendar_reserved: true,
      is_full_payment: false,
    };
    if (!student.first_enrolled_at && row.reserved_at) {
      student.first_enrolled_at = row.reserved_at;
    }
    if (!student.first_enrolled_month_key || monthKey < student.first_enrolled_month_key) {
      student.first_enrolled_month_key = monthKey;
    }
  }

  // Pending enrollment on Phase 1 / class-start month (not DP paid month).
  // enrolled_at is set when downpayment is paid (often earlier than class start). For
  // advance DP into a future class (e.g. May DP → July SOMO), the matrix cell must land
  // on the class start month. Installment tracks with only pending_enrollment have no
  // billing anchor yet, so the main billing-month query cannot place them.
  const pendingCalendarResult = await queryFn(
    `
      SELECT DISTINCT
        cs.student_id,
        cs.class_id,
        c.class_name,
        c.level_tag AS class_level_tag,
        u.full_name,
        COALESCE(cs.phase_number, 1) AS phase_number,
        TO_CHAR(
          GREATEST(
            DATE_TRUNC('month', TIMEZONE('Asia/Manila', cs.enrolled_at))::date,
            COALESCE(
              DATE_TRUNC('month', TIMEZONE('Asia/Manila', c.start_date))::date,
              DATE_TRUNC('month', TIMEZONE('Asia/Manila', cs.enrolled_at))::date
            )
          ),
          'YYYY-MM'
        ) AS month_key,
        cs.enrolled_at
      FROM classstudentstbl cs
      INNER JOIN classestbl c ON cs.class_id = c.class_id ${calendarBranchJoin}
      INNER JOIN userstbl u ON u.user_id = cs.student_id AND u.user_type = 'Student'
      WHERE cs.program_enrollment_status = 'pending_enrollment'
        AND cs.removed_at IS NULL
        AND cs.enrolled_at IS NOT NULL
        AND GREATEST(
          DATE_TRUNC('month', TIMEZONE('Asia/Manila', cs.enrolled_at))::date,
          COALESCE(
            DATE_TRUNC('month', TIMEZONE('Asia/Manila', c.start_date))::date,
            DATE_TRUNC('month', TIMEZONE('Asia/Manila', cs.enrolled_at))::date
          )
        ) >= $1::date
        AND GREATEST(
          DATE_TRUNC('month', TIMEZONE('Asia/Manila', cs.enrolled_at))::date,
          COALESCE(
            DATE_TRUNC('month', TIMEZONE('Asia/Manila', c.start_date))::date,
            DATE_TRUNC('month', TIMEZONE('Asia/Manila', cs.enrolled_at))::date
          )
        ) < $2::date
        ${calendarProgramJoin}
        ${calendarClassJoin}
        ${calendarTeacherJoin}
    `,
    calendarOverlayParams
  );

  for (const row of pendingCalendarResult.rows || []) {
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
    const existing = student.months[monthKey];
    if (
      existing?.mark === '1' &&
      ['new', 're_enrolled', 'upsell', 'rejoin', 'completed'].includes(
        String(existing.status || '').toLowerCase()
      )
    ) {
      continue;
    }
    student.months[monthKey] = {
      mark: '1',
      label: 'pending enrollment',
      status: 'pending_enrollment',
      phase_number: matrixCellPhaseNumber(row.phase_number, existing?.phase_number),
      calendar_pending_enrollment: true,
      is_full_payment: false,
    };
    if (!student.first_enrolled_at && row.enrolled_at) {
      student.first_enrolled_at = row.enrolled_at;
    }
    if (!student.first_enrolled_month_key || monthKey < student.first_enrolled_month_key) {
      student.first_enrolled_month_key = monthKey;
    }
  }

  // New by enrolled_at calendar month — applied last so it wins over billing-month dropped.
  // Match the installment plan start phase (phase_start when set, else phase 1). Later phases
  // stored as "new" in DB are continuations and stay on billing-month logic as re-enrolled.
  const newCalendarResult = await queryFn(
    `
      SELECT DISTINCT
        cs.student_id,
        cs.class_id,
        c.class_name,
        c.level_tag AS class_level_tag,
        u.full_name,
        COALESCE(cs.phase_number, 1) AS phase_number,
        TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM') AS month_key
      FROM classstudentstbl cs
      INNER JOIN classestbl c ON cs.class_id = c.class_id ${calendarBranchJoin}
      INNER JOIN userstbl u ON u.user_id = cs.student_id AND u.user_type = 'Student'
      WHERE cs.program_enrollment_status = 'new'
        AND cs.removed_at IS NULL
        AND COALESCE(cs.phase_number, 1) = COALESCE(${INSTALLMENT_PROFILE_PHASE_START_SUBQUERY}, 1)
        AND cs.enrolled_at IS NOT NULL
        AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date >= $1::date
        AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date < $2::date
        ${calendarProgramJoin}
        ${calendarClassJoin}
        ${calendarTeacherJoin}
    `,
    calendarOverlayParams
  );

  for (const row of newCalendarResult.rows || []) {
    const studentId = parseInt(row.student_id, 10);
    const classId = parseInt(row.class_id, 10);
    const monthKey = row.month_key;
    if (!displayMonthKeys.has(monthKey)) continue;

    const billingClasses = installmentProfileBillingByStudent.get(studentId);
    if (billingClasses?.size && !billingClasses.has(classId)) {
      continue;
    }

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
      const priorCell = student.months[monthKey];
      student.months[monthKey] = {
        mark: '1',
        label: 're-enrolled',
        status: 're_enrolled',
        phase_number: matrixCellPhaseNumber(priorCell?.phase_number, 1),
        calendar_continuation: true,
        is_full_payment: Boolean(priorCell?.is_full_payment),
      };
      continue;
    }

    const canonicalNewKey = resolveCanonicalFirstNewMonthKey(firstBillingKey, firstEverMonthKey);
    if (canonicalNewKey && monthKey !== canonicalNewKey) continue;

    student.months[monthKey] = {
      mark: '1',
      label: 'new',
      status: 'new',
      phase_number: matrixCellPhaseNumber(
        row.phase_number,
        student.months[monthKey]?.phase_number
      ),
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
      packageCompleteMonthByTrack,
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
      const isFirstEnrolledMonth = m.key === firstEnrolledKey;
      if (cell.status === 'upsell' && isFirstEnrolledMonth) {
        cell.label = 'upsell';
      } else if (cell.status === 'rejoin' || cell.calendar_rejoin) {
        cell.label = 'rejoin';
      } else if (
        isFirstEnrolledMonth &&
        ENROLLED_STATUSES_LIST.includes(cell.status) &&
        !['upsell', 'rejoin', 'completed'].includes(cell.status)
      ) {
        cell.label = 'new';
      } else if (cell.status === 'new' && !isFirstEnrolledMonth) {
        cell.label = 're-enrolled';
      } else if (cell.status === 're_enrolled' || cell.calendar_continuation) {
        cell.label = 're-enrolled';
      }
    }
  }

  applyDropRejoinGapMonthMatrixRules(students, months);

  applyUpsellMatrixDisplayRules(students, {
    periodKey: 'months',
    siblingTracksByStudent,
    displayMonthKeys,
  });

  // Keep upsell label stable for rate KPI (never treat as re-enrolled).
  for (const student of students) {
    for (const m of months) {
      const cell = student.months?.[m.key];
      if (!cell || cell.mark !== '1') continue;
      if (
        cell.status === 'upsell' ||
        cell.label === 'upsell' ||
        cell.display_upsell_synthetic ||
        cell.calendar_upsell
      ) {
        cell.label = 'upsell';
        cell.status = 'upsell';
      }
    }
  }

  // Final package billing month → "completed" (non-merged tracks only;
  // merged upsell anchors are handled during applyUpsellMonthMatrixSameRowRules).
  // Single-phase classes allow the terminal month to equal the first enrolled month.
  for (const student of students) {
    if (student.matrix_merged_upsell_anchor) continue;
    if (student.matrix_installment_class_id != null) continue;

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

    const terminalMonthKey = resolveTerminalCompletionMonthKey(student, firstEnrolledKey);
    if (terminalMonthKey && displayMonthKeys.has(terminalMonthKey)) {
      const lastCell = student.months[terminalMonthKey];
      if (lastCell?.mark === '1') {
        lastCell.label = 'completed';
        lastCell.status = 'completed';
      }
    }
  }

  const reservationTrackKeys = await loadReservationToEnrollmentTrackKeys(queryFn, {
    branchId,
    programId,
    classId,
    studentIds: [...new Set(students.map((s) => s.student_id))],
  });
  applyFromPreviousReservedCellFlags(students, 'months', reservationTrackKeys);

  applyInstallmentCrossClassDisplayMatrixLink(students, installmentProfileBillingByStudent);

  for (const student of students) {
    if (!student.months || student.matrix_installment_class_id == null) continue;
    for (const m of months) {
      const cell = student.months[m.key];
      if (!cell) continue;
      if (isDroppedMonthMatrixCell(cell)) {
        cell.label = 'dropped';
        cell.status = 'dropped';
      }
    }
  }

  // Soft-removed enrollments must not keep enrolled badges on/after the removal month
  // (Zion Capalad class 151: July "new" after Jul 23 unenroll inflated Total Active).
  clearEnrolledMatrixCellsRemovedOnOrBeforeBillingMonth(students, months, 'months');

  const lifecycleStudentIds = [...new Set(students.map((s) => s.student_id))];
  const lifecycleScope = {
    studentIds: lifecycleStudentIds,
    branchId,
    programId,
    classId,
    teacherId,
    lifecycleScope: true,
  };
  const {
    installmentTrackKeys,
    installmentCompleteByTrack,
    installmentProfileActiveByTrack,
  } = await loadInstallmentPaymentLifecycleContext(queryFn, lifecycleScope);
  const paymentLifecycleRows = await loadInstallmentInvoiceBillingLifecycle(
    queryFn,
    lifecycleScope
  );
  applyMatrixPaymentLifecycleOverlay(students, months, paymentLifecycleRows, {
    periodKey: 'months',
    installmentTrackKeys,
    installmentCompleteByTrack,
    installmentProfileActiveByTrack,
  });
  applyFullPaymentCompletedNextPeriodInactive(students, months, 'months');

  flagSinglePhaseCompletedCells(students, 'months');

  const visibleStudents = filterHiddenMatrixTracks(students);
  const cohortSize = visibleStudents.length;

  const kpiTotals = aggregateMonthMatrixKpiTotals(visibleStudents, months);
  const reEnrollmentStats = computeReEnrollmentMonthStats(months, visibleStudents, {
    selectedYear,
  });

  // kpi_totals.re_enrollment_count = Re-enrollment KPI card (visible re-enrolled labels).
  // month_stats / total_re_enrolled_count = rate numerator
  // (re-enrolled + Active + completed that follow prior new/re-enrolled; Inactive excluded).
  return {
    months,
    students: visibleStudents,
    month_stats: reEnrollmentStats.month_stats,
    cohort_size: cohortSize,
    total_re_enrolled_count: reEnrollmentStats.total_re_enrolled_count,
    total_prior_month_enrolled_count: reEnrollmentStats.total_prior_month_enrolled_count,
    total_re_enrollment_rate: reEnrollmentStats.total_re_enrollment_rate,
    kpi_totals: kpiTotals,
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
  let upsellCount = 0;
  let droppedUnenrolledCount = 0;
  let rejoinCount = 0;
  let reservedCount = 0;
  let completedCount = 0;
  let activeCompletedCount = 0;

  for (const student of students) {
    const cell = student.months?.[monthKey];
    if (!cell?.label) continue;
    if (cell.cleared_after_removal) continue;
    if (isMatrixCellRemovedOnOrBeforeBillingMonth(cell, monthKey)) continue;

    switch (cell.label) {
      case 'new':
        newEnrolleesCount += 1;
        break;
      case 're-enrolled':
        reEnrollmentCount += 1;
        break;
      case 'upsell':
        upsellCount += 1;
        break;
      case 'completed':
        completedCount += 1;
        if (resolveMatrixTrackPhaseCountForCompletionKpi(student, cell) > 1) {
          activeCompletedCount += 1;
        }
        break;
      case 'reserved':
        reservedCount += 1;
        break;
      case 'dropped':
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
    upsell_count: upsellCount,
    reserved_count: reservedCount,
    completed_count: completedCount,
    /** Multi-phase completed only — used for Total Active Students (not Re-enrollment KPI). */
    active_completed_count: activeCompletedCount,
    dropped_unenrolled_count: droppedUnenrolledCount,
    rejoin_count: rejoinCount,
  };
};

/**
 * Count matrix cell labels for one display phase (after display rules).
 * Matches visible cells on the Phase Re-enrollment matrix table.
 */
export const countPhaseMatrixStatusLabels = (students, phaseKey) => {
  let newEnrolleesCount = 0;
  let reEnrollmentCount = 0;
  let upsellCount = 0;
  let droppedUnenrolledCount = 0;
  let rejoinCount = 0;
  let reservedCount = 0;

  for (const student of students) {
    const cell = student.phases?.[phaseKey];
    if (!cell?.label) continue;

    switch (cell.label) {
      case 'new':
        newEnrolleesCount += 1;
        break;
      case 're-enrolled':
        reEnrollmentCount += 1;
        break;
      case 'upsell':
        upsellCount += 1;
        break;
      case 'completed':
        break;
      case 'reserved':
        reservedCount += 1;
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
    upsell_count: upsellCount,
    reserved_count: reservedCount,
    dropped_unenrolled_count: droppedUnenrolledCount,
    rejoin_count: rejoinCount,
  };
};

/** Sum status labels across all months in a month matrix (selected year scope). */
export const aggregateMonthMatrixKpiTotals = (students, months = []) => {
  const totals = {
    new_enrollees_count: 0,
    re_enrollment_count: 0,
    upsell_count: 0,
    reserved_count: 0,
    dropped_count: 0,
    rejoin_count: 0,
  };

  for (const month of months) {
    const counts = countMonthMatrixStatusLabels(students, month.key);
    totals.new_enrollees_count += counts.new_enrollees_count;
    totals.re_enrollment_count += counts.re_enrollment_count;
    totals.upsell_count += counts.upsell_count;
    totals.reserved_count += counts.reserved_count;
    totals.dropped_count += counts.dropped_unenrolled_count;
    totals.rejoin_count += counts.rejoin_count;
  }

  return totals;
};

/** Sum status labels across all phases in a phase matrix (year scope when matrix is year-filtered). */
export const aggregatePhaseMatrixKpiTotals = (students, phases = []) => {
  const totals = {
    new_enrollees_count: 0,
    re_enrollment_count: 0,
    upsell_count: 0,
    reserved_count: 0,
    dropped_count: 0,
    rejoin_count: 0,
  };

  for (const phase of phases) {
    const counts = countPhaseMatrixStatusLabels(students, phase.key);
    totals.new_enrollees_count += counts.new_enrollees_count;
    totals.re_enrollment_count += counts.re_enrollment_count;
    totals.upsell_count += counts.upsell_count;
    totals.reserved_count += counts.reserved_count;
    totals.dropped_count += counts.dropped_unenrolled_count;
    totals.rejoin_count += counts.rejoin_count;
  }

  return totals;
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
    /**
     * Rate retained numerator: re-enrolled + completed with prior new/re-enrolled.
     * KPI re_enrollment_count remains visible re-enrolled labels only.
     */
    re_enrollment_count: statusCounts.re_enrollment_count,
    re_enrollment_rate_retained_count: monthRateStat?.re_enrolled_count ?? statusCounts.re_enrollment_count,
    re_enrollment_rate_prior_count: monthRateStat?.prior_month_enrolled_count ?? 0,
    re_enrollment_rate: monthRateStat?.re_enrollment_rate ?? null,
    has_prior_month: Boolean(monthRateStat?.has_prior_month),
  };
};

const mapMonthMatrixStatsToOperationalBranchRow = (branchId, stats) => ({
  branch_id: branchId,
  new_enrollees: parseInt(stats.new_enrollees_count, 10) || 0,
  re_enrollment_count: parseInt(stats.re_enrollment_count, 10) || 0,
  upsell_count: parseInt(stats.upsell_count, 10) || 0,
  reserved_count: parseInt(stats.reserved_count, 10) || 0,
  completed_count: parseInt(stats.completed_count, 10) || 0,
  active_completed_count: parseInt(stats.active_completed_count, 10) || 0,
  rejoin_count: parseInt(stats.rejoin_count, 10) || 0,
  dropped_unenrolled_count: parseInt(stats.dropped_unenrolled_count, 10) || 0,
  retention_base_count: parseInt(stats.re_enrollment_rate_prior_count, 10) || 0,
});

/**
 * Monthly operational enrollment KPIs from the Month Re-enrollment matrix (billing month column).
 * Same labels and rules as the matrix table for the selected calendar month.
 */
export async function loadMonthlyOperationalEnrollmentFromMonthMatrix(queryFn, options = {}) {
  const { branchId = null, summaryMonth = null, branches = [] } = options;
  const monthKey = String(summaryMonth || '').trim().slice(0, 7);

  const emptyTotals = {
    new_enrollees: 0,
    re_enrollment_count: 0,
    upsell_count: 0,
    reserved_count: 0,
    completed_count: 0,
    active_completed_count: 0,
    rejoin_count: 0,
    dropped_unenrolled_count: 0,
    retention_base_count: 0,
    retention_re_enrollment_count: 0,
  };

  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    return {
      by_branch: [],
      totals: emptyTotals,
      source: 'month_re_enrollment_matrix',
      summary_month: null,
      ...emptyTotals,
      re_enrollment_rate: 0,
      re_enrollment_rate_retained_count: 0,
      re_enrollment_rate_prior_count: 0,
      prior_period_label: null,
      prior_period_type: null,
      retention_rate_mode: 'month_matrix_billing_month',
    };
  }

  const branchTargets = branchId
    ? [{ branch_id: branchId }]
    : (branches || []).filter((b) => b?.branch_id != null);

  const byBranch = await Promise.all(
    branchTargets.map(async (branch) => {
      const stats = await loadMonthMatrixOperationalStatsForMonth(queryFn, {
        branchId: branch.branch_id,
        monthKey,
      });
      return mapMonthMatrixStatsToOperationalBranchRow(branch.branch_id, stats);
    })
  );

  const totals = byBranch.reduce(
    (acc, row) => ({
      new_enrollees: acc.new_enrollees + row.new_enrollees,
      re_enrollment_count: acc.re_enrollment_count + row.re_enrollment_count,
      upsell_count: acc.upsell_count + row.upsell_count,
      reserved_count: acc.reserved_count + row.reserved_count,
      completed_count: acc.completed_count + row.completed_count,
      active_completed_count: acc.active_completed_count + (row.active_completed_count || 0),
      rejoin_count: acc.rejoin_count + row.rejoin_count,
      dropped_unenrolled_count: acc.dropped_unenrolled_count + row.dropped_unenrolled_count,
      retention_base_count: acc.retention_base_count + row.retention_base_count,
      retention_re_enrollment_count: acc.retention_re_enrollment_count + row.re_enrollment_count,
    }),
    { ...emptyTotals }
  );

  const rateMetrics = await loadOperationalReEnrollmentRateFromMonthMatrix(queryFn, {
    branchId,
    summaryMonth: monthKey,
  });

  return {
    by_branch: byBranch,
    totals,
    source: 'month_re_enrollment_matrix',
    summary_month: monthKey,
    ...rateMetrics,
    retention_re_enrollment_count: rateMetrics.re_enrollment_rate_retained_count ?? totals.re_enrollment_count,
    retention_base_count: rateMetrics.retention_base_count ?? totals.retention_base_count,
  };
}

/** @deprecated Use loadMonthMatrixOperationalStatsForMonth */
export const loadMonthReEnrollmentStatForMonth = loadMonthMatrixOperationalStatsForMonth;

/**
 * Whether a month-matrix cell counts as "active" for Reports → Student Status and
 * Monthly Operational Dashboard total active students
 * (new + re-enrollment + rejoin + upsell).
 * Re-enrollment includes visible re-enrolled and completed cells in the rate numerator.
 * Soft-removed enrollments on/before the billing month do not count.
 */
export const isMonthMatrixCellActiveForOperationalDashboard = (cell, student, monthKey = null) => {
  if (!cell?.label) return false;
  if (monthKey && isMatrixCellRemovedOnOrBeforeBillingMonth(cell, monthKey)) return false;
  if (cell.cleared_after_removal) return false;
  // Lifecycle Inactive (X) never counts toward Total Active / Student Status —
  // same month column as Month Re-enrollment overlay.
  if (isVisibleInactiveLifecycleCell(cell)) return false;
  const label = String(cell.label).trim().toLowerCase();
  if (label === 'new' || label === 'rejoin' || label === 'upsell') return true;
  if (label === 're-enrolled' || label === 're_enrolled') return true;
  // Multi-phase completed still counts toward Total Active Students (not Re-enrollment KPI).
  if (label === 'completed') {
    return resolveMatrixTrackPhaseCountForCompletionKpi(student, cell) > 1;
  }
  return false;
};

/**
 * @param {object[]} students - matrix tracks from loadStudentMonthEnrollmentMatrix
 * @param {string} monthKey - YYYY-MM
 * @returns {Map<number, { labels: Set<string>, trackCount: number }>}
 */
export const buildMonthMatrixActiveStudentIndex = (students, monthKey) => {
  const byStudentId = new Map();
  for (const track of students || []) {
    const cell = track.months?.[monthKey];
    if (!isMonthMatrixCellActiveForOperationalDashboard(cell, track, monthKey)) continue;
    const sid = Number(track.student_id);
    if (!Number.isFinite(sid) || sid <= 0) continue;
    if (!byStudentId.has(sid)) {
      byStudentId.set(sid, { labels: new Set(), trackCount: 0 });
    }
    const entry = byStudentId.get(sid);
    entry.labels.add(String(cell.label));
    entry.trackCount += 1;
  }
  return byStudentId;
};

/**
 * One entry per active matrix track/cell for the billing month.
 * Length matches Monthly Operational Dashboard Total Active Students
 * (cell sum — same student on two classes counts twice).
 *
 * @param {object[]} students - matrix tracks from loadStudentMonthEnrollmentMatrix
 * @param {string} monthKey - YYYY-MM
 * @returns {Array<{
 *   student_id: number,
 *   class_id: number|null,
 *   class_name: string,
 *   class_level_tag: string,
 *   full_name: string,
 *   matrix_label: string,
 *   enrollment_track_key: string|null,
 * }>}
 */
export const buildMonthMatrixActiveTrackRows = (students, monthKey) => {
  const rows = [];
  for (const track of students || []) {
    const cell = track.months?.[monthKey];
    if (!isMonthMatrixCellActiveForOperationalDashboard(cell, track, monthKey)) continue;
    const sid = Number(track.student_id);
    if (!Number.isFinite(sid) || sid <= 0) continue;
    rows.push({
      student_id: sid,
      class_id: track.class_id != null ? Number(track.class_id) : null,
      class_name: track.class_name || '',
      class_level_tag: track.class_level_tag || '',
      full_name: track.full_name || track.student_name || '',
      matrix_label: String(cell.label || '').trim(),
      enrollment_track_key: track.enrollment_track_key || null,
    });
  }
  rows.sort((a, b) => {
    const nameCmp = String(a.full_name || '').localeCompare(String(b.full_name || ''), undefined, {
      sensitivity: 'base',
    });
    if (nameCmp !== 0) return nameCmp;
    return String(a.class_name || '').localeCompare(String(b.class_name || ''), undefined, {
      sensitivity: 'base',
    });
  });
  return rows;
};
