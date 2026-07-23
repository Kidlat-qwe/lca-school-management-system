/**
 * Helpers for merchandise-request SQL that may reference optional columns
 * (updated_at / inventory_processed_by) depending on which migrations ran.
 */

export function isMissingColumnError(error, columnName) {
  if (!error) return false;
  const msg = String(error.message || '');
  return error.code === '42703' || msg.includes(`"${columnName}"`) || msg.includes(columnName);
}

/** Strip `updated_at = CURRENT_TIMESTAMP` from SET clauses (no bound params). */
export function stripUpdatedAtAssignment(sql) {
  return String(sql).replace(/,?\s*updated_at\s*=\s*CURRENT_TIMESTAMP/gi, '');
}

/**
 * Run a query; if Postgres reports missing `updated_at`, retry with that
 * assignment stripped. Safe when the SET fragment is
 * `updated_at = CURRENT_TIMESTAMP` (no bound params).
 */
export async function runIgnoringMissingUpdatedAt(run, sql, params = []) {
  try {
    return await run(sql, params);
  } catch (error) {
    if (!isMissingColumnError(error, 'updated_at')) throw error;
    const stripped = stripUpdatedAtAssignment(sql);
    console.warn(
      '[merchandise-request] updated_at column missing — retrying without it. Run migration 130.'
    );
    return await run(stripped, params);
  }
}
