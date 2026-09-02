import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';
import {
  EDITABLE_STATUSES,
  REFLECTION_EDITABLE_STATUSES,
  buildRevisionFeedbackPayload,
  clearReflectionFields,
  deriveBranchGradeLevelsFromClasses,
  enrichLessonPlanPayloadWithClass,
  fetchLessonPlanMetaClasses,
  isLessonDateToday,
  lessonPlanWriteColumns,
  mapLessonPlanRow,
  normalizeHeadTeacherReviewBody,
  normalizeLessonPlanBody,
  notifyTeacherOfLessonPlanReview,
  countPendingLessonPlanSubmissions,
  serializeRevisionFeedback,
  summarizeRevisionFeedbackForNotification,
  validateLessonPlanPayload,
  validateReflectionPayload,
  validateRevisionFeedbackPayload,
  isConfiguredLessonPlanAdminVerifier,
} from '../lib/lessonPlans/index.js';

const router = express.Router();

router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

/** DepEd School ID — same for every LCA branch (not stored per branch). */
const LESSON_PLAN_SCHOOL_ID = '411093';
const LESSON_PLAN_SCHOOL_NAME = 'Little Champions Academy, Inc.';

const SELECT_PLAN = `
  SELECT
    lp.*,
    TO_CHAR(lp.lesson_date, 'YYYY-MM-DD') AS lesson_date,
    u.full_name AS teacher_name,
    b.branch_name,
    b.branch_address,
    b.deped_region,
    b.deped_division,
    b.deped_district,
    v.full_name AS verified_by_name,
    lc.class_name AS linked_class_name,
    lc.level_tag AS linked_level_tag,
    lcp.program_name AS linked_program_name
  FROM lessonplanstbl lp
  LEFT JOIN userstbl u ON u.user_id = lp.teacher_user_id
  LEFT JOIN branchestbl b ON b.branch_id = lp.branch_id
  LEFT JOIN userstbl v ON v.user_id = lp.verified_by
  LEFT JOIN classestbl lc ON lc.class_id = lp.class_id
  LEFT JOIN programstbl lcp ON lcp.program_id = lc.program_id
`;

async function assertIsConfiguredAdminVerifier(userId) {
  return isConfiguredLessonPlanAdminVerifier(query, userId);
}

/**
 * Verifier access context.
 * - Superadmin: always allowed (all branches; no Settings selection required)
 * - Admin: only if selected in Settings; scoped to their designated branch
 */
