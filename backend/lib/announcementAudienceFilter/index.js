/**
 * Announcement academic audience (program / class) helpers.
 * Empty program_ids / class_ids = all programs / all classes.
 *
 * Active students (Reports → Active enrollment / class ops):
 * program_enrollment_status IN ('new','re_enrolled','upsell','rejoin')
 * AND removed_at IS NULL.
 * Students (and Guardians via their student) must be active to receive
 * board visibility and emails — even when program/class is unrestricted.
 */

export const ACTIVE_STUDENT_ENROLLMENT_STATUSES = [
  'new',
  're_enrolled',
  'upsell',
  'rejoin',
];

/**
 * Normalize API body values to a clean integer id array.
 * Empty / missing / "all" → [].
 */
export function normalizeAudienceIdList(value) {
  if (value == null || value === '' || value === 'all' || value === 'All') return [];
  const list = Array.isArray(value) ? value : [value];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    if (raw == null || raw === '' || raw === 'all' || raw === 'All') continue;
    const n = parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function hasAudienceRestriction(programIds = [], classIds = []) {
  return (
    (Array.isArray(programIds) && programIds.length > 0) ||
    (Array.isArray(classIds) && classIds.length > 0)
  );
}

/**
 * SQL EXISTS: student user id is actively enrolled (optionally narrowed by
 * announcement program_ids / class_ids on alias).
 * @param {string} studentUserIdExpr - e.g. `$1` or `u.user_id`
 * @param {object} [opts]
 * @param {string} [opts.announcementAlias='a'] - announcement row with program_ids/class_ids
 * @param {boolean} [opts.applyProgramClassFilters=true]
 */
export function sqlStudentIsActivelyEnrolled(
  studentUserIdExpr,
  { announcementAlias = 'a', applyProgramClassFilters = true } = {}
) {
  const alias = announcementAlias;
  const programClassPred = applyProgramClassFilters
    ? `
      AND (
        (
          COALESCE(cardinality(${alias}.class_ids), 0) > 0
          AND cs.class_id = ANY(${alias}.class_ids)
        )
        OR (
          COALESCE(cardinality(${alias}.class_ids), 0) = 0
          AND (
            COALESCE(cardinality(${alias}.program_ids), 0) = 0
            OR c.program_id = ANY(${alias}.program_ids)
          )
        )
      )
    `
    : '';

  return `
    EXISTS (
      SELECT 1
      FROM classstudentstbl cs
      INNER JOIN classestbl c ON c.class_id = cs.class_id
      WHERE cs.student_id = ${studentUserIdExpr}
        AND cs.removed_at IS NULL
        AND cs.program_enrollment_status = ANY(ARRAY['new','re_enrolled','upsell','rejoin']::text[])
        ${programClassPred}
    )
  `;
}

/**
 * SQL fragment: announcement row `a` matches student user id param.
 * Always requires active enrollment; program/class further narrow when set.
 * @param {number} userIdParamIndex - e.g. 1 for $1
 * @param {string} [alias='a']
 */
export function sqlAnnouncementMatchesStudentAudience(userIdParamIndex, alias = 'a') {
  const u = `$${userIdParamIndex}`;
  return `(${sqlStudentIsActivelyEnrolled(u, { announcementAlias: alias, applyProgramClassFilters: true })})`;
}

/**
 * SQL fragment: announcement row `a` matches teacher user id param.
 */
export function sqlAnnouncementMatchesTeacherAudience(userIdParamIndex, alias = 'a') {
  const u = `$${userIdParamIndex}`;
  return `
    (
      (
        COALESCE(cardinality(${alias}.program_ids), 0) = 0
        AND COALESCE(cardinality(${alias}.class_ids), 0) = 0
      )
      OR EXISTS (
        SELECT 1
        FROM classestbl c
        WHERE (
            c.teacher_id = ${u}
            OR EXISTS (
              SELECT 1
              FROM classteacherstbl ct
              WHERE ct.class_id = c.class_id
                AND ct.teacher_id = ${u}
            )
          )
          AND (
            (
              COALESCE(cardinality(${alias}.class_ids), 0) > 0
              AND c.class_id = ANY(${alias}.class_ids)
            )
            OR (
              COALESCE(cardinality(${alias}.class_ids), 0) = 0
              AND (
                COALESCE(cardinality(${alias}.program_ids), 0) = 0
                OR c.program_id = ANY(${alias}.program_ids)
              )
            )
          )
      )
    )
  `;
}

/**
 * Whether the current user type should be restricted by program/class audience.
 */
export function userTypeUsesAcademicAudience(userType) {
  return userType === 'Student' || userType === 'Teacher';
}
