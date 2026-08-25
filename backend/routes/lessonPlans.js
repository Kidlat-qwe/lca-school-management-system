import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';
import {
  EDITABLE_STATUSES,
  lessonPlanWriteColumns,
  mapLessonPlanRow,
  normalizeLessonPlanBody,
  notifyTeacherOfLessonPlanReview,
  notifyVerifiersOfLessonPlanSubmission,
  validateLessonPlanPayload,
} from '../lib/lessonPlans/index.js';

const router = express.Router();

router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

const SELECT_PLAN = `
  SELECT
    lp.*,
    TO_CHAR(lp.lesson_date, 'YYYY-MM-DD') AS lesson_date,
    u.full_name AS teacher_name,
    b.branch_name,
    b.branch_address,
    v.full_name AS verified_by_name
  FROM lessonplanstbl lp
  LEFT JOIN userstbl u ON u.user_id = lp.teacher_user_id
  LEFT JOIN branchestbl b ON b.branch_id = lp.branch_id
  LEFT JOIN userstbl v ON v.user_id = lp.verified_by
`;

async function assertIsConfiguredVerifier(userId) {
  const result = await query(
    `SELECT 1 FROM lesson_plan_verifierstbl WHERE user_id = $1`,
    [userId]
  );
  return result.rows.length > 0;
}

/**
 * Verifier access context.
 * - Superadmin verifier: all branches (branchId = null scope)
 * - Admin verifier: only their designated branch
 */