function getActorBranchId(req) {
  const raw = req.user.branchId ?? req.user.branch_id ?? null;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function getVerifierContext(req) {
  const userId = req.user.userId || req.user.user_id;
  const userType = String(req.user.userType || req.user.user_type || '').trim();

  if (userType === 'Superadmin') {
    return { userId, userType, isVerifier: true, branchId: null };
  }

  if (userType === 'Admin') {
    const isVerifier = await assertIsConfiguredAdminVerifier(userId);
    return {
      userId,
      userType,
      isVerifier,
      branchId: isVerifier ? getActorBranchId(req) : null,
    };
  }

  return { userId, userType, isVerifier: false, branchId: null };
}

/**
 * Ensure the current verifier may act on a plan row (branch scope for Admin).
 * @returns {{ ok: true } | { ok: false, status: number, message: string }}
 */
function assertVerifierMayAccessPlan(ctx, planRow) {
  if (!ctx?.isVerifier) {
    return {
      ok: false,
      status: 403,
      message:
        ctx?.userType === 'Admin'
          ? 'You are not configured as a lesson plan verifier. Ask a Superadmin to select you in Settings → Lesson Plans.'
          : 'You are not allowed to verify lesson plans',
    };
  }
  if (ctx.userType === 'Admin') {
    if (ctx.branchId == null) {
      return {
        ok: false,
        status: 403,
        message: 'Admin verifiers must have a designated branch',
      };
    }
    if (Number(planRow.branch_id) !== Number(ctx.branchId)) {
      return {
        ok: false,
        status: 403,
        message: 'You can only verify lesson plans for your designated branch',
      };
    }
  }
  return { ok: true };
}

const VERIFIER_LIST_SELECT = `
  SELECT
    v.user_id,
    u.full_name,
    u.email,
    u.user_type,
    u.branch_id,
    b.branch_name,
    v.created_at
  FROM lesson_plan_verifierstbl v
  INNER JOIN userstbl u ON u.user_id = v.user_id
  LEFT JOIN branchestbl b ON b.branch_id = u.branch_id
  WHERE u.user_type = 'Admin'
  ORDER BY b.branch_name ASC NULLS LAST, u.full_name ASC
`;

/**
 * GET /api/sms/lesson-plans/meta
 * Grade levels, branch classes, and current user prepared-by name.
 */
router.get('/meta', requireRole('Teacher', 'Superadmin'), async (req, res, next) => {
  try {
    let branch = null;
    let classes = [];
    const branchId = req.user.branchId || req.user.branch_id || null;
    const userType = req.user.userType || req.user.user_type;
    const teacherUserId =
      userType === 'Teacher' ? req.user.userId || req.user.user_id : null;

    if (branchId) {
      const br = await query(
        `
        SELECT
          branch_id,
          branch_name,
          branch_address,
          deped_region,
          deped_division,
          deped_district
        FROM branchestbl
        WHERE branch_id = $1
        `,
        [branchId]
      );
      branch = br.rows[0] || null;

      classes = await fetchLessonPlanMetaClasses(query, { branchId, teacherUserId });
    }
    const grade_levels = deriveBranchGradeLevelsFromClasses(classes);
    res.json({
      success: true,
      data: {
        grade_levels,
        classes,
        prepared_by: req.user.fullName || req.user.full_name || req.user.email || '',
        branch: {
          branch_id: branch?.branch_id ?? null,
          branch_name: LESSON_PLAN_SCHOOL_NAME,
          branch_address: branch?.branch_address || '',
          region: branch?.deped_region || 'Region III',
          division: branch?.deped_division || 'Bulacan',
          district: branch?.deped_district || '5th District',
          school_id: LESSON_PLAN_SCHOOL_ID,
          deped_region: branch?.deped_region || null,
          deped_division: branch?.deped_division || null,
          deped_district: branch?.deped_district || null,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sms/lesson-plans/verifiers/me
 * Current Superadmin/Admin: whether they may verify lesson plans.
 * Superadmins are always allowed; Admins only when selected in Settings.
 */
router.get('/verifiers/me', requireRole('Superadmin', 'Admin'), async (req, res, next) => {
  try {
    const ctx = await getVerifierContext(req);
    const pending_submission_count = ctx.isVerifier
      ? await countPendingLessonPlanSubmissions(query, {
          userType: ctx.userType,
          branchId: ctx.branchId,
        })
      : 0;

    res.json({
      success: true,
      data: {
        is_verifier: ctx.isVerifier,
        user_id: ctx.userId,
        user_type: ctx.userType,
        branch_id: ctx.branchId,
        pending_submission_count,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sms/lesson-plans/verifiers
 * Superadmin: list Admin users selected as lesson-plan verifiers (Settings).
 */
router.get('/verifiers', requireRole('Superadmin'), async (req, res, next) => {
  try {
    const result = await query(VERIFIER_LIST_SELECT);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/sms/lesson-plans/verifiers
 * Superadmin: replace Admin verifier list (Settings).
 * Superadmins always verify and are not stored here.
 * Admin verifiers must have a designated branch_id.
 */
router.put(
  '/verifiers',
  requireRole('Superadmin'),
  [
    body('user_ids').isArray().withMessage('user_ids must be an array'),
    body('user_ids.*').optional().isInt({ min: 1 }),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const requestedIds = [
        ...new Set((req.body.user_ids || []).map((id) => parseInt(id, 10)).filter((n) => n > 0)),
      ];

      let adminIds = [];
      if (requestedIds.length > 0) {
        const check = await query(
          `
          SELECT user_id, user_type, branch_id
          FROM userstbl
          WHERE user_id = ANY($1::int[])
          `,
          [requestedIds]
        );
        const foundIds = new Set(check.rows.map((r) => Number(r.user_id)));
        const missing = requestedIds.filter((id) => !foundIds.has(id));
        if (missing.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'One or more selected users were not found',
          });
        }

        const disallowed = check.rows.filter(
          (r) => r.user_type !== 'Admin' && r.user_type !== 'Superadmin'
        );
        if (disallowed.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'Only Admin users can be selected as lesson plan verifiers',
          });
        }

        // Superadmin IDs are ignored (they always verify; not stored in this table).
        const adminRows = check.rows.filter((r) => r.user_type === 'Admin');
        const adminsWithoutBranch = adminRows.filter(
          (r) => r.branch_id == null || r.branch_id === ''
        );
        if (adminsWithoutBranch.length > 0) {
          return res.status(400).json({
            success: false,
            message:
              'Admin verifiers must have a designated branch. Assign a branch to the Admin user first.',
          });
        }

        adminIds = adminRows.map((r) => Number(r.user_id));
      }

      const actorId = req.user.userId || req.user.user_id;
      await query('DELETE FROM lesson_plan_verifierstbl');
      for (const uid of adminIds) {
        await query(
          `
          INSERT INTO lesson_plan_verifierstbl (user_id, created_by)
          VALUES ($1, $2)
          ON CONFLICT (user_id) DO NOTHING
          `,
          [uid, actorId]
        );
      }

      const result = await query(VERIFIER_LIST_SELECT);
      res.json({ success: true, data: result.rows });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/lesson-plans
 * Teacher: own plans.
 * Superadmin: all branches (always allowed).
 * Admin verifier: only their designated branch.
 */
router.get(
  '/',
  requireRole('Teacher', 'Superadmin', 'Admin'),
  [
    queryValidator('status').optional().isString(),
    queryValidator('page').optional().isInt({ min: 1 }),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const page = parseInt(req.query.page, 10) || 1;
      const limit = parseInt(req.query.limit, 10) || 50;
      const offset = (page - 1) * limit;
      const status = req.query.status && req.query.status !== 'all' ? req.query.status : null;
      const isTeacher = req.user.userType === 'Teacher';
      const userId = req.user.userId || req.user.user_id;

      let verifierCtx = null;
      if (!isTeacher) {
        verifierCtx = await getVerifierContext(req);
        if (!verifierCtx.isVerifier) {
          return res.status(403).json({
            success: false,
            message: 'Only Superadmins and configured Admin lesson plan verifiers can view the review queue',
          });
        }
        if (verifierCtx.userType === 'Admin' && verifierCtx.branchId == null) {
          return res.status(403).json({
            success: false,
            message: 'Admin verifiers must have a designated branch',
          });
        }
      }

      const params = [];
      let where = 'WHERE 1=1';
      if (isTeacher) {
        params.push(userId);
        where += ` AND lp.teacher_user_id = $${params.length}`;
      } else if (verifierCtx?.userType === 'Admin' && verifierCtx.branchId != null) {
        params.push(verifierCtx.branchId);
        where += ` AND lp.branch_id = $${params.length}`;
      }
      if (status) {
        params.push(status);
        where += ` AND lp.status = $${params.length}`;
      }

      const countResult = await query(
        `SELECT COUNT(*)::int AS total FROM lessonplanstbl lp ${where}`,
        params
      );
      params.push(limit, offset);
      const result = await query(
        `
        ${SELECT_PLAN}
        ${where}
        ORDER BY lp.updated_at DESC, lp.lesson_plan_id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
        `,
        params
      );

      res.json({
        success: true,
        data: result.rows.map(mapLessonPlanRow),
        pagination: {
          page,
          limit,
          total: countResult.rows[0]?.total || 0,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/lesson-plans/:id
 */
router.get(
  '/:id',
  requireRole('Teacher', 'Superadmin', 'Admin'),
  [param('id').isInt(), handleValidationErrors],
  async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      const result = await query(`${SELECT_PLAN} WHERE lp.lesson_plan_id = $1`, [id]);
      const row = result.rows[0];
      if (!row) {
        return res.status(404).json({ success: false, message: 'Lesson plan not found' });
      }
      if (
        req.user.userType === 'Teacher' &&
        Number(row.teacher_user_id) !== Number(req.user.userId || req.user.user_id)
      ) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      if (req.user.userType === 'Superadmin' || req.user.userType === 'Admin') {
        const ctx = await getVerifierContext(req);
        const access = assertVerifierMayAccessPlan(ctx, row);
        if (!access.ok) {
          return res.status(access.status).json({
            success: false,
            message: access.message,
          });
        }
      }
      res.json({ success: true, data: mapLessonPlanRow(row) });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sms/lesson-plans
 * Teacher creates a draft (or submitted).
 */
router.post(
  '/',
  requireRole('Teacher'),
  async (req, res, next) => {
    try {
      const payload = normalizeLessonPlanBody(req.body);
      const errors = validateLessonPlanPayload(payload, { requireAll: true });
      if (errors.length) {
        return res.status(400).json({ success: false, message: errors.join('; ') });
      }

      const branchId = req.user.branchId || null;
      const teacherId = req.user.userId || req.user.user_id;
      const enriched = await enrichLessonPlanPayloadWithClass(
        query,
        payload,
        branchId,
        teacherId
      );
      if (!enriched.ok) {
        return res.status(400).json({ success: false, message: enriched.errors.join('; ') });
      }

      const status = req.body.status === 'submitted' ? 'submitted' : 'draft';
      // Reflections stay empty until verifier approves and lesson date unlocks them.
      const cols = lessonPlanWriteColumns(clearReflectionFields(enriched.payload));

      const result = await query(
        `
        INSERT INTO lessonplanstbl (
          branch_id, teacher_user_id,
          lesson_date, grade_level, class_id, subject, phase, session_label, topic,
          early_learning_goals, objective_1, objective_2, objective_3,
          assessment_method, assessment_criteria, materials_needed,
          preliminaries_time, preliminaries_activity,
          lesson_proper_time, lesson_proper_activity,
          conclusion_time, conclusion_activity,
          class1_name, class1_age_group, class1_considerations, class1_adjustments,
          class2_name, class2_age_group, class2_considerations, class2_adjustments,
          class3_name, class3_age_group, class3_considerations, class3_adjustments,
          reflection_went_well, reflection_amazing_moments, reflection_challenges, reflection_improvements,
          status, submitted_at
        ) VALUES (
          $1, $2,
          $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, $15, $16,
          $17, $18,
          $19, $20,
          $21, $22,
          $23, $24, $25, $26,
          $27, $28, $29, $30,
          $31, $32, $33, $34,
          $35, $36, $37, $38,
          $39, $40
        )
        RETURNING lesson_plan_id
        `,
        [
          branchId,
          teacherId,
          cols.lesson_date,
          cols.grade_level,
          cols.class_id,
          cols.subject,
          cols.phase,
          cols.session_label,
          cols.topic,
          cols.early_learning_goals,
          cols.objective_1,
          cols.objective_2,
          cols.objective_3,
          cols.assessment_method,
          cols.assessment_criteria,
          cols.materials_needed,
          cols.preliminaries_time,
          cols.preliminaries_activity,
          cols.lesson_proper_time,
          cols.lesson_proper_activity,
          cols.conclusion_time,
          cols.conclusion_activity,
          cols.class1_name,
          cols.class1_age_group,
          cols.class1_considerations,
          cols.class1_adjustments,
          cols.class2_name,
          cols.class2_age_group,
          cols.class2_considerations,
          cols.class2_adjustments,
          cols.class3_name,
          cols.class3_age_group,
          cols.class3_considerations,
          cols.class3_adjustments,
          cols.reflection_went_well,
          cols.reflection_amazing_moments,
          cols.reflection_challenges,
          cols.reflection_improvements,
          status,
          status === 'submitted' ? new Date() : null,
        ]
      );

      const created = await query(`${SELECT_PLAN} WHERE lp.lesson_plan_id = $1`, [
        result.rows[0].lesson_plan_id,
      ]);
      const plan = mapLessonPlanRow(created.rows[0]);

      res.status(201).json({ success: true, data: plan });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/sms/lesson-plans/:id
 * - draft / revision_requested: full edit (reflections forced empty)
 * - awaiting_reflection: Teacher's Reflection only, and only on the lesson date (Manila);
 *   saving reflections marks the plan completed (no second verifier approval)
 */
router.put(
  '/:id',
  requireRole('Teacher'),
  [param('id').isInt(), handleValidationErrors],
  async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      const teacherId = req.user.userId || req.user.user_id;
      const existing = await query(
        `SELECT * FROM lessonplanstbl WHERE lesson_plan_id = $1 AND teacher_user_id = $2`,
        [id, teacherId]
      );
      if (!existing.rows[0]) {
        return res.status(404).json({ success: false, message: 'Lesson plan not found' });
      }

      const currentStatus = existing.rows[0].status;

      // --- Complete reflection after verifier approval (lesson date only) ---
      if (REFLECTION_EDITABLE_STATUSES.has(currentStatus)) {
        if (!isLessonDateToday(existing.rows[0].lesson_date)) {
          return res.status(400).json({
            success: false,
            message:
              'Teacher reflection can only be edited on the lesson date. It is locked before and after that day.',
          });
        }

        const reflectionPayload = normalizeLessonPlanBody(req.body);
        const reflectionErrors = validateReflectionPayload(reflectionPayload);
        if (reflectionErrors.length) {
          return res.status(400).json({
            success: false,
            message: reflectionErrors.join('; '),
          });
        }

        await query(
          `
          UPDATE lessonplanstbl SET
            reflection_went_well = $1,
            reflection_amazing_moments = $2,
            reflection_challenges = $3,
            reflection_improvements = $4,
            status = 'completed',
            updated_at = NOW()
          WHERE lesson_plan_id = $5
          `,
          [
            String(reflectionPayload.reflection_went_well || '').trim(),
            String(reflectionPayload.reflection_amazing_moments || '').trim(),
            String(reflectionPayload.reflection_challenges || '').trim(),
            String(reflectionPayload.reflection_improvements || '').trim(),
            id,
          ]
        );

        const updated = await query(`${SELECT_PLAN} WHERE lp.lesson_plan_id = $1`, [id]);
        return res.json({ success: true, data: mapLessonPlanRow(updated.rows[0]) });
      }

      if (!EDITABLE_STATUSES.has(currentStatus)) {
        return res.status(400).json({
          success: false,
          message:
            'Only draft or revision-requested plans can be edited (or awaiting-reflection plans on the lesson date for reflection)',
        });
      }

      const payload = clearReflectionFields(
        normalizeLessonPlanBody({
          ...mapLessonPlanRow(existing.rows[0]),
          ...req.body,
        })
      );
      const errors = validateLessonPlanPayload(payload, { requireAll: true });
      if (errors.length) {
        return res.status(400).json({ success: false, message: errors.join('; ') });
      }

      const branchId = req.user.branchId || null;
      const enriched = await enrichLessonPlanPayloadWithClass(
        query,
        payload,
        branchId,
        teacherId
      );
      if (!enriched.ok) {
        return res.status(400).json({ success: false, message: enriched.errors.join('; ') });
      }
      const cols = lessonPlanWriteColumns(enriched.payload);

      await query(
        `
        UPDATE lessonplanstbl SET
          lesson_date = $1,
          grade_level = $2,
          class_id = $3,
          subject = $4,
          phase = $5,
          session_label = $6,
          topic = $7,
          early_learning_goals = $8,
          objective_1 = $9,
          objective_2 = $10,
          objective_3 = $11,
          assessment_method = $12,
          assessment_criteria = $13,
          materials_needed = $14,
          preliminaries_time = $15,
          preliminaries_activity = $16,
          lesson_proper_time = $17,
          lesson_proper_activity = $18,
          conclusion_time = $19,
          conclusion_activity = $20,
          class1_name = $21,
          class1_age_group = $22,
          class1_considerations = $23,
          class1_adjustments = $24,
          class2_name = $25,
          class2_age_group = $26,
          class2_considerations = $27,
          class2_adjustments = $28,
          class3_name = $29,
          class3_age_group = $30,
          class3_considerations = $31,
          class3_adjustments = $32,
          reflection_went_well = $33,
          reflection_amazing_moments = $34,
          reflection_challenges = $35,
          reflection_improvements = $36,
          updated_at = NOW()
        WHERE lesson_plan_id = $37
        `,
        [
          cols.lesson_date,
          cols.grade_level,
          cols.class_id,
          cols.subject,
          cols.phase,
          cols.session_label,
          cols.topic,
          cols.early_learning_goals,
          cols.objective_1,
          cols.objective_2,
          cols.objective_3,
          cols.assessment_method,
          cols.assessment_criteria,
          cols.materials_needed,
          cols.preliminaries_time,
          cols.preliminaries_activity,
          cols.lesson_proper_time,
          cols.lesson_proper_activity,
          cols.conclusion_time,
          cols.conclusion_activity,
          cols.class1_name,
          cols.class1_age_group,
          cols.class1_considerations,
          cols.class1_adjustments,
          cols.class2_name,
          cols.class2_age_group,
          cols.class2_considerations,
          cols.class2_adjustments,
          cols.class3_name,
          cols.class3_age_group,
          cols.class3_considerations,
          cols.class3_adjustments,
          cols.reflection_went_well,
          cols.reflection_amazing_moments,
          cols.reflection_challenges,
          cols.reflection_improvements,
          id,
        ]
      );

      const updated = await query(`${SELECT_PLAN} WHERE lp.lesson_plan_id = $1`, [id]);
      res.json({ success: true, data: mapLessonPlanRow(updated.rows[0]) });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sms/lesson-plans/:id/submit
 */
router.post(
  '/:id/submit',
  requireRole('Teacher'),
  [param('id').isInt(), handleValidationErrors],
  async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      const teacherId = req.user.userId || req.user.user_id;
      const existing = await query(
        `SELECT * FROM lessonplanstbl WHERE lesson_plan_id = $1 AND teacher_user_id = $2`,
        [id, teacherId]
      );
      if (!existing.rows[0]) {
        return res.status(404).json({ success: false, message: 'Lesson plan not found' });
      }
      if (!EDITABLE_STATUSES.has(existing.rows[0].status)) {
        return res.status(400).json({
          success: false,
          message: 'Only draft or revision-requested plans can be submitted',
        });
      }

      const submitPayload = normalizeLessonPlanBody(mapLessonPlanRow(existing.rows[0]));
      const submitErrors = validateLessonPlanPayload(submitPayload, { requireAll: true });
      if (submitErrors.length) {
        return res.status(400).json({ success: false, message: submitErrors.join('; ') });
      }

      // Clear any reflection content at submit time (locked until lesson date after approval).
      await query(
        `
        UPDATE lessonplanstbl SET
          status = 'submitted',
          submitted_at = NOW(),
          revision_reason = NULL,
          reflection_went_well = '',
          reflection_amazing_moments = '',
          reflection_challenges = '',
          reflection_improvements = '',
          updated_at = NOW()
        WHERE lesson_plan_id = $1
        `,
        [id]
      );
      const updated = await query(`${SELECT_PLAN} WHERE lp.lesson_plan_id = $1`, [id]);
      const plan = mapLessonPlanRow(updated.rows[0]);

      res.json({ success: true, data: plan });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sms/lesson-plans/:id/approve
 * Any Superadmin (all branches) or configured Admin (own branch only) verifier.
 */
router.post(
  '/:id/approve',
  requireRole('Superadmin', 'Admin'),
  [
    param('id').isInt(),
    body('head_teacher_overall_assessment').optional().isString(),
    body('head_teacher_specific_feedback').optional().isString(),
    body('head_teacher_next_steps').optional().isString(),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const ctx = await getVerifierContext(req);
      const userId = ctx.userId;
      const id = parseInt(req.params.id, 10);
      const existing = await query(
        `SELECT lesson_plan_id, status, teacher_user_id, branch_id, topic, grade_level, subject
         FROM lessonplanstbl WHERE lesson_plan_id = $1`,
        [id]
      );
      if (!existing.rows[0]) {
        return res.status(404).json({ success: false, message: 'Lesson plan not found' });
      }
      const access = assertVerifierMayAccessPlan(ctx, existing.rows[0]);
      if (!access.ok) {
        return res.status(access.status).json({
          success: false,
          message: access.message,
        });
      }
      if (existing.rows[0].status !== 'submitted') {
        return res.status(400).json({
          success: false,
          message: 'Only submitted lesson plans can be approved',
        });
      }

      const review = normalizeHeadTeacherReviewBody(req.body);

      await query(
        `
        UPDATE lessonplanstbl SET
          status = 'awaiting_reflection',
          verified_by = $1,
          verified_at = NOW(),
          revision_reason = NULL,
          head_teacher_overall_assessment = $2,
          head_teacher_specific_feedback = $3,
          head_teacher_next_steps = $4,
          updated_at = NOW()
        WHERE lesson_plan_id = $5
        `,
        [
          userId,
          String(review.head_teacher_overall_assessment || '').trim(),
          String(review.head_teacher_specific_feedback || '').trim(),
          String(review.head_teacher_next_steps || '').trim(),
          id,
        ]
      );
      const updated = await query(`${SELECT_PLAN} WHERE lp.lesson_plan_id = $1`, [id]);
      const plan = mapLessonPlanRow(updated.rows[0]);

      try {
        await notifyTeacherOfLessonPlanReview({
          lessonPlan: existing.rows[0],
          createdBy: userId,
          verifierName: req.user.fullName || req.user.full_name || req.user.email || 'Verifier',
          action: 'approved',
        });
      } catch (notifyErr) {
        console.error('[lesson-plans] approve notification failed:', notifyErr.message);
      }

      res.json({ success: true, data: plan });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sms/lesson-plans/:id/request-revision
 * Any Superadmin (all branches) or configured Admin (own branch only) verifier.
 * Body:
 *   - items?: [{ field?, highlight?, note? }]  field keys e.g. learning_objectives
 *   - reason?: string  general note (also accepted as legacy plain reason)
 */
router.post(
  '/:id/request-revision',
  requireRole('Superadmin', 'Admin'),
  [
    param('id').isInt(),
    body('reason').optional().isString(),
    body('items').optional().isArray(),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const ctx = await getVerifierContext(req);
      const userId = ctx.userId;
      const id = parseInt(req.params.id, 10);
      const existing = await query(
        `SELECT lesson_plan_id, status, teacher_user_id, branch_id, topic, grade_level, subject
         FROM lessonplanstbl WHERE lesson_plan_id = $1`,
        [id]
      );
      if (!existing.rows[0]) {
        return res.status(404).json({ success: false, message: 'Lesson plan not found' });
      }
      const access = assertVerifierMayAccessPlan(ctx, existing.rows[0]);
      if (!access.ok) {
        return res.status(access.status).json({
          success: false,
          message: access.message,
        });
      }
      if (existing.rows[0].status !== 'submitted') {
        return res.status(400).json({
          success: false,
          message: 'Only submitted lesson plans can be sent back for revision',
        });
      }

      const feedback = buildRevisionFeedbackPayload({
        items: req.body.items,
        general: req.body.reason,
      });
      const feedbackErrors = validateRevisionFeedbackPayload(feedback);
      if (feedbackErrors.length) {
        return res.status(400).json({
          success: false,
          message: feedbackErrors.join('; '),
        });
      }

      const reasonStored = serializeRevisionFeedback(feedback);
      const reasonForNotify = summarizeRevisionFeedbackForNotification(feedback);

      await query(
        `
        UPDATE lessonplanstbl SET
          status = 'revision_requested',
          revision_reason = $1,
          verified_by = $2,
          verified_at = NOW(),
          updated_at = NOW()
        WHERE lesson_plan_id = $3
        `,
        [reasonStored, userId, id]
      );
      const updated = await query(`${SELECT_PLAN} WHERE lp.lesson_plan_id = $1`, [id]);
      const plan = mapLessonPlanRow(updated.rows[0]);

      try {
        await notifyTeacherOfLessonPlanReview({
          lessonPlan: existing.rows[0],
          createdBy: userId,
          verifierName: req.user.fullName || req.user.full_name || req.user.email || 'Verifier',
          action: 'revision_requested',
          revisionReason: reasonForNotify,
        });
      } catch (notifyErr) {
        console.error('[lesson-plans] revision notification failed:', notifyErr.message);
      }

      res.json({ success: true, data: plan });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
