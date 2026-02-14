import { query } from '../config/database.js';

/**
 * Holiday service - uses custom holidays from the database (Holidays page).
 * No hardcoded national holidays; all holidays are managed via the Holidays page.
 */

/**
 * Fetch holiday dates from custom_holidaystbl for a date range.
 * Returns global holidays (branch_id IS NULL) + branch-specific holidays when branchId is provided.
 *
 * @param {string} startYmd - Start date YYYY-MM-DD
 * @param {string} endYmd - End date YYYY-MM-DD
 * @param {number|null} branchId - Optional branch ID; when set, includes global + branch-specific holidays
 * @param {Function} [queryFn] - Optional query function (for migrations); defaults to config/database query
 * @returns {Promise<Set<string>>} Set of YYYY-MM-DD date strings
 */
export async function getCustomHolidayDateSetForRange(startYmd, endYmd, branchId = null, queryFn = null) {
  if (!startYmd || !endYmd || startYmd > endYmd) {
    return new Set();
  }

  const q = queryFn || query;
  let sql = `
    SELECT holiday_date::text as date
    FROM custom_holidaystbl
    WHERE holiday_date >= $1 AND holiday_date <= $2
  `;
  const params = [startYmd, endYmd];
  if (branchId != null) {
    sql += ' AND (branch_id IS NULL OR branch_id = $3)';
    params.push(branchId);
  }
  const result = await q(sql, params);
  return new Set(result.rows.map((r) => r.date).filter(Boolean));
}

