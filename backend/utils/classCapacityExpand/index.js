/**
 * Raise class max_students when active headcount exceeds the configured max
 * (e.g. dropped-student rejoin into a full class → display becomes 11/11).
 *
 * New package enroll / reserve still use the stored max as a hard cap until
 * a rejoin expands it.
 *
 * @param {import('pg').PoolClient} client
 * @param {number|string} classId
 * @returns {Promise<{ max_students: number, active_count: number } | null>}
 */
export async function expandClassMaxStudentsToFitActiveCount(client, classId) {
  if (classId == null || classId === '') return null;

  const result = await client.query(
    `UPDATE classestbl c
     SET max_students = sub.active_count
     FROM (
       SELECT COUNT(DISTINCT student_id)::int AS active_count
       FROM classstudentstbl
       WHERE class_id = $1
         AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
         AND removed_at IS NULL
     ) sub
     WHERE c.class_id = $1
       AND c.max_students IS NOT NULL
       AND sub.active_count > c.max_students
     RETURNING c.max_students, sub.active_count`,
    [classId]
  );

  return result.rows[0] || null;
}

/**
 * True when enrollment came from a rejoin payment / rejoin invoice path.
 * @param {string|null|undefined} sourceLabel
 */
export function isRejoinEnrollmentSourceLabel(sourceLabel) {
  return /rejoin/i.test(String(sourceLabel || ''));
}
