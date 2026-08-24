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
        branch: branch
          ? {
              branch_id: branch.branch_id,
              branch_name: branch.branch_name,
              branch_address: branch.branch_address,
              region: 'Region III',
              district: '5th District',
              division: 'Bulacan',
              school_id: '411093',
            }
          : {
              branch_id: null,
              branch_name: 'Little Champions Academy, Inc.',
              branch_address: '',
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
 * Current Superadmin: whether they are configured as a lesson-plan verifier.
 */
router.get('/verifiers/me', requireRole('Superadmin'), async (req, res, next) => {
  try {
    const userId = req.user.userId || req.user.user_id;
    const isVerifier = await assertIsConfiguredVerifier(userId);
    res.json({
      success: true,
      data: { is_verifier: isVerifier, user_id: userId },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sms/lesson-plans/verifiers
 * Superadmin: list configured lesson-plan verifiers.
 */
router.get('/verifiers', requireRole('Superadmin'), async (req, res, next) => {
  try {
    const result = await query(
      `
      SELECT v.user_id, u.full_name, u.email, v.created_at
      FROM lesson_plan_verifierstbl v
      INNER JOIN userstbl u ON u.user_id = v.user_id
      WHERE u.user_type = 'Superadmin'
      ORDER BY u.full_name ASC
      `
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/sms/lesson-plans/verifiers
 * Superadmin: replace verifier list (Superadmin users only).
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
          SELECT user_id FROM userstbl
          WHERE user_id = ANY($1::int[]) AND user_type = 'Superadmin'
          `,
          [userIds]
        );
        if (check.rows.length !== userIds.length) {
          return res.status(400).json({
            success: false,
            message: 'All verifiers must be Superadmin users',
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

      const result = await query(
        `
        SELECT v.user_id, u.full_name, u.email, v.created_at
        FROM lesson_plan_verifierstbl v
        INNER JOIN userstbl u ON u.user_id = v.user_id
        ORDER BY u.full_name ASC
        `
      );
      res.json({ success: true, data: result.rows });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/lesson-plans
 * Teacher: own plans. Superadmin: all (optional status filter) — for verification inbox.
 */
router.get(
  '/',
  requireRole('Teacher', 'Superadmin'),
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

      if (!isTeacher) {
        const allowed = await assertIsConfiguredVerifier(userId);
        if (!allowed) {
          return res.status(403).json({
            success: false,
            message: 'Only configured lesson plan verifiers can view the review queue',
          });
        }
      }

      const params = [];
      let where = 'WHERE 1=1';
      if (isTeacher) {
        params.push(userId);
        where += ` AND lp.teacher_user_id = $${params.length}`;
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
  requireRole('Teacher', 'Superadmin'),
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
      if (req.user.userType === 'Superadmin') {
        const allowed = await assertIsConfiguredVerifier(req.user.userId || req.user.user_id);
        if (!allowed) {
          return res.status(403).json({
            success: false,
            message: 'Only configured lesson plan verifiers can view lesson plans',
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
      res.status(201).json({ success: true, data: mapLessonPlanRow(created.rows[0]) });
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
      res.json({ success: true, data: mapLessonPlanRow(updated.rows[0]) });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sms/lesson-plans/:id/approve
 * Configured Superadmin verifier only.
 */
router.post(
  '/:id/approve',
  requireRole('Superadmin'),
  [param('id').isInt(), handleValidationErrors],
  async (req, res, next) => {
    try {
      const userId = req.user.userId || req.user.user_id;
      const allowed = await assertIsConfiguredVerifier(userId);
      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: 'You are not configured as a lesson plan verifier',
        });
      }
      const id = parseInt(req.params.id, 10);
      const existing = await query(`SELECT status FROM lessonplanstbl WHERE lesson_plan_id = $1`, [
        id,
      ]);
      if (!existing.rows[0]) {
        return res.status(404).json({ success: false, message: 'Lesson plan not found' });
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
      res.json({ success: true, data: mapLessonPlanRow(updated.rows[0]) });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sms/lesson-plans/:id/request-revision
 */
router.post(
  '/:id/request-revision',
  requireRole('Superadmin'),
  [
    param('id').isInt(),
    body('reason').optional().isString(),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const userId = req.user.userId || req.user.user_id;
      const allowed = await assertIsConfiguredVerifier(userId);
      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: 'You are not configured as a lesson plan verifier',
        });
      }
      const id = parseInt(req.params.id, 10);
      const existing = await query(`SELECT status FROM lessonplanstbl WHERE lesson_plan_id = $1`, [
        id,
      ]);
      if (!existing.rows[0]) {
        return res.status(404).json({ success: false, message: 'Lesson plan not found' });
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
      res.json({ success: true, data: mapLessonPlanRow(updated.rows[0]) });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
