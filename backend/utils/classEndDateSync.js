/**
 * Keep classestbl.end_date aligned with the last scheduled class session (calendar end of class).
 * Uses MAX(scheduled_date) over non-cancelled sessions.
 *
 * @param {{ query: Function }} db - pg client or pool (same .query API)
 * @param {number} classId
 * @returns {Promise<{ updated: boolean, previous_end_date: string|null, end_date: string|null }>}
 */
export async function syncClassEndDateFromSessions(db, classId) {
  const maxRes = await db.query(
    `SELECT MAX(scheduled_date)::date AS max_date
     FROM classsessionstbl
     WHERE class_id = $1
       AND COALESCE(status, 'Scheduled') != 'Cancelled'`,
    [classId]
  );

  const maxDate = maxRes.rows[0]?.max_date;
  if (!maxDate) {
    return { updated: false, previous_end_date: null, end_date: null };
  }

  const ymd =
    maxDate instanceof Date
      ? `${maxDate.getFullYear()}-${String(maxDate.getMonth() + 1).padStart(2, '0')}-${String(maxDate.getDate()).padStart(2, '0')}`
      : String(maxDate).slice(0, 10);

  const prevRes = await db.query(`SELECT end_date::text AS d FROM classestbl WHERE class_id = $1`, [classId]);
  const previous = prevRes.rows[0]?.d ? String(prevRes.rows[0].d).slice(0, 10) : null;

  if (previous === ymd) {
    return { updated: false, previous_end_date: previous, end_date: ymd };
  }

  await db.query(`UPDATE classestbl SET end_date = $1::date WHERE class_id = $2`, [ymd, classId]);

  return { updated: true, previous_end_date: previous, end_date: ymd };
}
