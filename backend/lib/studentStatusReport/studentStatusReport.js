/**
 * Reports → Student Status tab: active/inactive from Month Re-enrollment matrix rules
 * (same as Monthly Operational Dashboard total active students).
 */

import {
  buildMonthMatrixActiveStudentIndex,
  loadStudentMonthEnrollmentMatrix,
} from '../enrollmentRateMetrics.js';

export const resolveManilaMonthKey = (monthInput) => {
  const raw = String(monthInput || '').trim().slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const manila = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  return `${manila.getFullYear()}-${String(manila.getMonth() + 1).padStart(2, '0')}`;
};

const formatMatrixLabels = (labelSet) => {
  if (!labelSet?.size) return null;
  return [...labelSet].sort().join(', ');
};

/**
 * @param {Function} queryFn
 * @param {{
 *   branchId?: number|null,
 *   summaryMonth?: string|null,
 *   status?: 'all'|'active'|'inactive',
 *   search?: string,
 *   page?: number,
 *   limit?: number,
 * }} options
 */
export async function loadStudentStatusReportPage(queryFn, options = {}) {
  const {
    branchId = null,
    summaryMonth = null,
    status = 'all',
    search = '',
    page = 1,
    limit = 10,
  } = options;

  const monthKey = resolveManilaMonthKey(summaryMonth);
  const year = parseInt(monthKey.slice(0, 4), 10);
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
  const offset = (pageNum - 1) * limitNum;
  const searchTerm = String(search || '').trim();

  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    branchId,
    year,
  });
  const activeIndex = buildMonthMatrixActiveStudentIndex(matrix.students || [], monthKey);
  const activeIds = [...activeIndex.keys()];

  const params = [];
  let paramCount = 0;
  let whereSql = ` WHERE LOWER(u.user_type) = 'student'`;

  if (branchId) {
    paramCount += 1;
    whereSql += ` AND u.branch_id = $${paramCount}`;
    params.push(branchId);
  }

  if (status === 'active') {
    if (!activeIds.length) {
      return {
        rows: [],
        pagination: { page: pageNum, limit: limitNum, total: 0, totalPages: 1 },
        meta: {
          summary_month: monthKey,
          source: 'month_re_enrollment_matrix',
          active_students: 0,
          inactive_students: 0,
        },
      };
    }
    paramCount += 1;
    whereSql += ` AND u.user_id = ANY($${paramCount}::int[])`;
    params.push(activeIds);
  } else if (status === 'inactive') {
    if (activeIds.length) {
      paramCount += 1;
      whereSql += ` AND NOT (u.user_id = ANY($${paramCount}::int[]))`;
      params.push(activeIds);
    }
  }

  if (searchTerm) {
    paramCount += 1;
    whereSql += ` AND (
      COALESCE(ss.student_name, u.full_name, '') ILIKE $${paramCount}
      OR COALESCE(u.email, '') ILIKE $${paramCount}
      OR COALESCE(u.level_tag, '') ILIKE $${paramCount}
      OR COALESCE(b.branch_nickname, b.branch_name, '') ILIKE $${paramCount}
    )`;
    params.push(`%${searchTerm}%`);
  }

  const baseSql = `
    SELECT
      ss.student_status_id,
      u.user_id,
      COALESCE(ss.student_name, u.full_name) AS full_name,
      u.email,
      u.level_tag,
      COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
      u.branch_id,
      ss.updated_at,
      ss.updated_reason
    FROM public.userstbl u
    LEFT JOIN public.student_statustbl ss ON ss.student_id = u.user_id
    LEFT JOIN public.branchestbl b ON b.branch_id = u.branch_id
  `;

  const countResult = await queryFn(`SELECT COUNT(*) AS total FROM (${baseSql} ${whereSql}) t`, params);
  const total = parseInt(countResult.rows[0]?.total || '0', 10);

  const dataSql = `
    ${baseSql}
    ${whereSql}
    ORDER BY COALESCE(ss.student_name, u.full_name) ASC
    LIMIT $${paramCount + 1}
    OFFSET $${paramCount + 2}
  `;
  const result = await queryFn(dataSql, [...params, limitNum, offset]);

  const rows = result.rows.map((row) => {
    const activeEntry = activeIndex.get(Number(row.user_id));
    const isActive = Boolean(activeEntry);
    return {
      ...row,
      status: isActive ? 'active' : 'inactive',
      matrix_month: monthKey,
      matrix_labels: formatMatrixLabels(activeEntry?.labels),
      matrix_active_tracks: activeEntry?.trackCount ?? 0,
    };
  });

  const branchParams = branchId ? [branchId] : [];
  const branchWhere = branchId ? 'AND u.branch_id = $1' : '';
  const branchTotalRes = await queryFn(
    `SELECT COUNT(*)::int AS total
     FROM userstbl u
     WHERE LOWER(u.user_type) = 'student' ${branchWhere}`,
    branchParams
  );
  const branchStudentTotal = parseInt(branchTotalRes.rows[0]?.total || '0', 10);
  const activeStudents = activeIds.length;
  const inactiveStudents = Math.max(0, branchStudentTotal - activeStudents);

  return {
    rows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
    },
    meta: {
      summary_month: monthKey,
      source: 'month_re_enrollment_matrix',
      active_students: activeStudents,
      inactive_students: inactiveStudents,
    },
  };
}
