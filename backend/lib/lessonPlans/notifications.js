import { query } from '../../config/database.js';

/**
 * Insert per-user system notifications (announcementstbl + target_user_id)
 * for lesson plan submit / approve / revision events.
 */

async function getConfiguredVerifierUserIds() {
  const result = await query(
    `
    SELECT v.user_id
    FROM lesson_plan_verifierstbl v
    INNER JOIN userstbl u ON u.user_id = v.user_id
    WHERE u.user_type = 'Superadmin'
    `
  );
  return result.rows.map((r) => Number(r.user_id)).filter((id) => id > 0);
}

async function getAllSuperadminUserIds() {
  const result = await query(
    `SELECT user_id FROM userstbl WHERE user_type = 'Superadmin'`
  );
  return result.rows.map((r) => Number(r.user_id)).filter((id) => id > 0);
}

async function insertTargetedNotification({
  title,
  body,
  createdBy,
  targetUserId,
  branchId = null,
  navigationQuery = '',
}) {
  await query(
    `
    INSERT INTO announcementstbl (
      title, body, recipient_groups, status, priority,
      branch_id, created_by, target_user_id, navigation_key, navigation_query
    ) VALUES (
      $1, $2, $3, 'Active', 'High',
      $4, $5, $6, 'lesson-plans', $7
    )
    `,
    [
      title,
      body,
      ['All'],
      branchId,
      createdBy || null,
      targetUserId,
      navigationQuery || null,
    ]
  );
}

/**
 * Teacher submitted a plan → notify configured verifiers (fallback: all Superadmins).
 */
export async function notifyVerifiersOfLessonPlanSubmission({
  lessonPlan,
  createdBy,
  teacherName,
}) {
  const planId = lessonPlan?.lesson_plan_id;
  const topic = lessonPlan?.topic || 'Untitled topic';
  const grade = lessonPlan?.grade_level || '';
  const subject = lessonPlan?.subject || '';

  let verifierIds = await getConfiguredVerifierUserIds();
  if (verifierIds.length === 0) {
    verifierIds = await getAllSuperadminUserIds();
  }

  const title = 'Lesson Plan Submitted for Verification';
  const body = [
    `${teacherName || 'A teacher'} submitted a lesson plan for verification.`,
    topic ? `Topic: ${topic}` : null,
    grade ? `Grade level: ${grade}` : null,
    subject ? `Subject: ${subject}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const navigationQuery = planId ? `lessonPlanId=${planId}` : '';

  await Promise.all(
    verifierIds
      .filter((id) => Number(id) !== Number(createdBy))
      .map((targetUserId) =>
        insertTargetedNotification({
          title,
          body,
          createdBy,
          targetUserId,
          branchId: lessonPlan?.branch_id || null,
          navigationQuery,
        })
      )
  );
}

/**
 * Verifier approved or requested revision → notify the teacher.
 */
export async function notifyTeacherOfLessonPlanReview({
  lessonPlan,
  createdBy,
  verifierName,
  action, // 'approved' | 'revision_requested'
  revisionReason = null,
}) {
  const teacherId = lessonPlan?.teacher_user_id;
  if (!teacherId) return;

  const planId = lessonPlan?.lesson_plan_id;
  const topic = lessonPlan?.topic || 'Untitled topic';
  const isApproved = action === 'approved';

  const title = isApproved
    ? 'Lesson Plan Approved'
    : 'Lesson Plan Revision Requested';

  let body = isApproved
    ? `${verifierName || 'A verifier'} approved your lesson plan "${topic}".`
    : `${verifierName || 'A verifier'} requested a revision on your lesson plan "${topic}".`;

  if (!isApproved && revisionReason) {
    body += ` Reason: ${revisionReason}`;
  }

  await insertTargetedNotification({
    title,
    body,
    createdBy,
    targetUserId: teacherId,
    branchId: lessonPlan?.branch_id || null,
    navigationQuery: planId ? `lessonPlanId=${planId}` : '',
  });
}
