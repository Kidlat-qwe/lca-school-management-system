import express from 'express';
import { query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';

const router = express.Router();

router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

const formatMonthLabel = (date) => {
  return date.toLocaleString('default', { month: 'short', year: 'numeric' });
};

const buildMonthSequence = (monthsBack = 6) => {
  const today = new Date();
  const sequence = [];
  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    sequence.push({
      key,
      label: formatMonthLabel(date),
    });
  }
  return sequence;
};

router.get(
  '/',
  [
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { branch_id } = req.query;
      const branchFilter = branch_id ? parseInt(branch_id, 10) : null;

      // Build queries with parameterized values for security
      const branchParams = branchFilter ? [branchFilter] : [];

      const totalsQuery = branchFilter
        ? `
          SELECT
            (SELECT COUNT(*) FROM branchestbl WHERE branch_id = $1) AS total_branches,
            (SELECT COUNT(*) FROM userstbl WHERE user_type = 'Student' AND branch_id = $1) AS total_students,
            (SELECT COUNT(*) FROM userstbl WHERE user_type = 'Teacher' AND branch_id = $1) AS total_teachers,
            (SELECT COUNT(*) FROM classestbl WHERE status = 'Active' AND branch_id = $1) AS active_classes
        `
        : `
          SELECT
            (SELECT COUNT(*) FROM branchestbl) AS total_branches,
            (SELECT COUNT(*) FROM userstbl WHERE user_type = 'Student') AS total_students,
            (SELECT COUNT(*) FROM userstbl WHERE user_type = 'Teacher') AS total_teachers,
            (SELECT COUNT(*) FROM classestbl WHERE status = 'Active') AS active_classes
        `;

      const [totalsResult] = await Promise.all([
        query(totalsQuery, branchParams),
      ]);

      const totals = totalsResult.rows[0] || {
        total_branches: 0,
        total_students: 0,
        total_teachers: 0,
        active_classes: 0,
      };

      const monthSequence = buildMonthSequence(6);
      const monthKeys = monthSequence.map((m) => m.key);

      const enrollmentsQuery = branchFilter
        ? `
          SELECT
            TO_CHAR(DATE_TRUNC('month', cs.enrolled_at), 'YYYY-MM') AS month,
            COUNT(*) AS count
          FROM classstudentstbl cs
          INNER JOIN classestbl c ON cs.class_id = c.class_id
          WHERE cs.enrolled_at >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
            AND c.branch_id = $1
          GROUP BY 1
          ORDER BY 1
        `
        : `
          SELECT
            TO_CHAR(DATE_TRUNC('month', cs.enrolled_at), 'YYYY-MM') AS month,
            COUNT(*) AS count
          FROM classstudentstbl cs
          INNER JOIN classestbl c ON cs.class_id = c.class_id
          WHERE cs.enrolled_at >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
          GROUP BY 1
          ORDER BY 1
        `;
      const enrollmentsResult = await query(enrollmentsQuery, branchParams);
      const enrollmentMap = enrollmentsResult.rows.reduce((acc, row) => {
        acc[row.month] = parseInt(row.count, 10);
        return acc;
      }, {});
      const monthlyEnrollments = monthSequence.map((month) => ({
        month: month.label,
        count: enrollmentMap[month.key] || 0,
      }));

      const invoiceTrendQuery = branchFilter
        ? `
          SELECT
            TO_CHAR(DATE_TRUNC('month', issue_date), 'YYYY-MM') AS month,
            COALESCE(SUM(amount), 0) AS total
          FROM invoicestbl i
          WHERE issue_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
            AND i.branch_id = $1
          GROUP BY 1
          ORDER BY 1
        `
        : `
          SELECT
            TO_CHAR(DATE_TRUNC('month', issue_date), 'YYYY-MM') AS month,
            COALESCE(SUM(amount), 0) AS total
          FROM invoicestbl i
          WHERE issue_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
          GROUP BY 1
          ORDER BY 1
        `;
      const invoiceTrendResult = await query(invoiceTrendQuery, branchParams);
      const invoiceMap = invoiceTrendResult.rows.reduce((acc, row) => {
        acc[row.month] = parseFloat(row.total);
        return acc;
      }, {});
      const invoiceTrend = monthSequence.map((month) => ({
        month: month.label,
        total: invoiceMap[month.key] || 0,
      }));

      const studentsByBranchQuery = branchFilter
        ? `
          SELECT
            b.branch_id,
            b.branch_name,
            COUNT(u.user_id) FILTER (WHERE u.user_type = 'Student') AS student_count
          FROM branchestbl b
          LEFT JOIN userstbl u ON u.branch_id = b.branch_id AND u.user_type = 'Student'
          WHERE b.branch_id = $1
          GROUP BY b.branch_id, b.branch_name
          ORDER BY student_count DESC NULLS LAST, b.branch_name
        `
        : `
          SELECT
            b.branch_id,
            b.branch_name,
            COUNT(u.user_id) FILTER (WHERE u.user_type = 'Student') AS student_count
          FROM branchestbl b
          LEFT JOIN userstbl u ON u.branch_id = b.branch_id AND u.user_type = 'Student'
          GROUP BY b.branch_id, b.branch_name
          ORDER BY student_count DESC NULLS LAST, b.branch_name
        `;
      const studentsByBranchResult = await query(studentsByBranchQuery, branchParams);

      const invoiceStatusQuery = branchFilter
        ? `
          SELECT
            status,
            COUNT(*) AS count,
            COALESCE(SUM(amount), 0) AS total_amount
          FROM invoicestbl i
          WHERE i.branch_id = $1
          GROUP BY status
        `
        : `
          SELECT
            status,
            COUNT(*) AS count,
            COALESCE(SUM(amount), 0) AS total_amount
          FROM invoicestbl i
          GROUP BY status
        `;
      const invoiceStatusResult = await query(invoiceStatusQuery, branchParams);

      const reservationStatusQuery = branchFilter
        ? `
          SELECT
            status,
            COUNT(*) AS count
          FROM reservedstudentstbl r
          WHERE r.branch_id = $1
          GROUP BY status
        `
        : `
          SELECT
            status,
            COUNT(*) AS count
          FROM reservedstudentstbl r
          GROUP BY status
        `;
      const reservationStatusResult = await query(reservationStatusQuery, branchParams);

      // Get all branches for filter dropdown
      const branchesResult = await query(`
        SELECT branch_id, branch_name
        FROM branchestbl
        ORDER BY branch_name
      `);

      // Get crossing procedures data (students enrolled in classes from different branches)
      const crossingProceduresQuery = branchFilter
        ? `
          SELECT
            cs.classstudent_id,
            u.user_id as student_id,
            u.full_name as student_name,
            u.branch_id as student_branch_id,
            b_student.branch_name as student_branch_name,
            c.class_id,
            c.class_name,
            c.level_tag,
            c.branch_id as class_branch_id,
            b_class.branch_name as class_branch_name,
            p.program_name,
            cs.enrolled_at,
            cs.phase_number
          FROM classstudentstbl cs
          INNER JOIN userstbl u ON cs.student_id = u.user_id
          INNER JOIN classestbl c ON cs.class_id = c.class_id
          LEFT JOIN branchestbl b_student ON u.branch_id = b_student.branch_id
          LEFT JOIN branchestbl b_class ON c.branch_id = b_class.branch_id
          LEFT JOIN programstbl p ON c.program_id = p.program_id
          WHERE u.user_type = 'Student'
            AND u.branch_id IS NOT NULL
            AND c.branch_id IS NOT NULL
            AND u.branch_id != c.branch_id
            AND (u.branch_id = $1 OR c.branch_id = $1)
          ORDER BY cs.enrolled_at DESC
          LIMIT 50
        `
        : `
          SELECT
            cs.classstudent_id,
            u.user_id as student_id,
            u.full_name as student_name,
            u.branch_id as student_branch_id,
            b_student.branch_name as student_branch_name,
            c.class_id,
            c.class_name,
            c.level_tag,
            c.branch_id as class_branch_id,
            b_class.branch_name as class_branch_name,
            p.program_name,
            cs.enrolled_at,
            cs.phase_number
          FROM classstudentstbl cs
          INNER JOIN userstbl u ON cs.student_id = u.user_id
          INNER JOIN classestbl c ON cs.class_id = c.class_id
          LEFT JOIN branchestbl b_student ON u.branch_id = b_student.branch_id
          LEFT JOIN branchestbl b_class ON c.branch_id = b_class.branch_id
          LEFT JOIN programstbl p ON c.program_id = p.program_id
          WHERE u.user_type = 'Student'
            AND u.branch_id IS NOT NULL
            AND c.branch_id IS NOT NULL
            AND u.branch_id != c.branch_id
          ORDER BY cs.enrolled_at DESC
          LIMIT 50
        `;
      const crossingProceduresResult = await query(crossingProceduresQuery, branchParams);

      res.json({
        success: true,
        data: {
          totals: {
            total_branches: parseInt(totals.total_branches, 10) || 0,
            total_students: parseInt(totals.total_students, 10) || 0,
            total_teachers: parseInt(totals.total_teachers, 10) || 0,
            active_classes: parseInt(totals.active_classes, 10) || 0,
          },
          monthly_enrollments: monthlyEnrollments,
          invoice_trend: invoiceTrend,
          students_by_branch: studentsByBranchResult.rows.map((row) => ({
            branch_id: row.branch_id,
            branch_name: row.branch_name || 'Unassigned',
            student_count: parseInt(row.student_count, 10) || 0,
          })),
          invoice_status: invoiceStatusResult.rows.map((row) => ({
            status: row.status || 'Unknown',
            count: parseInt(row.count, 10) || 0,
            total_amount: parseFloat(row.total_amount) || 0,
          })),
          reservation_status: reservationStatusResult.rows.map((row) => ({
            status: row.status || 'Unknown',
            count: parseInt(row.count, 10) || 0,
          })),
          branches: branchesResult.rows.map((row) => ({
            branch_id: row.branch_id,
            branch_name: row.branch_name,
          })),
          crossing_procedures: {
            total_violations: crossingProceduresResult.rows.length,
            violations: crossingProceduresResult.rows.map((row) => ({
              classstudent_id: row.classstudent_id,
              student_id: row.student_id,
              student_name: row.student_name,
              student_branch_id: row.student_branch_id,
              student_branch_name: row.student_branch_name || 'Unassigned',
              class_id: row.class_id,
              class_name: row.class_name || row.level_tag,
              level_tag: row.level_tag,
              class_branch_id: row.class_branch_id,
              class_branch_name: row.class_branch_name || 'Unassigned',
              program_name: row.program_name,
              enrolled_at: row.enrolled_at ? row.enrolled_at.toISOString() : null,
              phase_number: row.phase_number,
            })),
          },
          selected_branch_id: branchFilter,
          updated_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/dashboard/cohort-retention
 * Get cohort retention analysis (students grouped by enrollment month, tracked over time)
 * Access: Superadmin, Admin, Finance
 */
router.get(
  '/cohort-retention',
  [
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('teacher_id').optional().isInt().withMessage('Teacher ID must be an integer'),
    queryValidator('room_id').optional().isInt().withMessage('Room ID must be an integer'),
    queryValidator('program_id').optional().isInt().withMessage('Program ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    try {
      const { branch_id, teacher_id, room_id, program_id } = req.query;

      // Build filter conditions
      const filterConditions = [];
      const filterParams = [];
      let paramCount = 0;

      if (branch_id) {
        paramCount++;
        filterConditions.push(`c.branch_id = $${paramCount}`);
        filterParams.push(parseInt(branch_id, 10));
      } else if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        // For non-superadmin, filter by their branch
        paramCount++;
        filterConditions.push(`c.branch_id = $${paramCount}`);
        filterParams.push(req.user.branchId);
      }

      if (teacher_id) {
        paramCount++;
        filterConditions.push(`c.teacher_id = $${paramCount}`);
        filterParams.push(parseInt(teacher_id, 10));
      }

      if (room_id) {
        paramCount++;
        filterConditions.push(`c.room_id = $${paramCount}`);
        filterParams.push(parseInt(room_id, 10));
      }

      if (program_id) {
        paramCount++;
        filterConditions.push(`c.program_id = $${paramCount}`);
        filterParams.push(parseInt(program_id, 10));
      }

      const filterWhere = filterConditions.length > 0
        ? `AND ${filterConditions.join(' AND ')}`
        : '';

      // Step 1: Get student cohorts (first enrollment month)
      const cohortsQuery = `
        WITH student_first_enrollment AS (
          SELECT 
            cs.student_id,
            DATE_TRUNC('month', MIN(cs.enrolled_at))::date AS cohort_month
          FROM classstudentstbl cs
          INNER JOIN classestbl c ON cs.class_id = c.class_id
          WHERE 1=1 ${filterWhere}
          GROUP BY cs.student_id
        ),
        -- For each student and each month, check if active
        student_monthly_activity AS (
          SELECT 
            sfe.cohort_month,
            sfe.student_id,
            DATE_TRUNC('month', cs.enrolled_at)::date AS activity_month,
            MAX(CASE 
              WHEN cs.enrollment_status = 'Active' 
                AND (cs.removed_at IS NULL OR cs.removed_at > DATE_TRUNC('month', cs.enrolled_at))
              THEN 1 
              ELSE 0 
            END) AS is_active
          FROM student_first_enrollment sfe
          INNER JOIN classstudentstbl cs ON sfe.student_id = cs.student_id
          INNER JOIN classestbl c ON cs.class_id = c.class_id
          WHERE 1=1 ${filterWhere}
          GROUP BY sfe.cohort_month, sfe.student_id, activity_month
        )
        SELECT 
          TO_CHAR(cohort_month, 'Mon YYYY') AS cohort_label,
          cohort_month,
          TO_CHAR(activity_month, 'Mon YYYY') AS activity_label,
          activity_month,
          SUM(is_active) AS active_count,
          COUNT(DISTINCT student_id) AS cohort_size
        FROM student_monthly_activity
        GROUP BY cohort_month, activity_month
        ORDER BY cohort_month, activity_month;
      `;

      const result = await query(cohortsQuery, filterParams);

      // Transform to cohort structure: { cohort: 'Jan 2025', months: { 'Jan 2025': {active, total, pct}, 'Feb 2025': {...}, ... } }
      const cohortMap = {};
      for (const row of result.rows) {
        const cohortLabel = row.cohort_label;
        const activityLabel = row.activity_label;
        const activeCount = parseInt(row.active_count, 10);
        const cohortSize = parseInt(row.cohort_size, 10);
        const percentage = cohortSize > 0 ? ((activeCount / cohortSize) * 100).toFixed(1) : '0.0';

        if (!cohortMap[cohortLabel]) {
          cohortMap[cohortLabel] = {
            cohort_month: row.cohort_month,
            cohort_label: cohortLabel,
            total: cohortSize,
            months: {},
          };
        }

        cohortMap[cohortLabel].months[activityLabel] = {
          active: activeCount,
          total: cohortSize,
          percentage: parseFloat(percentage),
        };
      }

      const cohorts = Object.values(cohortMap);

      res.json({
        success: true,
        data: {
          cohorts,
        },
      });
    } catch (error) {
      console.error('Error fetching cohort retention:', error);
      next(error);
    }
  }
);

/**
 * GET /api/sms/dashboard/operational-summary
 * Returns: students per class, students per teacher, students per room (active enrollments only)
 * Access: Superadmin, Admin, Finance
 */
router.get(
  '/operational-summary',
  [
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('teacher_id').optional().isInt().withMessage('Teacher ID must be an integer'),
    queryValidator('room_id').optional().isInt().withMessage('Room ID must be an integer'),
    queryValidator('program_id').optional().isInt().withMessage('Program ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    try {
      const { branch_id, teacher_id, room_id, program_id } = req.query;

      const filterConditions = [];
      const filterParams = [];
      let paramCount = 0;

      if (branch_id) {
        paramCount++;
        filterConditions.push(`c.branch_id = $${paramCount}`);
        filterParams.push(parseInt(branch_id, 10));
      } else if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        paramCount++;
        filterConditions.push(`c.branch_id = $${paramCount}`);
        filterParams.push(req.user.branchId);
      }

      if (teacher_id) {
        paramCount++;
        filterConditions.push(`c.teacher_id = $${paramCount}`);
        filterParams.push(parseInt(teacher_id, 10));
      }

      if (room_id) {
        paramCount++;
        filterConditions.push(`c.room_id = $${paramCount}`);
        filterParams.push(parseInt(room_id, 10));
      }

      if (program_id) {
        paramCount++;
        filterConditions.push(`c.program_id = $${paramCount}`);
        filterParams.push(parseInt(program_id, 10));
      }

      const filterWhere = filterConditions.length > 0
        ? `AND ${filterConditions.join(' AND ')}`
        : '';

      const activeEnrollment = `cs.enrollment_status = 'Active' AND cs.removed_at IS NULL`;

      const [perClassResult, perTeacherResult, perRoomResult] = await Promise.all([
        query(
          `SELECT c.class_id, c.class_name, c.level_tag, p.program_name, c.branch_id,
                  COUNT(cs.student_id) AS student_count
           FROM classestbl c
           LEFT JOIN classstudentstbl cs ON c.class_id = cs.class_id AND ${activeEnrollment}
           LEFT JOIN programstbl p ON c.program_id = p.program_id
           WHERE 1=1 ${filterWhere}
           GROUP BY c.class_id, c.class_name, c.level_tag, p.program_name, c.branch_id
           ORDER BY student_count DESC`,
          filterParams
        ),
        query(
          `SELECT c.teacher_id, u.full_name AS teacher_name, COUNT(DISTINCT cs.student_id) AS student_count
           FROM classestbl c
           INNER JOIN classstudentstbl cs ON c.class_id = cs.class_id AND ${activeEnrollment}
           LEFT JOIN userstbl u ON c.teacher_id = u.user_id
           WHERE 1=1 ${filterWhere}
           GROUP BY c.teacher_id, u.full_name
           ORDER BY student_count DESC`,
          filterParams
        ),
        query(
          `SELECT c.room_id, r.room_name, COUNT(DISTINCT cs.student_id) AS student_count
           FROM classestbl c
           INNER JOIN classstudentstbl cs ON c.class_id = cs.class_id AND ${activeEnrollment}
           LEFT JOIN roomstbl r ON c.room_id = r.room_id
           WHERE 1=1 ${filterWhere}
           GROUP BY c.room_id, r.room_name
           ORDER BY student_count DESC`,
          filterParams
        ),
      ]);

      res.json({
        success: true,
        data: {
          studentsPerClass: perClassResult.rows.map((row) => ({
            class_id: row.class_id,
            class_name: row.class_name || row.level_tag || `Class ${row.class_id}`,
            level_tag: row.level_tag,
            program_name: row.program_name,
            branch_id: row.branch_id,
            student_count: parseInt(row.student_count, 10) || 0,
          })),
          studentsPerTeacher: perTeacherResult.rows.map((row) => ({
            teacher_id: row.teacher_id,
            teacher_name: row.teacher_name || `Teacher ${row.teacher_id}`,
            student_count: parseInt(row.student_count, 10) || 0,
          })),
          studentsPerRoom: perRoomResult.rows.map((row) => ({
            room_id: row.room_id,
            room_name: row.room_name || `Room ${row.room_id}`,
            student_count: parseInt(row.student_count, 10) || 0,
          })),
        },
      });
    } catch (error) {
      console.error('Error fetching operational summary:', error);
      next(error);
    }
  }
);

export default router;