function getActorBranchId(req) {
  const raw = req.user.branchId ?? req.user.branch_id ?? null;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function getVerifierContext(req) {
  const userId = req.user.userId || req.user.user_id;
  const userType = req.user.userType || req.user.user_type;
  const isVerifier = await assertIsConfiguredVerifier(userId);
  if (!isVerifier) {
    return { userId, userType, isVerifier: false, branchId: null };
  }
  if (userType === 'Admin') {
    return { userId, userType, isVerifier: true, branchId: getActorBranchId(req) };
  }
  return { userId, userType, isVerifier: true, branchId: null };
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
      message: 'You are not configured as a lesson plan verifier',
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
  WHERE u.user_type IN ('Superadmin', 'Admin')
  ORDER BY u.user_type DESC, b.branch_name ASC NULLS LAST, u.full_name ASC
`;

/**
 * GET /api/sms/lesson-plans/meta
 * Grade/subject option lists + current user prepared-by name.
 */
router.get('/meta', requireRole('Teacher', 'Superadmin'), async (req, res, next) => {
  try {
    const { GRADE_LEVEL_OPTIONS, SUBJECT_OPTIONS_BY_GRADE } = await import(
      '../lib/lessonPlans/index.js'
    );
    let branch = null;
    const branchId = req.user.branchId || null;
    if (branchId) {
      const br = await query(
        `SELECT branch_id, branch_name, branch_address FROM branchestbl WHERE branch_id = $1`,
        [branchId]
      );
      branch = br.rows[0] || null;
    }
    res.json({
      success: true,
      data: {
        grade_levels: GRADE_LEVEL_OPTIONS,
        subjects_by_grade: SUBJECT_OPTIONS_BY_GRADE,
        prepared_by: req.user.fullName || req.user.full_name || req.user.email || '',
        branch: {
          branch_id: branch?.branch_id ?? null,
          branch_name: 'Little Champions Academy, Inc.',
          branch_address: 'North Centrum Building, Guiguinto Bulacan 3015',
          region: 'Region III',
          district: '5th District',
          division: 'Bulacan',
          school_id: '411093',
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sms/lesson-plans/verifiers/me
 * Current Superadmin/Admin: whether they are configured as a lesson-plan verifier.
 */
router.get('/verifiers/me', requireRole('Superadmin', 'Admin'), async (req, res, next) => {
  try {
    const ctx = await getVerifierContext(req);
    res.json({
      success: true,
      data: {
        is_verifier: ctx.isVerifier,
        user_id: ctx.userId,
        user_type: ctx.userType,
        branch_id: ctx.branchId,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sms/lesson-plans/verifiers
 * Superadmin: list configured lesson-plan verifiers (Superadmin + Admin).
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
 * Superadmin: replace verifier list (Superadmin and Admin users only).
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
      const userIds = [...new Set((req.body.user_ids || []).map((id) => parseInt(id, 10)).filter((n) => n > 0))];
      if (userIds.length > 0) {
        const check = await query(
          `
          SELECT user_id, user_type, branch_id
          FROM userstbl
          WHERE user_id = ANY($1::int[]) AND user_type IN ('Superadmin', 'Admin')
          `,
          [userIds]
        );
        if (check.rows.length !== userIds.length) {
          return res.status(400).json({
            success: false,
            message: 'All verifiers must be Superadmin or Admin users',
          });
        }
        const adminsWithoutBranch = check.rows.filter(
          (r) => r.user_type === 'Admin' && (r.branch_id == null || r.branch_id === '')
        );
        if (adminsWithoutBranch.length > 0) {
          return res.status(400).json({
            success: false,
            message:
              'Admin verifiers must have a designated branch. Assign a branch to the Admin user first.',
          });
        }
      }

      const actorId = req.user.userId || req.user.user_id;
      await query('DELETE FROM lesson_plan_verifierstbl');
      for (const uid of userIds) {
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
 * Superadmin verifier: all branches.
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
            message: 'Only configured lesson plan verifiers can view the review queue',
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

      const status = req.body.status === 'submitted' ? 'submitted' : 'draft';
      const cols = lessonPlanWriteColumns(payload);
      const teacherId = req.user.userId || req.user.user_id;
      const branchId = req.user.branchId || null;

      const result = await query(
        `
        INSERT INTO lessonplanstbl (
          branch_id, teacher_user_id,
          lesson_date, grade_level, subject, topic,
          learning_objectives, materials_resources,
          opening_routine, review_section, lesson_presentation,
          guided_practice, assessment, closing_wrapping_up,
          reflection_went_well, reflection_challenges, reflection_improvements,
          status, submitted_at
        ) VALUES (
          $1, $2,
          $3, $4, $5, $6,
          $7, $8,
          $9, $10, $11,
          $12, $13, $14,
          $15, $16, $17,
          $18, $19
        )
        RETURNING lesson_plan_id
        `,
        [
          branchId,
          teacherId,
          cols.lesson_date,
          cols.grade_level,
          cols.subject,
          cols.topic,
          cols.learning_objectives,
          cols.materials_resources,
          cols.opening_routine,
          cols.review_section,
          cols.lesson_presentation,
          cols.guided_practice,
          cols.assessment,
          cols.closing_wrapping_up,
          cols.reflection_went_well,
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

      if (status === 'submitted') {
        try {
          await notifyVerifiersOfLessonPlanSubmission({
            lessonPlan: { ...plan, branch_id: branchId, teacher_user_id: teacherId },
            createdBy: teacherId,
            teacherName: req.user.fullName || req.user.full_name || req.user.email || 'Teacher',
          });
        } catch (notifyErr) {
          console.error('[lesson-plans] submit notification failed:', notifyErr.message);
        }
      }

      res.status(201).json({ success: true, data: plan });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/sms/lesson-plans/:id
 * Teacher updates when draft or revision_requested.
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
      if (!EDITABLE_STATUSES.has(existing.rows[0].status)) {
        return res.status(400).json({
          success: false,
          message: 'Only draft or revision-requested plans can be edited',
        });
      }

      const payload = normalizeLessonPlanBody({
        ...mapLessonPlanRow(existing.rows[0]),
        ...req.body,
      });
      const errors = validateLessonPlanPayload(payload, { requireAll: true });
      if (errors.length) {
        return res.status(400).json({ success: false, message: errors.join('; ') });
      }
      const cols = lessonPlanWriteColumns(payload);

      await query(
        `
        UPDATE lessonplanstbl SET
          lesson_date = $1,
          grade_level = $2,
          subject = $3,
          topic = $4,
          learning_objectives = $5,
          materials_resources = $6,
          opening_routine = $7,
          review_section = $8,
          lesson_presentation = $9,
          guided_practice = $10,
          assessment = $11,
          closing_wrapping_up = $12,
          reflection_went_well = $13,
          reflection_challenges = $14,
          reflection_improvements = $15,
          updated_at = NOW()
        WHERE lesson_plan_id = $16
        `,
        [
          cols.lesson_date,
          cols.grade_level,
          cols.subject,
          cols.topic,
          cols.learning_objectives,
          cols.materials_resources,
          cols.opening_routine,
          cols.review_section,
          cols.lesson_presentation,
          cols.guided_practice,
          cols.assessment,
          cols.closing_wrapping_up,
          cols.reflection_went_well,
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

      await query(
        `
        UPDATE lessonplanstbl SET
          status = 'submitted',
          submitted_at = NOW(),
          revision_reason = NULL,
          updated_at = NOW()
        WHERE lesson_plan_id = $1
        `,
        [id]
      );
      const updated = await query(`${SELECT_PLAN} WHERE lp.lesson_plan_id = $1`, [id]);
      const plan = mapLessonPlanRow(updated.rows[0]);

      try {
        await notifyVerifiersOfLessonPlanSubmission({
          lessonPlan: {
            ...plan,
            branch_id: existing.rows[0].branch_id,
            teacher_user_id: teacherId,
          },
          createdBy: teacherId,
          teacherName: req.user.fullName || req.user.full_name || req.user.email || 'Teacher',
        });
      } catch (notifyErr) {
        console.error('[lesson-plans] submit notification failed:', notifyErr.message);
      }

      res.json({ success: true, data: plan });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sms/lesson-plans/:id/approve
 * Configured Superadmin (any branch) or Admin (own branch only) verifier.
 */
router.post(
  '/:id/approve',
  requireRole('Superadmin', 'Admin'),
  [param('id').isInt(), handleValidationErrors],
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

      await query(
        `
        UPDATE lessonplanstbl SET
          status = 'approved',
          verified_by = $1,
          verified_at = NOW(),
          revision_reason = NULL,
          updated_at = NOW()
        WHERE lesson_plan_id = $2
        `,
        [userId, id]
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
 * Configured Superadmin (any branch) or Admin (own branch only) verifier.
 */
router.post(
  '/:id/request-revision',
  requireRole('Superadmin', 'Admin'),
  [
    param('id').isInt(),
    body('reason').optional().isString(),
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

      const reason = String(req.body.reason || '').trim() || null;
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
        [reason, userId, id]
      );
      const updated = await query(`${SELECT_PLAN} WHERE lp.lesson_plan_id = $1`, [id]);
      const plan = mapLessonPlanRow(updated.rows[0]);

      try {
        await notifyTeacherOfLessonPlanReview({
          lessonPlan: existing.rows[0],
          createdBy: userId,
          verifierName: req.user.fullName || req.user.full_name || req.user.email || 'Verifier',
          action: 'revision_requested',
          revisionReason: reason,
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
