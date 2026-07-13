/**
 * Reports → Student Status tab: active/inactive from Month Re-enrollment matrix rules
 * (same as Monthly Operational Dashboard total active students).
 *
 * Active list = one row per active matrix track/cell (matches dashboard Total Active
 * cell sum — e.g. one student on two July classes appears twice).
 */

import {
  buildMonthMatrixActiveStudentIndex,
  buildMonthMatrixActiveTrackRows,
  loadStudentMonthEnrollmentMatrix,
} from '../enrollmentRateMetrics.js';

export const resolveManilaMonthKey = (monthInput) => {
  const raw = String(monthInput || '').trim().slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const manila = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  return `${manila.getFullYear()}-${String(manila.getMonth() + 1).padStart(2, '0')}`;
};

const matchesSearch = (row, searchTerm) => {
  if (!searchTerm) return true;
  const q = searchTerm.toLowerCase();
  return [
    row.full_name,
    row.email,
    row.level_tag,
    row.branch_name,
    row.class_name,
    row.matrix_labels,
  ].some((v) => String(v || '').toLowerCase().includes(q));
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
 *   forExport?: boolean,
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
    forExport = false,
  } = options;

  const monthKey = resolveManilaMonthKey(summaryMonth);
  const year = parseInt(monthKey.slice(0, 4), 10);
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const maxLimit = forExport ? 10000 : 100;
  const limitNum = Math.min(maxLimit, Math.max(1, parseInt(limit, 10) || 10));
  const offset = (pageNum - 1) * limitNum;
  const searchTerm = String(search || '').trim();

  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    branchId,
    year,
  });
  const activeTrackRows = buildMonthMatrixActiveTrackRows(matrix.students || [], monthKey);
  const activeIndex = buildMonthMatrixActiveStudentIndex(matrix.students || [], monthKey);
  const activeIds = [...activeIndex.keys()];
  const activeTrackCount = activeTrackRows.length;
  const uniqueActiveCount = activeIds.length;

  const branchParams = branchId ? [branchId] : [];
  const branchWhere = branchId ? 'AND u.branch_id = $1' : '';
  const branchTotalRes = await queryFn(
    `SELECT COUNT(*)::int AS total
     FROM userstbl u
     WHERE LOWER(u.user_type) = 'student' ${branchWhere}`,
    branchParams
  );
  const branchStudentTotal = parseInt(branchTotalRes.rows[0]?.total || '0', 10);
  const inactiveStudents = Math.max(0, branchStudentTotal - uniqueActiveCount);

  const emptyMeta = {
    summary_month: monthKey,
    source: 'month_re_enrollment_matrix',
    active_students: activeTrackCount,
    active_unique_students: uniqueActiveCount,
    inactive_students: inactiveStudents,
  };

  if (status === 'active') {
    if (!activeTrackRows.length) {
      return {
        rows: [],
        pagination: { page: pageNum, limit: limitNum, total: 0, totalPages: 1 },
        meta: emptyMeta,
      };
    }

    const studentIds = [...new Set(activeTrackRows.map((t) => t.student_id))];
    const userParams = [studentIds];
    let userWhere = `WHERE u.user_id = ANY($1::int[]) AND LOWER(u.user_type) = 'student'`;
    if (branchId) {
      userParams.push(branchId);
      userWhere += ` AND u.branch_id = $2`;
    }

    const usersRes = await queryFn(
      `SELECT
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
       ${userWhere}`,
      userParams
    );
    const userById = new Map(usersRes.rows.map((r) => [Number(r.user_id), r]));

    let expanded = activeTrackRows
      .map((track) => {
        const user = userById.get(track.student_id);
        if (!user) return null;
        return {
          ...user,
          status: 'active',
          matrix_month: monthKey,
          matrix_labels: track.matrix_label || null,
          matrix_active_tracks: 1,
          class_id: track.class_id,
          class_name: track.class_name || null,
          class_level_tag: track.class_level_tag || null,
          enrollment_track_key: track.enrollment_track_key,
          row_key: `${track.student_id}:${track.class_id ?? 'x'}:${track.matrix_label}`,
        };
      })
      .filter(Boolean)
      .filter((row) => matchesSearch(row, searchTerm));

    expanded.sort((a, b) => {
      const nameCmp = String(a.full_name || '').localeCompare(String(b.full_name || ''), undefined, {
        sensitivity: 'base',
      });
      if (nameCmp !== 0) return nameCmp;
      return String(a.class_name || '').localeCompare(String(b.class_name || ''), undefined, {
        sensitivity: 'base',
      });
    });

    const total = expanded.length;
    const rows = expanded.slice(offset, offset + limitNum);

    return {
      rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
      meta: emptyMeta,
    };
  }

  // inactive / all: unique students, with active students expanded to track rows when status=all
  const params = [];
  let paramCount = 0;
  let whereSql = ` WHERE LOWER(u.user_type) = 'student'`;

  if (branchId) {
    paramCount += 1;
    whereSql += ` AND u.branch_id = $${paramCount}`;
    params.push(branchId);
  }

  if (status === 'inactive') {
    if (activeIds.length) {
      paramCount += 1;
      whereSql += ` AND NOT (u.user_id = ANY($${paramCount}::int[]))`;
      params.push(activeIds);
    }
  }

  if (searchTerm && status === 'inactive') {
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

  if (status === 'inactive') {
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
    const rows = result.rows.map((row) => ({
      ...row,
      status: 'inactive',
      matrix_month: monthKey,
      matrix_labels: null,
      matrix_active_tracks: 0,
      class_id: null,
      class_name: null,
      row_key: `inactive:${row.user_id}`,
    }));

    return {
      rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
      meta: emptyMeta,
    };
  }

  // status === 'all': active track rows + inactive unique students
  const allUsersRes = await queryFn(
    `${baseSql} ${whereSql} ORDER BY COALESCE(ss.student_name, u.full_name) ASC`,
    params
  );
  const userById = new Map(allUsersRes.rows.map((r) => [Number(r.user_id), r]));

  const combined = [];
  for (const track of activeTrackRows) {
    const user = userById.get(track.student_id);
    if (!user) continue;
    combined.push({
      ...user,
      status: 'active',
      matrix_month: monthKey,
      matrix_labels: track.matrix_label || null,
      matrix_active_tracks: 1,
      class_id: track.class_id,
      class_name: track.class_name || null,
      class_level_tag: track.class_level_tag || null,
      enrollment_track_key: track.enrollment_track_key,
      row_key: `${track.student_id}:${track.class_id ?? 'x'}:${track.matrix_label}`,
    });
  }
  for (const row of allUsersRes.rows) {
    if (activeIndex.has(Number(row.user_id))) continue;
    combined.push({
      ...row,
      status: 'inactive',
      matrix_month: monthKey,
      matrix_labels: null,
      matrix_active_tracks: 0,
      class_id: null,
      class_name: null,
      row_key: `inactive:${row.user_id}`,
    });
  }

  const filtered = combined.filter((row) => matchesSearch(row, searchTerm));
  filtered.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    const nameCmp = String(a.full_name || '').localeCompare(String(b.full_name || ''), undefined, {
      sensitivity: 'base',
    });
    if (nameCmp !== 0) return nameCmp;
    return String(a.class_name || '').localeCompare(String(b.class_name || ''), undefined, {
      sensitivity: 'base',
    });
  });

  const total = filtered.length;
  const rows = filtered.slice(offset, offset + limitNum);

  return {
    rows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
    },
    meta: emptyMeta,
  };
}
