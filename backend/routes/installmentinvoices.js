import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query, getClient } from '../config/database.js';
import { calculateNextGenerationDate, calculateNextInvoiceMonth } from '../utils/installmentInvoiceGenerator.js';
import { formatYmdLocal } from '../utils/dateUtils.js';
import {
  buildPhaseInstallmentSchedule,
  isPhaseInstallmentProfile,
} from '../utils/phaseInstallmentUtils.js';
import { insertInvoiceWithArNumber } from '../utils/invoiceArNumber.js';

const router = express.Router();

// All routes require authentication
router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

const enrichInstallmentInvoiceRow = async (row) => {
  const profile = {
    class_id: row.class_id,
    total_phases: row.total_phases,
    generated_count: row.generated_count,
    phase_start: row.phase_start,
  };

  const totalPhases = row.total_phases != null ? parseInt(row.total_phases, 10) : null;
  const phaseStart = row.phase_start != null ? parseInt(row.phase_start, 10) : 1;
  const paidPhases = parseInt(row.paid_phases || 0, 10) || 0;
  const generatedPhases = parseInt(row.generated_phases || row.generated_count || 0, 10) || 0;
  const lastEnrolledPhaseNumber = row.last_enrolled_phase_number != null
    ? parseInt(row.last_enrolled_phase_number, 10)
    : null;
  // Billing progress for the Installment Invoice Logs should reflect billing records only,
  // not historical class enrollment phase. This keeps it consistent with Invoice page data.
  const billingPhaseProgress = Math.max(paidPhases, generatedPhases, 0);
  const displayPhaseProgress = totalPhases != null
    ? Math.min(billingPhaseProgress, totalPhases)
    : billingPhaseProgress;

  if (!isPhaseInstallmentProfile(profile)) {
    return {
      ...row,
      display_phase_progress: displayPhaseProgress,
      last_enrolled_phase_number: lastEnrolledPhaseNumber,
    };
  }

  try {
    const schedule = await buildPhaseInstallmentSchedule({
      db: { query },
      profile,
      generatedCountOverride: row.generated_count || 0,
      issueDateOverride: row.next_generation_date || null,
    });

    return {
      ...row,
      display_phase_progress: displayPhaseProgress,
      last_enrolled_phase_number: lastEnrolledPhaseNumber,
      current_phase_number: schedule.current_phase_number,
      current_phase_start_date: schedule.current_phase_start_date,
      current_issue_date: schedule.current_issue_date,
      current_due_date: schedule.current_due_date,
      current_invoice_month: schedule.current_invoice_month,
      current_generation_date: schedule.current_generation_date,
      computed_next_phase_number: schedule.next_phase_number,
      computed_next_phase_start_date: schedule.next_phase_start_date,
      computed_next_issue_date: schedule.next_issue_date,
      computed_next_due_date: schedule.next_due_date,
      computed_next_invoice_month: schedule.next_invoice_month,
      computed_next_generation_date: schedule.next_generation_date,
      is_last_phase: schedule.is_last_phase,
    };
  } catch (error) {
    return {
      ...row,
      display_phase_progress: displayPhaseProgress,
      last_enrolled_phase_number: lastEnrolledPhaseNumber,
      phase_schedule_error: error.message,
    };
  }
};

/**
 * GET /api/sms/installment-invoices/profiles
 * Get all installment invoice profiles with their generated invoices
 * Access: All authenticated users
 */
