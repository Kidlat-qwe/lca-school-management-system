/**
 * Keeps classsessionstbl teacher fields aligned with the class primary teacher.
 * Skips sessions that have an active substitute assignment.
 */

/**
 * @param {import('pg').PoolClient} client
 * @param {number} classId
 * @param {number|null} primaryTeacherId
 * @param {{ onlyWithoutSubstitute?: boolean }} [options]
 * @returns {Promise<{ updated: number }>}
 */
export async function syncClassSessionTeachersFromClass(
  client,
  classId,
  primaryTeacherId,
  options = {}
) {
  const { onlyWithoutSubstitute = true } = options;

  if (!classId || !primaryTeacherId) {
    return { updated: 0 };
  }

  const substituteClause = onlyWithoutSubstitute ? 'AND substitute_teacher_id IS NULL' : '';

  const result = await client.query(
    `UPDATE classsessionstbl
     SET assigned_teacher_id = $1,
         original_teacher_id = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE class_id = $2
       ${substituteClause}
       AND (
         assigned_teacher_id IS DISTINCT FROM $1
         OR original_teacher_id IS DISTINCT FROM $1
       )`,
    [primaryTeacherId, classId]
  );

  return { updated: result.rowCount || 0 };
}