router.get(
  '/profiles',
  [
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('student_id').optional().isInt().withMessage('Student ID must be an integer'),
    queryValidator('is_active').optional().isBoolean().withMessage('is_active must be a boolean'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { branch_id, student_id, is_active, page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      let sql = 'SELECT * FROM installmentinvoiceprofilestbl WHERE 1=1';
      const params = [];
      let paramCount = 0;

      // Filter by branch (non-superadmin users are limited to their branch)
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        paramCount++;
        sql += ` AND branch_id = $${paramCount}`;
        params.push(req.user.branchId);
      } else if (branch_id) {
        paramCount++;
        sql += ` AND branch_id = $${paramCount}`;
        params.push(branch_id);
      }

      if (student_id) {
        paramCount++;
        sql += ` AND student_id = $${paramCount}`;
        params.push(student_id);
      }

      if (is_active !== undefined) {
        paramCount++;
        sql += ` AND is_active = $${paramCount}`;
        params.push(is_active === 'true');
      } else {
        // Default: only active profiles (e.g. unenrolled students are inactive and excluded from list)
        sql += ' AND is_active = true';
      }

      sql += ` ORDER BY installmentinvoiceprofiles_id DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limit, offset);

      const result = await query(sql, params);

      // Fetch generated invoices for each profile
      const profilesWithInvoices = await Promise.all(
        result.rows.map(async (profile) => {
          const invoicesResult = await query(
            'SELECT * FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1 ORDER BY scheduled_date DESC',
            [profile.installmentinvoiceprofiles_id]
          );

          return {
            ...profile,
            invoices: invoicesResult.rows,
          };
        })
      );

      res.json({
        success: true,
        data: profilesWithInvoices,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/installment-invoices/profiles/:id
 * Get installment invoice profile by ID with generated invoices
 */
router.get(
  '/profiles/:id',
  [
    param('id').isInt().withMessage('Profile ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const result = await query('SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1', [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Installment invoice profile not found',
        });
      }

      // Fetch generated invoices
      const invoicesResult = await query(
        'SELECT * FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1 ORDER BY scheduled_date DESC',
        [id]
      );

      res.json({
        success: true,
        data: {
          ...result.rows[0],
          invoices: invoicesResult.rows,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sms/installment-invoices/profiles
 * Create new installment invoice profile
 * Access: Superadmin, Admin
 */
router.post(
  '/profiles',
  [
    body('student_id').isInt().withMessage('Student ID is required and must be an integer'),
    body('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    body('package_id').optional().isInt().withMessage('Package ID must be an integer'),
    body('amount').isFloat({ min: 0 }).withMessage('Amount is required and must be a positive number'),
    body('frequency').optional().isString().withMessage('Frequency must be a string'),
    body('description').optional().isString().withMessage('Description must be a string'),
    body('day_of_month').optional().isInt({ min: 1, max: 31 }).withMessage('Day of month must be between 1 and 31'),
    body('is_active').optional().isBoolean().withMessage('is_active must be a boolean'),
    body('bill_invoice_due_date').optional().isISO8601().withMessage('Bill invoice due date must be a valid date'),
    body('next_invoice_due_date').optional().isISO8601().withMessage('Next invoice due date must be a valid date'),
    body('first_billing_month').optional().isISO8601().withMessage('First billing month must be a valid date'),
    body('first_generation_date').optional().isISO8601().withMessage('First generation date must be a valid date'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    try {
      const {
        student_id,
        branch_id,
        package_id,
        amount,
        frequency,
        description,
        day_of_month,
        is_active,
        bill_invoice_due_date,
        next_invoice_due_date,
        first_billing_month,
        first_generation_date,
      } = req.body;

      // Verify student exists
      const studentCheck = await query('SELECT user_id FROM userstbl WHERE user_id = $1', [student_id]);
      if (studentCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Student not found',
        });
      }

      // Verify branch exists if provided
      if (branch_id) {
        const branchCheck = await query('SELECT branch_id FROM branchestbl WHERE branch_id = $1', [branch_id]);
        if (branchCheck.rows.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Branch not found',
          });
        }
      }

      // Verify package exists if provided
      if (package_id) {
        const packageCheck = await query('SELECT package_id FROM packagestbl WHERE package_id = $1', [package_id]);
        if (packageCheck.rows.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Package not found',
          });
        }
      }

      // Get created_by from authenticated user
      const createdBy = req.user.fullName || req.user.email || null;

      const result = await query(
        `INSERT INTO installmentinvoiceprofilestbl 
         (student_id, branch_id, package_id, amount, frequency, description, day_of_month, is_active, 
          bill_invoice_due_date, next_invoice_due_date, first_billing_month, first_generation_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          student_id,
          branch_id || null,
          package_id || null,
          amount,
          frequency || null,
          description || null,
          day_of_month || null,
          is_active !== undefined ? is_active : true,
          bill_invoice_due_date || null,
          next_invoice_due_date || null,
          first_billing_month || null,
          first_generation_date || null,
          createdBy,
        ]
      );

      res.status(201).json({
        success: true,
        message: 'Installment invoice profile created successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/sms/installment-invoices/profiles/:id
 * Update installment invoice profile
 * Access: Superadmin, Admin
 */
router.put(
  '/profiles/:id',
  [
    param('id').isInt().withMessage('Profile ID must be an integer'),
    body('amount').optional().isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
    body('frequency').optional().isString().withMessage('Frequency must be a string'),
    body('description').optional().isString().withMessage('Description must be a string'),
    body('day_of_month').optional().isInt({ min: 1, max: 31 }).withMessage('Day of month must be between 1 and 31'),
    body('is_active').optional().isBoolean().withMessage('is_active must be a boolean'),
    body('bill_invoice_due_date').optional().isISO8601().withMessage('Bill invoice due date must be a valid date'),
    body('next_invoice_due_date').optional().isISO8601().withMessage('Next invoice due date must be a valid date'),
    body('first_billing_month').optional().isISO8601().withMessage('First billing month must be a valid date'),
    body('first_generation_date').optional().isISO8601().withMessage('First generation date must be a valid date'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const {
        amount,
        frequency,
        description,
        day_of_month,
        is_active,
        bill_invoice_due_date,
        next_invoice_due_date,
        first_billing_month,
        first_generation_date,
      } = req.body;

      // Check if profile exists
      const existingProfile = await query('SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1', [id]);
      if (existingProfile.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Installment invoice profile not found',
        });
      }

      // Build update query
      const updates = [];
      const params = [];
      let paramCount = 0;

      const fields = {
        amount,
        frequency,
        description,
        day_of_month,
        is_active,
        bill_invoice_due_date,
        next_invoice_due_date,
        first_billing_month,
        first_generation_date,
      };

      Object.entries(fields).forEach(([key, value]) => {
        if (value !== undefined) {
          paramCount++;
          updates.push(`${key} = $${paramCount}`);
          params.push(value);
        }
      });

      if (updates.length > 0) {
        paramCount++;
        params.push(id);
        const sql = `UPDATE installmentinvoiceprofilestbl SET ${updates.join(', ')} WHERE installmentinvoiceprofiles_id = $${paramCount} RETURNING *`;
        await query(sql, params);
      }

      // Fetch updated profile
      const profileResult = await query('SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1', [id]);

      res.json({
        success: true,
        message: 'Installment invoice profile updated successfully',
        data: profileResult.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/sms/installment-invoices/profiles/:id
 * Delete installment invoice profile and its generated invoices
 * Access: Superadmin, Admin
 */
router.delete(
  '/profiles/:id',
  [
    param('id').isInt().withMessage('Profile ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;

      const existingProfile = await client.query('SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1', [id]);
      if (existingProfile.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Installment invoice profile not found',
        });
      }

      // Delete generated invoices first (due to foreign key)
      await client.query('DELETE FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1', [id]);

      // Delete profile
      await client.query('DELETE FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1', [id]);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Installment invoice profile deleted successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * GET /api/sms/installment-invoices/profiles-needed-phase-1
 * Returns profiles where downpayment is paid but Phase 1 was not generated
 */
router.get(
  '/profiles-needed-phase-1',
  [
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { branch_id } = req.query;
      let sql = `
        SELECT ip.*, u.full_name as student_name, p.program_name
        FROM installmentinvoiceprofilestbl ip
        LEFT JOIN userstbl u ON ip.student_id = u.user_id
        LEFT JOIN classestbl c ON ip.class_id = c.class_id
        LEFT JOIN programstbl p ON c.program_id = p.program_id
        WHERE ip.is_active = true
          AND COALESCE(ip.generated_count, 0) = 0
          AND EXISTS (
            SELECT 1 FROM invoicestbl i
            WHERE i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
              AND i.status = 'Paid'
          )
      `;
      const params = [];
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        sql += ' AND ip.branch_id = $1';
        params.push(req.user.branchId);
      } else if (branch_id) {
        sql += ' AND ip.branch_id = $1';
        params.push(branch_id);
      }
      sql += ' ORDER BY ip.installmentinvoiceprofiles_id DESC';
      const result = await query(sql, params);
      res.json({ success: true, data: result.rows });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/sms/installment-invoices/profiles/:id/generate-phase-1
 * Retry Phase 1 generation when downpayment is paid but Phase 1 was not auto-generated
 * Access: Superadmin, Admin, Finance
 */
router.post(
  '/profiles/:id/generate-phase-1',
  [
    param('id').isInt().withMessage('Profile ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const { id } = req.params;

      const profileResult = await client.query(
        `SELECT ip.*, u.full_name as student_name
         FROM installmentinvoiceprofilestbl ip
         LEFT JOIN userstbl u ON ip.student_id = u.user_id
         WHERE ip.installmentinvoiceprofiles_id = $1`,
        [id]
      );
      if (profileResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Profile not found' });
      }
      const profile = profileResult.rows[0];

      if ((profile.generated_count || 0) > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Phase 1 already generated. Use the regular Generate button for next phases.',
        });
      }

      // Find downpayment invoice (explicit or first linked invoice)
      const downpaymentInvoiceId = profile.downpayment_invoice_id;
      let downpaymentPaid = false;
      if (downpaymentInvoiceId) {
        const invCheck = await client.query(
          'SELECT status FROM invoicestbl WHERE invoice_id = $1',
          [downpaymentInvoiceId]
        );
        downpaymentPaid = invCheck.rows.length > 0 && invCheck.rows[0].status === 'Paid';
      }
      if (!downpaymentPaid) {
        const linkedPaid = await client.query(
          `SELECT invoice_id FROM invoicestbl
           WHERE installmentinvoiceprofiles_id = $1 AND status = 'Paid' LIMIT 1`,
          [id]
        );
        if (linkedPaid.rows.length > 0) {
          downpaymentPaid = true;
          if (!profile.downpayment_invoice_id) {
            await client.query(
              `UPDATE installmentinvoiceprofilestbl SET downpayment_invoice_id = $1, downpayment_paid = true WHERE installmentinvoiceprofiles_id = $2`,
              [linkedPaid.rows[0].invoice_id, id]
            );
          }
        }
      }
      if (!downpaymentPaid) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Downpayment must be paid before generating Phase 1.',
        });
      }

      // Ensure downpayment_paid is set
      await client.query(
        `UPDATE installmentinvoiceprofilestbl SET downpayment_paid = true WHERE installmentinvoiceprofiles_id = $1`,
        [id]
      );

      // Get or create first installment invoice record
      let firstRecordResult = await client.query(
        'SELECT * FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1 ORDER BY installmentinvoicedtl_id ASC LIMIT 1',
        [id]
      );
      let firstRecord = firstRecordResult.rows[0];

      if (!firstRecord) {
        const nextDue = profile.next_invoice_due_date
          ? new Date(profile.next_invoice_due_date)
          : new Date();
        const firstGen = profile.first_generation_date
          ? new Date(profile.first_generation_date)
          : new Date();
        const insertResult = await client.query(
          `INSERT INTO installmentinvoicestbl
           (installmentinvoiceprofiles_id, scheduled_date, status, student_name,
            total_amount_including_tax, total_amount_excluding_tax, frequency,
            next_generation_date, next_invoice_month)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            id,
            profile.bill_invoice_due_date || formatYmdLocal(nextDue),
            'Pending',
            profile.student_name || 'Student',
            profile.amount,
            profile.amount,
            profile.frequency || '1 month(s)',
            formatYmdLocal(firstGen),
            formatYmdLocal(nextDue),
          ]
        );
        firstRecord = insertResult.rows[0];
      }

      await client.query('COMMIT');

      const { generateInvoiceFromInstallment } = await import('../utils/installmentInvoiceGenerator.js');
      const genProfile = {
        student_id: profile.student_id,
        branch_id: profile.branch_id,
        package_id: profile.package_id,
        amount: profile.amount,
        frequency: profile.frequency || '1 month(s)',
        description: profile.description || 'Monthly Installment Payment',
        generated_count: 0,
        class_id: profile.class_id,
        total_phases: profile.total_phases,
        phase_start: profile.phase_start,
      };
      const generatedInvoice = await generateInvoiceFromInstallment(firstRecord, genProfile);

      res.status(201).json({
        success: true,
        message: 'Phase 1 invoice generated successfully',
        data: { invoice_id: generatedInvoice.invoice_id },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

/**
 * GET /api/sms/installment-invoices/invoices
 * Get all generated installment invoices
 * Access: All authenticated users
 */
router.get(
  '/invoices',
  [
    queryValidator('profile_id').optional().isInt().withMessage('Profile ID must be an integer'),
    queryValidator('status').optional().isString().withMessage('Status must be a string'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 500 }).withMessage('Limit must be between 1 and 500'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { profile_id, status } = req.query;
      const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limitNum = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const offset = (pageNum - 1) * limitNum;

      const filterFragments = [];
      const filterParams = [];
      let fp = 0;

      // Filter by branch (non-superadmin users are limited to their branch)
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        fp++;
        filterFragments.push(`ip.branch_id = $${fp}`);
        filterParams.push(req.user.branchId);
      }

      if (profile_id) {
        fp++;
        filterFragments.push(`ii.installmentinvoiceprofiles_id = $${fp}`);
        filterParams.push(profile_id);
      }

      if (status) {
        fp++;
        filterFragments.push(`ii.status = $${fp}`);
        filterParams.push(status);
      }

      const filterSql = filterFragments.length ? ` AND ${filterFragments.join(' AND ')}` : '';

      const countSql = `
        SELECT COUNT(*)::bigint AS total
        FROM installmentinvoicestbl ii
        JOIN installmentinvoiceprofilestbl ip ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
        WHERE 1=1${filterSql}
      `;
      const countResult = await query(countSql, filterParams);
      const total = parseInt(countResult.rows[0]?.total || 0, 10);

      let sql = `
        SELECT ii.*, ip.student_id, ip.branch_id, ip.package_id, ip.amount as profile_amount, 
               ip.frequency as profile_frequency, ip.description, ip.class_id, ip.total_phases, ip.generated_count, ip.phase_start,
               ip.is_active as profile_is_active,
               ip.downpayment_invoice_id,
               c.start_date::text as class_start_date,
               (SELECT COUNT(DISTINCT COALESCE(i.invoice_chain_root_id, i.invoice_id))
                FROM invoicestbl i 
                WHERE i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id 
                  AND i.status = 'Paid'
                  AND (
                    ip.downpayment_invoice_id IS NULL OR
                    COALESCE(i.invoice_chain_root_id, i.invoice_id) != ip.downpayment_invoice_id::INTEGER
                  )
               ) as paid_phases,
               (SELECT COUNT(DISTINCT COALESCE(i.invoice_chain_root_id, i.invoice_id))
                FROM invoicestbl i 
                WHERE i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id 
                  AND (
                    ip.downpayment_invoice_id IS NULL OR
                    COALESCE(i.invoice_chain_root_id, i.invoice_id) != ip.downpayment_invoice_id::INTEGER
                  )
               ) as generated_phases,
               (SELECT MAX(cs.phase_number)
                FROM classstudentstbl cs
                WHERE cs.student_id = ip.student_id
                  AND cs.class_id = ip.class_id
               ) as last_enrolled_phase_number,
               p.program_name, u.full_name as student_name
        FROM installmentinvoicestbl ii
        JOIN installmentinvoiceprofilestbl ip ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
        LEFT JOIN classestbl c ON ip.class_id = c.class_id
        LEFT JOIN programstbl p ON c.program_id = p.program_id
        LEFT JOIN userstbl u ON ip.student_id = u.user_id
        WHERE 1=1${filterSql}
      `;

      const listParams = [...filterParams];
      fp = filterParams.length;
      sql += ` ORDER BY ii.scheduled_date DESC LIMIT $${fp + 1} OFFSET $${fp + 2}`;
      listParams.push(limitNum, offset);

      const result = await query(sql, listParams);
      const enrichedRows = await Promise.all(result.rows.map(enrichInstallmentInvoiceRow));

      const totalPages = total > 0 ? Math.ceil(total / limitNum) : 1;

      res.json({
        success: true,
        data: enrichedRows,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/installment-invoices/invoices/:id
 * Get installment invoice by ID
 */
router.get(
  '/invoices/:id',
  [
    param('id').isInt().withMessage('Invoice ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const result = await query(
        `SELECT ii.*, ip.student_id, ip.branch_id, ip.package_id, ip.amount as profile_amount, 
                ip.frequency as profile_frequency, ip.class_id, ip.total_phases, ip.generated_count, ip.phase_start,
                c.start_date::text as class_start_date,
                p.program_name, u.full_name as student_name
         FROM installmentinvoicestbl ii
         JOIN installmentinvoiceprofilestbl ip ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
         LEFT JOIN classestbl c ON ip.class_id = c.class_id
         LEFT JOIN programstbl p ON c.program_id = p.program_id
         LEFT JOIN userstbl u ON ip.student_id = u.user_id
         WHERE ii.installmentinvoicedtl_id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Installment invoice not found',
        });
      }

      const enrichedRow = await enrichInstallmentInvoiceRow(result.rows[0]);

      res.json({
        success: true,
        data: enrichedRow,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/sms/installment-invoices/invoices/:id
 * Update installment invoice (mainly status)
 * Access: Superadmin, Admin
 */
router.put(
  '/invoices/:id',
  [
    param('id').isInt().withMessage('Invoice ID must be an integer'),
    body('status').optional().isString().withMessage('Status must be a string'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const existingInvoice = await query('SELECT * FROM installmentinvoicestbl WHERE installmentinvoicedtl_id = $1', [id]);
      if (existingInvoice.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Installment invoice not found',
        });
      }

      if (status !== undefined) {
        await query(
          'UPDATE installmentinvoicestbl SET status = $1 WHERE installmentinvoicedtl_id = $2 RETURNING *',
          [status, id]
        );
      }

      const invoiceResult = await query('SELECT * FROM installmentinvoicestbl WHERE installmentinvoicedtl_id = $1', [id]);

      res.json({
        success: true,
        message: 'Installment invoice updated successfully',
        data: invoiceResult.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/sms/installment-invoices/invoices/:id
 * Delete an installment invoice log row
 * Access: Superadmin, Admin, Finance
 */
router.delete(
  '/invoices/:id',
  [
    param('id').isInt().withMessage('Invoice ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const existingInvoice = await query(
        'SELECT * FROM installmentinvoicestbl WHERE installmentinvoicedtl_id = $1',
        [id]
      );
      if (existingInvoice.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Installment invoice not found',
        });
      }

      await query(
        'DELETE FROM installmentinvoicestbl WHERE installmentinvoicedtl_id = $1',
        [id]
      );

      res.json({
        success: true,
        message: 'Installment invoice deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sms/installment-invoices/process-due
 * Manually trigger processing of due installment invoices
 * Access: Superadmin, Admin
 */
router.post(
  '/process-due',
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    try {
      const { processDueInstallmentInvoices } = await import('../utils/installmentInvoiceGenerator.js');
      const result = await processDueInstallmentInvoices();
      
      res.json({
        success: true,
        message: `Processed ${result.processed} installment invoice(s)`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sms/installment-invoices/invoices/:id/generate
 * Manually generate invoice from installment invoice
 * Access: Superadmin, Admin
 */
router.post(
  '/invoices/:id/generate',
  [
    param('id').isInt().withMessage('Installment invoice ID must be an integer'),
    body('issue_date').isISO8601().withMessage('Issue date is required and must be a valid date'),
    body('due_date').isISO8601().withMessage('Due date is required and must be a valid date'),
    body('invoice_month').isISO8601().withMessage('Invoice month is required and must be a valid date'),
    body('generation_date').optional().isISO8601().withMessage('Generation date must be a valid date'),
    body('next_issue_date').isISO8601().withMessage('Next issue date is required and must be a valid date'),
    body('next_due_date').isISO8601().withMessage('Next due date is required and must be a valid date'),
    body('next_invoice_month').isISO8601().withMessage('Next invoice month is required and must be a valid date'),
    body('next_generation_date').isISO8601().withMessage('Next generation date is required and must be a valid date'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const {
        issue_date,
        due_date,
        invoice_month,
        generation_date,
        next_issue_date,
        next_due_date,
        next_invoice_month,
        next_generation_date,
      } = req.body;

      // Get installment invoice with profile (including phase tracking)
      const installmentResult = await client.query(
        `SELECT ii.*, ip.student_id, ip.branch_id, ip.package_id, ip.amount as profile_amount, 
                ip.frequency as profile_frequency, ip.description, ip.class_id, ip.total_phases, ip.generated_count, ip.phase_start,
                ip.is_active as profile_is_active,
                ip.downpayment_invoice_id,
                p.program_name, u.full_name as student_name
         FROM installmentinvoicestbl ii
         JOIN installmentinvoiceprofilestbl ip ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
         LEFT JOIN classestbl c ON ip.class_id = c.class_id
         LEFT JOIN programstbl p ON c.program_id = p.program_id
         LEFT JOIN userstbl u ON ip.student_id = u.user_id
         WHERE ii.installmentinvoicedtl_id = $1`,
        [id]
      );

      if (installmentResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Installment invoice not found',
        });
      }

      const installmentInvoice = installmentResult.rows[0];
      if (installmentInvoice.profile_is_active === false) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'This student has already been unenrolled. Existing installment invoices and payment logs are preserved, but new installment invoices can no longer be generated.',
        });
      }

      const profile = {
        student_id: installmentInvoice.student_id,
        branch_id: installmentInvoice.branch_id,
        package_id: installmentInvoice.package_id,
        amount: installmentInvoice.profile_amount,
        frequency: installmentInvoice.profile_frequency || installmentInvoice.frequency,
        description: installmentInvoice.description,
        class_id: installmentInvoice.class_id, // Include class_id for enrollment check
        total_phases: installmentInvoice.total_phases,
        generated_count: installmentInvoice.generated_count || 0,
        phase_start: installmentInvoice.phase_start,
      };

      // Get student information
      const studentResult = await client.query(
        'SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1',
        [profile.student_id]
      );

      if (studentResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: `Student with ID ${profile.student_id} not found`,
        });
      }

      const student = studentResult.rows[0];

      const phaseSchedule = isPhaseInstallmentProfile(profile)
        ? await buildPhaseInstallmentSchedule({
            db: client,
            profile,
            generatedCountOverride: profile.generated_count || 0,
            issueDateOverride: installmentInvoice.next_generation_date || issue_date,
          })
        : null;

      const effectiveIssueDate = issue_date;
      const effectiveDueDate = due_date;

      // Create invoice (link to installment invoice profile for phase tracking)
      const newInvoice = await insertInvoiceWithArNumber(
        client,
        `INSERT INTO invoicestbl (invoice_description, branch_id, amount, status, remarks, issue_date, due_date, created_by, installmentinvoiceprofiles_id, invoice_ar_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          'TEMP',
          profile.branch_id || null,
          installmentInvoice.total_amount_including_tax || profile.amount,
          'Unpaid',
          `Manually generated from installment invoice: ${profile.description || 'Installment payment'}${
            phaseSchedule?.current_phase_number ? `;TARGET_PHASE:${phaseSchedule.current_phase_number}` : ''
          }`,
          effectiveIssueDate,
          effectiveDueDate,
          req.user.userId || null,
          installmentInvoice.installmentinvoiceprofiles_id, // Link to installment profile
        ]
      );

      // Update invoice description
      await client.query(
        'UPDATE invoicestbl SET invoice_description = $1 WHERE invoice_id = $2',
        [`INV-${newInvoice.invoice_id}`, newInvoice.invoice_id]
      );

      // Create invoice item
      await client.query(
        `INSERT INTO invoiceitemstbl (invoice_id, description, amount, tax_item, tax_percentage)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          newInvoice.invoice_id,
          profile.description || `Installment payment - ${installmentInvoice.frequency || 'Monthly'}`,
          installmentInvoice.total_amount_excluding_tax || profile.amount,
          null,
          installmentInvoice.total_amount_including_tax && installmentInvoice.total_amount_excluding_tax
            ? ((installmentInvoice.total_amount_including_tax - installmentInvoice.total_amount_excluding_tax) / installmentInvoice.total_amount_excluding_tax * 100)
            : null,
        ]
      );

      // Link student to invoice
      await client.query(
        'INSERT INTO invoicestudentstbl (invoice_id, student_id) VALUES ($1, $2)',
        [newInvoice.invoice_id, profile.student_id]
      );

      // Check phase limit before generating
      // Logic: We can generate invoices until all phases are paid
      // Downpayment is NOT counted as a phase - only paid installment invoices count
      const totalPhases = installmentInvoice.total_phases;
      const maxInvoices = totalPhases !== null ? totalPhases : null; // Max invoices = total_phases (downpayment doesn't count)
      
      const canonicalCountsResult = await client.query(
        `SELECT COUNT(DISTINCT COALESCE(i.invoice_chain_root_id, i.invoice_id)) AS paid_phase_count
         FROM invoicestbl i
         WHERE i.installmentinvoiceprofiles_id = $1
           AND i.status = 'Paid'
           AND (
             $2::INTEGER IS NULL OR
             COALESCE(i.invoice_chain_root_id, i.invoice_id) != $2::INTEGER
           )`,
        [installmentInvoice.installmentinvoiceprofiles_id, installmentInvoice.downpayment_invoice_id || null]
      );
      
      const paidPhases = parseInt(canonicalCountsResult.rows[0]?.paid_phase_count || 0, 10);
      const currentCount = installmentInvoice.generated_count || 0;
      
      // Debug logging
      console.log('Paid invoices count:', paidPhases);
      console.log('Total phases:', totalPhases);
      console.log('Downpayment invoice ID:', installmentInvoice.downpayment_invoice_id);
      
      // Check if all phases are already paid (not just generated)
      // If paid_phases < total_phases, we can still generate invoices
      // This is the key check: allow generation based on paid status, not generated count
      if (totalPhases !== null && paidPhases >= totalPhases) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `All phases are already paid (${paidPhases}/${totalPhases}). Downpayment is not counted as a phase. Cannot generate more invoices.`,
        });
      }
      
      // Increment generated count
      const newCount = currentCount + 1;
      await client.query(
        'UPDATE installmentinvoiceprofilestbl SET generated_count = $1 WHERE installmentinvoiceprofiles_id = $2',
        [newCount, installmentInvoice.installmentinvoiceprofiles_id]
      );
      
      // Check if this was the last invoice (reached phase limit)
      const nextPhaseSchedule = isPhaseInstallmentProfile(profile)
        ? await buildPhaseInstallmentSchedule({
            db: client,
            profile: {
              ...profile,
              generated_count: newCount,
            },
            generatedCountOverride: newCount,
          })
        : null;

      const isLastInvoice = nextPhaseSchedule
        ? nextPhaseSchedule.is_last_phase
        : (maxInvoices !== null && newCount >= maxInvoices);
      
      if (isLastInvoice) {
        // Last invoice - mark profile as inactive and update installment invoice status
        await client.query(
          'UPDATE installmentinvoiceprofilestbl SET is_active = false WHERE installmentinvoiceprofiles_id = $1',
          [installmentInvoice.installmentinvoiceprofiles_id]
        );
        
        await client.query(
          `UPDATE installmentinvoicestbl 
           SET status = 'Generated', scheduled_date = $1
           WHERE installmentinvoicedtl_id = $2`,
          [
            generation_date || new Date().toISOString().split('T')[0],
            id,
          ]
        );
      } else {
        // Advance the row to the next cycle after this manual generation.
        const nextGenYmd = next_generation_date ? String(next_generation_date).trim().slice(0, 10) : null;
        const nextMonthYmd = next_invoice_month ? String(next_invoice_month).trim().slice(0, 10) : null;
        const fallbackDate = new Date().toISOString().split('T')[0];
        await client.query(
          `UPDATE installmentinvoicestbl 
           SET status = 'Generated', next_generation_date = $1, next_invoice_month = $2, scheduled_date = $3
           WHERE installmentinvoicedtl_id = $4`,
          [
            nextGenYmd || fallbackDate,
            nextMonthYmd || fallbackDate,
            generation_date || fallbackDate,
            id,
          ]
        );
      }

      await client.query('COMMIT');

      // Get updated profile data
      const updatedProfile = await client.query(
        'SELECT generated_count, total_phases, is_active FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1',
        [installmentInvoice.installmentinvoiceprofiles_id]
      );
      
      res.status(201).json({
        success: true,
        message: isLastInvoice 
          ? `Invoice generated successfully. All phases completed (${newCount + 1}/${totalPhases} - Phase 1 was paid via initial package). No more invoices will be generated.`
          : 'Invoice generated successfully',
        data: {
          invoice_id: newInvoice.invoice_id,
          invoice_description: `INV-${newInvoice.invoice_id}`,
          student_name: student.full_name,
          amount: installmentInvoice.total_amount_including_tax || profile.amount,
          generated_count: updatedProfile.rows[0]?.generated_count || newCount,
          total_phases: updatedProfile.rows[0]?.total_phases || totalPhases,
          phase_limit_reached: isLastInvoice,
          phases_completed: newCount + 1, // Include Phase 1 that was paid via initial package
          current_phase_number: phaseSchedule?.current_phase_number || null,
          current_due_date: phaseSchedule?.current_due_date || effectiveDueDate,
          next_phase_number: nextPhaseSchedule?.current_phase_number || null,
          next_due_date: nextPhaseSchedule?.current_due_date || (next_due_date ? String(next_due_date).trim().slice(0, 10) : null),
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

export default router;

