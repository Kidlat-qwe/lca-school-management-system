import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query, getClient } from '../config/database.js';
import {
  calculateNextGenerationDate,
  calculateNextInvoiceMonth,
  parseFrequency,
} from '../utils/installmentInvoiceGenerator.js';
import { formatYmdLocal } from '../utils/dateUtils.js';
import {
  buildPhaseInstallmentSchedule,
  isPhaseInstallmentProfile,
} from '../utils/phaseInstallmentUtils.js';
import { insertInvoiceWithArNumber } from '../utils/invoiceArNumber.js';
import {
  syncAllProgramPaymentStatuses,
  syncProgramPaymentStatusForInvoice,
} from '../utils/programPaymentStatusService.js';
import { determineRejoinAwarePhaseStatus } from '../utils/enrollmentStatus.js';

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
  const generatedPhases = parseInt(row.generated_phases || 0, 10) || 0;
  // profile-level generated_count is already advanced past skipped dropped phases
  // (by alignInstallmentProfileForRejoinInvoice / syncInstallmentProfileAfterRejoinPayment),
  // so it is the most reliable billing-position floor when phases were dropped.
  const profileGeneratedCount = parseInt(row.generated_count || 0, 10) || 0;
  const lastEnrolledPhaseNumber = row.last_enrolled_phase_number != null
    ? parseInt(row.last_enrolled_phase_number, 10)
    : null;
  const phaseStartOffset = Math.max(0, (phaseStart || 1) - 1);
  const billedPhaseProgress = Math.max(paidPhases, generatedPhases, profileGeneratedCount, 0);
  const lastEnrolledRelativeProgress =
    lastEnrolledPhaseNumber != null
      ? Math.max(0, lastEnrolledPhaseNumber - phaseStartOffset)
      : 0;
  // Rejoin can skip a dropped phase (e.g. paid/billed phases 1, 2, 4). The log
  // should show the absolute phase reached, not only the count of invoice rows.
  const billingPhaseProgress = Math.max(billedPhaseProgress, lastEnrolledRelativeProgress);
  const displayPhaseProgress = totalPhases != null
    ? Math.min(billingPhaseProgress, totalPhases)
    : billingPhaseProgress;
  const scheduleGeneratedCount = Math.max(
    parseInt(row.generated_count || 0, 10) || 0,
    displayPhaseProgress
  );

  const phaseProgressComplete =
    totalPhases != null &&
    totalPhases > 0 &&
    displayPhaseProgress >= totalPhases;
  const canGenerateInstallment = row.profile_is_active !== false && !phaseProgressComplete;

  const canonId =
    row.canonical_installment_profile_id_for_class != null
      ? parseInt(String(row.canonical_installment_profile_id_for_class), 10)
      : null;
  const thisProfileId =
    row.installmentinvoiceprofiles_id != null
      ? parseInt(String(row.installmentinvoiceprofiles_id), 10)
      : null;
  const planSuperseded =
    row.class_id != null &&
    Number.isFinite(canonId) &&
    Number.isFinite(thisProfileId) &&
    canonId !== thisProfileId;
  const finalCanGenerate = canGenerateInstallment && !planSuperseded;

  const omitCanon = (r) => {
    if (!r || typeof r !== 'object') return r;
    const { canonical_installment_profile_id_for_class: _drop, ...rest } = r;
    return rest;
  };
  const baseRow = omitCanon(row);

  // Absolute phase numbering: when a profile starts at a later phase
  // (e.g. enrolled mid-school-year for phases 6..10), the dashboard's
  // Phase Progress column should reflect those absolute phase numbers
  // (e.g. 6 / 10) instead of the relative profile-local numbers (1 / 5).
  // For profiles starting at phase 1 (or with no phase_start) the absolute
  // numbers equal the relative numbers, so the display is unchanged.
  const phaseProgressNumerator = displayPhaseProgress + phaseStartOffset;
  const phaseProgressDenominator =
    totalPhases != null ? totalPhases + phaseStartOffset : null;

  if (!isPhaseInstallmentProfile(profile)) {
    return {
      ...baseRow,
      display_phase_progress: displayPhaseProgress,
      last_enrolled_phase_number: lastEnrolledPhaseNumber,
      phase_progress_complete: phaseProgressComplete,
      can_generate_installment: finalCanGenerate,
      plan_superseded: planSuperseded,
      phase_progress_numerator: phaseProgressNumerator,
      phase_progress_denominator: phaseProgressDenominator,
    };
  }

  try {
    const schedule = await buildPhaseInstallmentSchedule({
      db: { query },
      profile,
      generatedCountOverride: scheduleGeneratedCount,
      issueDateOverride: row.next_generation_date || null,
    });

    return {
      ...baseRow,
      display_phase_progress: displayPhaseProgress,
      last_enrolled_phase_number: lastEnrolledPhaseNumber,
      phase_progress_complete: phaseProgressComplete,
      can_generate_installment: finalCanGenerate,
      plan_superseded: planSuperseded,
      phase_progress_numerator: phaseProgressNumerator,
      phase_progress_denominator: phaseProgressDenominator,
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
      ...baseRow,
      display_phase_progress: displayPhaseProgress,
      last_enrolled_phase_number: lastEnrolledPhaseNumber,
      phase_progress_complete: phaseProgressComplete,
      can_generate_installment: finalCanGenerate,
      plan_superseded: planSuperseded,
      phase_progress_numerator: phaseProgressNumerator,
      phase_progress_denominator: phaseProgressDenominator,
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
 * GET /api/sms/installment-invoices/profiles/:id/phases
 *
 * Detailed view used by the "View and Edit" modal on the Installment
 * Invoice Logs page. Returns the profile, the downpayment summary,
 * one row per phase (1..total_phases) with its underlying invoice
 * (if generated yet), payment totals, and an aggregated total paid.
 *
 * Phase numbering rule: invoices linked to the profile (excluding the
 * downpayment) are grouped by chain root (so a re-billed/balance
 * invoice is counted once per chain), ordered by issue_date ASC, then
 * assigned phase numbers 1..N. Phases beyond N up to total_phases are
 * returned as "Not Generated" placeholders so the UI can show the
 * complete schedule at a glance.
 *
 * Access: any authenticated user with branch access (already enforced
 * by router.use(verifyFirebaseToken) + requireBranchAccess above).
 */
router.get(
  '/profiles/:id/phases',
  [
    param('id').isInt().withMessage('Profile ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const profileResult = await query(
        `SELECT ip.*,
                u.full_name AS student_name,
                u.email AS student_email,
                p.program_name,
                pkg.package_name AS package_description,
                pkg.package_type,
                b.branch_name,
                c.class_id AS class_id,
                c.class_name AS class_name,
                c.level_tag AS level_tag
         FROM installmentinvoiceprofilestbl ip
         LEFT JOIN userstbl u ON ip.student_id = u.user_id
         LEFT JOIN classestbl c ON ip.class_id = c.class_id
         LEFT JOIN programstbl p ON c.program_id = p.program_id
         LEFT JOIN packagestbl pkg ON ip.package_id = pkg.package_id
         LEFT JOIN branchestbl b ON ip.branch_id = b.branch_id
         WHERE ip.installmentinvoiceprofiles_id = $1`,
        [id]
      );

      if (profileResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Installment invoice profile not found',
        });
      }

      const profile = profileResult.rows[0];

      // Branch isolation for non-Superadmin: refuse if the profile belongs
      // to another branch.
      if (
        req.user?.userType !== 'Superadmin' &&
        req.user?.branchId &&
        profile.branch_id != null &&
        Number(profile.branch_id) !== Number(req.user.branchId)
      ) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this installment profile.',
        });
      }

      const downpaymentInvoiceId =
        profile.downpayment_invoice_id != null ? Number(profile.downpayment_invoice_id) : null;

      // Pull every invoice linked to this profile, plus its completed
      // payment total and the latest completed payment date. We
      // compute paid_amount and latest_payment_date per chain root
      // afterwards in JS so we can keep the SQL straightforward.
      const invoicesResult = await query(
        `SELECT i.invoice_id,
                i.invoice_description,
                i.invoice_ar_number,
                i.amount,
                i.status,
                TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue_date,
                TO_CHAR(i.due_date, 'YYYY-MM-DD')   AS due_date,
                COALESCE(i.invoice_chain_root_id, i.invoice_id) AS chain_root_id,
                i.invoice_chain_root_id,
                i.parent_invoice_id,
                i.balance_invoice_id,
                COALESCE((
                  SELECT SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.discount_amount, 0))
                  FROM paymenttbl p
                  WHERE p.invoice_id = i.invoice_id
                    AND p.status = 'Completed'
                    AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'
                ), 0)::numeric AS paid_total_for_invoice,
                (
                  SELECT TO_CHAR(MAX(p.issue_date), 'YYYY-MM-DD')
                  FROM paymenttbl p
                  WHERE p.invoice_id = i.invoice_id
                    AND p.status = 'Completed'
                    AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'
                ) AS latest_payment_date_for_invoice
         FROM invoicestbl i
         WHERE i.installmentinvoiceprofiles_id = $1
         ORDER BY i.issue_date ASC NULLS LAST, i.invoice_id ASC`,
        [id]
      );

      const allInvoices = invoicesResult.rows;

      // Group by chain root: each chain represents ONE phase (or the
      // downpayment). For each chain, prefer the most recently issued
      // invoice as the representative (balance/re-billed invoice
      // supersedes the original) but sum payments across the chain.
      const chains = new Map();
      for (const inv of allInvoices) {
        const chainRoot = Number(inv.chain_root_id);
        if (!chains.has(chainRoot)) {
          chains.set(chainRoot, {
            chain_root_id: chainRoot,
            representative: inv,
            paid_amount: 0,
            latest_payment_date: null,
            invoices: [],
          });
        }
        const chain = chains.get(chainRoot);
        chain.invoices.push(inv);
        chain.paid_amount += Number(inv.paid_total_for_invoice || 0);
        const invLatestPay = inv.latest_payment_date_for_invoice || null;
        if (invLatestPay && (!chain.latest_payment_date || invLatestPay > chain.latest_payment_date)) {
          chain.latest_payment_date = invLatestPay;
        }
        // Pick the latest invoice in the chain as representative for
        // status/dates/amount (e.g. balance invoice vs. original).
        const currentRep = chain.representative;
        if (
          (inv.issue_date || '') > (currentRep.issue_date || '') ||
          ((inv.issue_date || '') === (currentRep.issue_date || '') &&
            Number(inv.invoice_id) > Number(currentRep.invoice_id))
        ) {
          chain.representative = inv;
        }
      }

      // Split the downpayment chain off from the phase chains.
      let downpaymentChain = null;
      const phaseChains = [];
      for (const chain of chains.values()) {
        if (downpaymentInvoiceId && chain.chain_root_id === downpaymentInvoiceId) {
          downpaymentChain = chain;
        } else {
          phaseChains.push(chain);
        }
      }
      // Sort phase chains by the chain root invoice_id (creation order).
      // We deliberately avoid sorting by issue_date because advance-paid
      // invoices are created today (earlier date) while auto-generated
      // invoices carry future scheduled dates, which would swap phases.
      // The invoice_id sequence always matches the generation order.
      phaseChains.sort((a, b) => Number(a.chain_root_id) - Number(b.chain_root_id));

      const todayYmd = (() => {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      })();

      const computeStatus = (invoiceStatus, dueDate) => {
        const raw = String(invoiceStatus || '').trim();
        if (raw.toLowerCase() === 'paid') return 'Paid';
        if (raw.toLowerCase() === 'cancelled' || raw.toLowerCase() === 'canceled') return 'Cancelled';
        if (dueDate && dueDate < todayYmd) return 'Overdue';
        return raw || 'Pending';
      };

      const buildPhaseRow = (phaseNumber, chain) => {
        if (!chain) {
          return {
            phase_number: phaseNumber,
            invoice_id: null,
            invoice_ar_number: null,
            invoice_description: null,
            issue_date: null,
            due_date: null,
            payment_date: null,
            amount: profile.amount != null ? Number(profile.amount) : null,
            paid_amount: 0,
            status: 'Not Generated',
            is_generated: false,
          };
        }
        const rep = chain.representative;
        const amount = rep.amount != null ? Number(rep.amount) : null;
        return {
          phase_number: phaseNumber,
          invoice_id: Number(rep.invoice_id),
          invoice_ar_number: rep.invoice_ar_number || null,
          invoice_description: rep.invoice_description || null,
          issue_date: rep.issue_date || null,
          due_date: rep.due_date || null,
          payment_date: chain.latest_payment_date || null,
          amount,
          paid_amount: Number(chain.paid_amount || 0),
          status: computeStatus(rep.status, rep.due_date),
          is_generated: true,
        };
      };

      const totalPhases =
        profile.total_phases != null ? Math.max(0, Number(profile.total_phases)) : phaseChains.length;
      const phases = [];
      for (let i = 0; i < Math.max(totalPhases, phaseChains.length); i += 1) {
        phases.push(buildPhaseRow(i + 1, phaseChains[i] || null));
      }

      const downpaymentRep = downpaymentChain?.representative || null;
      const downpayment = downpaymentRep
        ? {
            invoice_id: Number(downpaymentRep.invoice_id),
            invoice_ar_number: downpaymentRep.invoice_ar_number || null,
            invoice_description: downpaymentRep.invoice_description || null,
            issue_date: downpaymentRep.issue_date || null,
            due_date: downpaymentRep.due_date || null,
            payment_date: downpaymentChain.latest_payment_date || null,
            amount:
              downpaymentRep.amount != null ? Number(downpaymentRep.amount) : null,
            paid_amount: Number(downpaymentChain.paid_amount || 0),
            status: computeStatus(downpaymentRep.status, downpaymentRep.due_date),
            is_generated: true,
          }
        : null;

      const totalPaidPhases = phases.reduce((sum, p) => sum + Number(p.paid_amount || 0), 0);
      const totalPaidDownpayment = downpayment ? Number(downpayment.paid_amount || 0) : 0;
      const totalPaid = totalPaidPhases + totalPaidDownpayment;

      // Total Billed = lifetime expected amount across the whole plan.
      // For generated phases use the actual invoice amount; for phases
      // not yet generated fall back to the profile's per-phase amount.
      // Include the downpayment when present.
      const profilePhaseAmount =
        profile.amount != null ? Number(profile.amount) : 0;
      const totalBilledPhases = phases.reduce((sum, p) => {
        if (p.is_generated && p.amount != null) return sum + Number(p.amount);
        if (!p.is_generated) return sum + profilePhaseAmount;
        return sum;
      }, 0);
      const totalBilled =
        totalBilledPhases + (downpayment?.amount != null ? Number(downpayment.amount) : 0);

      // Outstanding per generated phase: amount minus paid (floored at
      // 0). Per ungenerated phase: full profile per-phase amount.
      // Plus any unpaid portion of the downpayment.
      const outstandingGenerated = phases.reduce((sum, p) => {
        if (!p.is_generated || p.amount == null) return sum;
        return sum + Math.max(0, Number(p.amount) - Number(p.paid_amount || 0));
      }, 0);
      const outstandingNotGenerated = phases.reduce(
        (sum, p) => sum + (p.is_generated ? 0 : profilePhaseAmount),
        0
      );
      const outstandingDownpayment =
        downpayment && downpayment.amount != null
          ? Math.max(0, Number(downpayment.amount) - Number(downpayment.paid_amount || 0))
          : 0;
      const totalOutstanding =
        outstandingGenerated + outstandingNotGenerated + outstandingDownpayment;

      res.json({
        success: true,
        data: {
          profile: {
            installmentinvoiceprofiles_id: Number(profile.installmentinvoiceprofiles_id),
            student_id: profile.student_id != null ? Number(profile.student_id) : null,
            student_name: profile.student_name || null,
            student_email: profile.student_email || null,
            program_name: profile.program_name || null,
            package_id: profile.package_id != null ? Number(profile.package_id) : null,
            package_description: profile.package_description || null,
            package_type: profile.package_type || null,
            branch_id: profile.branch_id != null ? Number(profile.branch_id) : null,
            branch_name: profile.branch_name || null,
            class_id: profile.class_id != null ? Number(profile.class_id) : null,
            class_name: profile.class_name || null,
            level_tag: profile.level_tag || null,
            amount: profile.amount != null ? Number(profile.amount) : null,
            frequency: profile.frequency || null,
            total_phases: profile.total_phases != null ? Number(profile.total_phases) : null,
            generated_count:
              profile.generated_count != null ? Number(profile.generated_count) : 0,
            phase_start: profile.phase_start != null ? Number(profile.phase_start) : null,
            is_active: profile.is_active === true,
            downpayment_invoice_id: downpaymentInvoiceId,
            downpayment_paid: profile.downpayment_paid === true,
          },
          downpayment,
          phases,
          totals: {
            total_paid: totalPaid,
            total_paid_phases: totalPaidPhases,
            total_paid_downpayment: totalPaidDownpayment,
            total_billed: totalBilled,
            total_outstanding: totalOutstanding,
          },
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
        SELECT ip.*, u.full_name as student_name, p.program_name, c.class_name
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
        // Anchor the first phase to TODAY so it issues for the current
        // invoice cycle (visible on the current month's invoice page).
        // See payments.js → createFirstInstallmentRecordAfterDownpayment
        // for the full design rationale on mid-year enrollments.
        const todayYmd = formatYmdLocal(new Date());
        const insertResult = await client.query(
          `INSERT INTO installmentinvoicestbl
           (installmentinvoiceprofiles_id, scheduled_date, status, student_name,
            total_amount_including_tax, total_amount_excluding_tax, frequency,
            next_generation_date, next_invoice_month)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            id,
            profile.bill_invoice_due_date || todayYmd,
            'Pending',
            profile.student_name || 'Student',
            profile.amount,
            profile.amount,
            profile.frequency || '1 month(s)',
            todayYmd,
            todayYmd,
          ]
        );
        firstRecord = insertResult.rows[0];
      } else {
        // firstRecord already exists from a previous (failed) attempt or a
        // prior reservation upgrade. If it was anchored to a future date
        // (typical for mid-year enrollments), realign it to TODAY so the
        // about-to-be-generated invoice lands in the current cycle.
        const todayYmd = formatYmdLocal(new Date());
        const existingNextGen = firstRecord.next_generation_date
          ? formatYmdLocal(new Date(firstRecord.next_generation_date))
          : null;
        if (!existingNextGen || existingNextGen > todayYmd) {
          await client.query(
            `UPDATE installmentinvoicestbl
             SET next_generation_date = $1, next_invoice_month = $2
             WHERE installmentinvoicedtl_id = $3`,
            [todayYmd, todayYmd, firstRecord.installmentinvoicedtl_id]
          );
          firstRecord.next_generation_date = todayYmd;
          firstRecord.next_invoice_month = todayYmd;
        }
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
 * List installment schedule rows (one per profile after deduplication), with optional filters:
 *   profile_id, student_id, status, pagination.
 * Access: All authenticated users
 */
router.get(
  '/invoices',
  [
    queryValidator('profile_id').optional().isInt().withMessage('Profile ID must be an integer'),
    queryValidator('student_id').optional().isInt().withMessage('Student ID must be an integer'),
    queryValidator('status').optional().isString().withMessage('Status must be a string'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 500 }).withMessage('Limit must be between 1 and 500'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { profile_id, status, student_id } = req.query;
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

      if (student_id) {
        fp++;
        filterFragments.push(`ip.student_id = $${fp}`);
        filterParams.push(parseInt(student_id, 10));
      }

      if (status) {
        fp++;
        filterFragments.push(`ii.status = $${fp}`);
        filterParams.push(status);
      }

      const filterSql = filterFragments.length ? ` AND ${filterFragments.join(' AND ')}` : '';

      // (1) One schedule row per profile. (2) One list row per installment profile (student + class + plan).
      // Deduplicate only within the same profile id — never merge different classes or profiles.
      // Start from profiles so students with installment plans still appear even if no schedule row exists yet.
      const countSql = `
        WITH sched_ranked AS (
          SELECT
               ip.student_id,
               ip.branch_id,
               ip.class_id,
               ip.installmentinvoiceprofiles_id,
               ii.installmentinvoicedtl_id,
               p.program_name,
               CASE
                 WHEN ip.is_active = true THEN true
                 WHEN ip.is_active = false AND ip.class_id IS NOT NULL AND EXISTS (
                   SELECT 1
                   FROM classstudentstbl cs
                   WHERE cs.student_id = ip.student_id
                     AND cs.class_id = ip.class_id
                     AND cs.removed_at IS NULL
                     AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
                 ) THEN true
                 ELSE ip.is_active
               END as profile_is_active,
               (SELECT COUNT(DISTINCT COALESCE(i.invoice_chain_root_id, i.invoice_id))
                FROM invoicestbl i
                WHERE i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
                  AND i.status = 'Paid'
                  AND (
                    ip.downpayment_invoice_id IS NULL OR
                    COALESCE(i.invoice_chain_root_id, i.invoice_id) != ip.downpayment_invoice_id::INTEGER
                  )
               )::integer as paid_phases,
               (SELECT COUNT(DISTINCT COALESCE(i.invoice_chain_root_id, i.invoice_id))
                FROM invoicestbl i
                WHERE i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
                  AND (
                    ip.downpayment_invoice_id IS NULL OR
                    COALESCE(i.invoice_chain_root_id, i.invoice_id) != ip.downpayment_invoice_id::INTEGER
                  )
               )::integer as generated_phases,
               COALESCE(ip.generated_count, 0)::integer as gen_ct,
               ROW_NUMBER() OVER (
                 PARTITION BY ip.installmentinvoiceprofiles_id
                 ORDER BY
                   CASE WHEN UPPER(COALESCE(ii.status, '')) = 'PENDING' THEN 0 ELSE 1 END,
                   ii.scheduled_date DESC NULLS LAST,
                   ii.installmentinvoicedtl_id DESC
               ) AS _rn_sched
          FROM installmentinvoiceprofilestbl ip
          LEFT JOIN installmentinvoicestbl ii ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
          LEFT JOIN classestbl c ON ip.class_id = c.class_id
          LEFT JOIN programstbl p ON c.program_id = p.program_id
          WHERE 1=1${filterSql}
        ),
        one_sched AS (
          SELECT * FROM sched_ranked WHERE _rn_sched = 1
        ),
        dup_ranked AS (
          SELECT *,
            ROW_NUMBER() OVER (
              PARTITION BY installmentinvoiceprofiles_id
              ORDER BY
                (CASE WHEN profile_is_active THEN 1 ELSE 0 END) DESC,
                (CASE WHEN installmentinvoicedtl_id IS NOT NULL THEN 1 ELSE 0 END) DESC,
                COALESCE(paid_phases, 0) DESC,
                COALESCE(generated_phases, 0) DESC,
                COALESCE(gen_ct, 0) DESC,
                installmentinvoiceprofiles_id DESC
            ) AS _rn_dup
          FROM one_sched
        )
        SELECT COUNT(*)::bigint AS total FROM dup_ranked WHERE _rn_dup = 1
      `;
      const countResult = await query(countSql, filterParams);
      const total = parseInt(countResult.rows[0]?.total || 0, 10);

      let sql = `
        WITH sched_ranked AS (
          SELECT
               ii.*, ip.student_id, ip.branch_id, ip.package_id, ip.amount as profile_amount,
               ip.frequency as profile_frequency, ip.description, ip.class_id, ip.total_phases, ip.generated_count, ip.phase_start,
               CASE
                 WHEN ip.is_active = true THEN true
                 WHEN ip.is_active = false AND ip.class_id IS NOT NULL AND EXISTS (
                   SELECT 1
                   FROM classstudentstbl cs
                   WHERE cs.student_id = ip.student_id
                     AND cs.class_id = ip.class_id
                     AND cs.removed_at IS NULL
                     AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
                 ) THEN true
                 ELSE ip.is_active
               END as profile_is_active,
               ip.downpayment_invoice_id,
               c.start_date::text as class_start_date,
               c.class_name as class_name,
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
               (SELECT MAX(ip2.installmentinvoiceprofiles_id)
                FROM installmentinvoiceprofilestbl ip2
                WHERE ip2.student_id = ip.student_id
                  AND ip2.class_id IS NOT DISTINCT FROM ip.class_id
                  AND ip2.class_id IS NOT NULL
               ) as canonical_installment_profile_id_for_class,
               p.program_name,
               u.full_name as student_name_from_user,
               ROW_NUMBER() OVER (
                 PARTITION BY ip.installmentinvoiceprofiles_id
                 ORDER BY
                   CASE WHEN UPPER(COALESCE(ii.status, '')) = 'PENDING' THEN 0 ELSE 1 END,
                   ii.scheduled_date DESC NULLS LAST,
                   ii.installmentinvoicedtl_id DESC
               ) AS _rn_sched
          FROM installmentinvoiceprofilestbl ip
          LEFT JOIN installmentinvoicestbl ii ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
          LEFT JOIN classestbl c ON ip.class_id = c.class_id
          LEFT JOIN programstbl p ON c.program_id = p.program_id
          LEFT JOIN userstbl u ON ip.student_id = u.user_id
          WHERE 1=1${filterSql}
        ),
        one_sched AS (
          SELECT * FROM sched_ranked WHERE _rn_sched = 1
        ),
        dup_ranked AS (
          SELECT *,
            ROW_NUMBER() OVER (
              PARTITION BY installmentinvoiceprofiles_id
              ORDER BY
                (CASE WHEN profile_is_active THEN 1 ELSE 0 END) DESC,
                (CASE WHEN installmentinvoicedtl_id IS NOT NULL THEN 1 ELSE 0 END) DESC,
                COALESCE(paid_phases::integer, 0) DESC,
                COALESCE(generated_phases::integer, 0) DESC,
                COALESCE(generated_count, 0) DESC,
                installmentinvoiceprofiles_id DESC
            ) AS _rn_dup
          FROM one_sched
        )
        SELECT * FROM dup_ranked WHERE _rn_dup = 1
      `;

      const listParams = [...filterParams];
      fp = filterParams.length;
      sql += ` ORDER BY scheduled_date DESC NULLS LAST, installmentinvoiceprofiles_id DESC LIMIT $${fp + 1} OFFSET $${fp + 2}`;
      listParams.push(limitNum, offset);

      const result = await query(sql, listParams);
      const enrichedRows = await Promise.all(
        result.rows.map((row) => {
          const { _rn_sched, _rn_dup, student_name_from_user, ...rest } = row;
          const displayName =
            (typeof student_name_from_user === 'string' && student_name_from_user.trim() !== ''
              ? student_name_from_user.trim()
              : null) || rest.student_name;
          return enrichInstallmentInvoiceRow({ ...rest, student_name: displayName });
        })
      );

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
                CASE
                  WHEN ip.is_active = true THEN true
                  WHEN ip.is_active = false AND ip.class_id IS NOT NULL AND EXISTS (
                    SELECT 1
                    FROM classstudentstbl cs
                    WHERE cs.student_id = ip.student_id
                      AND cs.class_id = ip.class_id
                      AND cs.removed_at IS NULL
                      AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
                  ) THEN true
                  ELSE ip.is_active
                END as profile_is_active,
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
                p.program_name,
                u.full_name as student_name_from_user
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

      const raw = result.rows[0];
      const displayName =
        (typeof raw.student_name_from_user === 'string' && raw.student_name_from_user.trim() !== ''
          ? raw.student_name_from_user.trim()
          : null) || raw.student_name;
      const { student_name_from_user: _snfu, ...forEnrich } = raw;
      const enrichedRow = await enrichInstallmentInvoiceRow({ ...forEnrich, student_name: displayName });

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
        // Backward compatibility: some profiles were incorrectly marked inactive when the last phase invoice was generated.
        // Treat as active if the student is still enrolled in the linked class.
        let isStillEnrolled = false;
        if (installmentInvoice.class_id) {
          const enrolledCheck = await client.query(
            `SELECT 1
             FROM classstudentstbl cs
             WHERE cs.student_id = $1
               AND cs.class_id = $2
               AND cs.removed_at IS NULL
               AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
             LIMIT 1`,
            [installmentInvoice.student_id, installmentInvoice.class_id]
          );
          isStillEnrolled = enrolledCheck.rows.length > 0;
        }

        if (!isStillEnrolled) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message:
              'This student has already been unenrolled. Existing installment invoices and payment logs are preserved, but new installment invoices can no longer be generated.',
          });
        }
      }

      const totalPhasesEarly =
        installmentInvoice.total_phases != null ? parseInt(installmentInvoice.total_phases, 10) : null;
      const downpaymentIdEarly = installmentInvoice.downpayment_invoice_id || null;
      const paidEarlyResult = await client.query(
        `SELECT COUNT(DISTINCT COALESCE(i.invoice_chain_root_id, i.invoice_id)) AS paid_phase_count
         FROM invoicestbl i
         WHERE i.installmentinvoiceprofiles_id = $1
           AND i.status = 'Paid'
           AND (
             $2::INTEGER IS NULL OR
             COALESCE(i.invoice_chain_root_id, i.invoice_id) != $2::INTEGER
           )`,
        [installmentInvoice.installmentinvoiceprofiles_id, downpaymentIdEarly]
      );
      const genEarlyResult = await client.query(
        `SELECT COUNT(DISTINCT COALESCE(i.invoice_chain_root_id, i.invoice_id)) AS generated_phase_count
         FROM invoicestbl i
         WHERE i.installmentinvoiceprofiles_id = $1
           AND (
             $2::INTEGER IS NULL OR
             COALESCE(i.invoice_chain_root_id, i.invoice_id) != $2::INTEGER
           )`,
        [installmentInvoice.installmentinvoiceprofiles_id, downpaymentIdEarly]
      );
      const paidPhasesEarly = parseInt(paidEarlyResult.rows[0]?.paid_phase_count || 0, 10);
      const generatedPhasesEarly = parseInt(genEarlyResult.rows[0]?.generated_phase_count || 0, 10);
      const billingProgressEarly = Math.max(paidPhasesEarly, generatedPhasesEarly, 0);
      const displayProgressEarly =
        totalPhasesEarly != null && totalPhasesEarly > 0
          ? Math.min(billingProgressEarly, totalPhasesEarly)
          : billingProgressEarly;
      if (totalPhasesEarly !== null && totalPhasesEarly > 0 && displayProgressEarly >= totalPhasesEarly) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Installment phase progress is already complete (${displayProgressEarly}/${totalPhasesEarly}). No further invoices can be generated for this plan.`,
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

      // Nominal billing issue is often the 25th of a *future* cycle (next_generation_date).
      // The main Invoice list defaults to the current calendar month by issue_date, so a
      // future issue_date makes a just-generated invoice look "missing". Align issue_date
      // to today when it would otherwise be in the future; keep due_date on the real schedule.
      const issueYmd = String(effectiveIssueDate || '').trim().slice(0, 10);
      const todayYmd = formatYmdLocal(new Date());
      const dueYmd = String(effectiveDueDate || '').trim().slice(0, 10);
      let displayIssueYmd = issueYmd;
      if (/^\d{4}-\d{2}-\d{2}$/.test(displayIssueYmd) && /^\d{4}-\d{2}-\d{2}$/.test(todayYmd) && displayIssueYmd > todayYmd) {
        displayIssueYmd = todayYmd;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(dueYmd) && /^\d{4}-\d{2}-\d{2}$/.test(displayIssueYmd) && displayIssueYmd > dueYmd) {
        displayIssueYmd = dueYmd;
      }
      if (
        displayIssueYmd &&
        /^\d{4}-\d{2}-\d{2}$/.test(displayIssueYmd) &&
        displayIssueYmd !== issueYmd
      ) {
        await client.query(`UPDATE invoicestbl SET issue_date = $1::date WHERE invoice_id = $2`, [
          displayIssueYmd,
          newInvoice.invoice_id,
        ]);
      }

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
      await syncProgramPaymentStatusForInvoice(client, newInvoice.invoice_id);

      const totalPhases = installmentInvoice.total_phases;
      const maxInvoices = totalPhases !== null ? totalPhases : null; // Max invoices = total_phases (downpayment doesn't count)

      const currentCount = installmentInvoice.generated_count || 0;

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
        // Last invoice for this schedule row - update installment invoice status.
        // Do NOT mark the profile inactive here; inactivity should represent unenrollment, not "final invoice generated".
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

/**
 * POST /api/sms/installment-invoices/profiles/:id/advance-pay
 *
 * Record an advance payment for a "Not Generated" phase so the student can
 * pay ahead of schedule. The endpoint:
 *   1. Creates an invoice in invoicestbl (status = 'Paid').
 *   2. Creates a Completed payment in paymenttbl.
 *   3. Increments generated_count on the profile.
 *   4. Advances next_generation_date on installmentinvoicestbl by the
 *      number of months being skipped (so the auto-generator skips the
 *      already-paid phase and moves to the next one).
 *   5. Enrolls the student in classstudentstbl for the absolute phase
 *      (if class_id is present and the row doesn't yet exist).
 *
 * Access: Superadmin, Admin, Finance, Superfinance
 */
router.post(
  '/profiles/:id/advance-pay',
  [
    param('id').isInt().withMessage('Profile ID must be an integer'),
    body('phase_index')
      .isInt({ min: 1 })
      .withMessage('phase_index must be a positive integer (1-based profile-local phase)'),
    body('payment_method').notEmpty().isString().withMessage('payment_method is required'),
    body('reference_number').optional({ nullable: true }).isString(),
    body('payment_date').optional({ nullable: true }).isISO8601().withMessage('payment_date must be a valid date'),
    body('remarks').optional({ nullable: true }).isString(),
    body('attachment_url').optional({ nullable: true }).isString(),
    body('tip_amount').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('tip_amount must be a non-negative number'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance', 'Superfinance'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const { phase_index, payment_method, reference_number, payment_date, remarks, attachment_url, tip_amount } = req.body;

      // Fetch profile + the linked installment schedule row (for next_generation_date).
      const profileRes = await client.query(
        `SELECT ip.*,
                ii.installmentinvoicedtl_id,
                ii.next_generation_date      AS sched_next_gen_date,
                ii.next_invoice_month        AS sched_next_inv_month,
                ii.frequency                 AS ii_frequency,
                ii.total_amount_including_tax,
                ii.total_amount_excluding_tax
         FROM installmentinvoiceprofilestbl ip
         LEFT JOIN installmentinvoicestbl ii
           ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
         WHERE ip.installmentinvoiceprofiles_id = $1
         ORDER BY ii.installmentinvoicedtl_id DESC
         LIMIT 1`,
        [id]
      );

      if (profileRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Installment profile not found' });
      }

      const profile = profileRes.rows[0];

      // Branch isolation.
      if (
        req.user?.userType !== 'Superadmin' &&
        req.user?.branchId &&
        profile.branch_id != null &&
        Number(profile.branch_id) !== Number(req.user.branchId)
      ) {
        await client.query('ROLLBACK');
        return res.status(403).json({ success: false, message: 'Access denied for this branch' });
      }

      const generatedCount = parseInt(profile.generated_count || 0, 10);
      const totalPhases = profile.total_phases != null ? parseInt(profile.total_phases, 10) : null;
      const phaseIdx = parseInt(phase_index, 10);

      if (phaseIdx <= generatedCount) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Phase ${phaseIdx} has already been generated. Only unpaid future phases can be advance-paid.`,
        });
      }

      if (totalPhases !== null && phaseIdx > totalPhases) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Phase ${phaseIdx} exceeds the total phase count (${totalPhases}).`,
        });
      }

      // ---- Compute dates for this phase --------------------------------
      const frequency = profile.ii_frequency || profile.frequency || '1 month(s)';
      const freqMonths = parseFrequency(frequency);

      // The schedule row's next_generation_date is the anchor for phase
      // (generated_count + 1). For later phases we add extra months.
      const nextGenRaw = profile.sched_next_gen_date || new Date();
      const nextGenBase =
        typeof nextGenRaw === 'string'
          ? (() => {
              const [y, m, d] = nextGenRaw.slice(0, 10).split('-').map(Number);
              return new Date(y, m - 1, d, 12, 0, 0, 0);
            })()
          : new Date(nextGenRaw);

      // extraMonths = how many frequency cycles ahead of the "next" phase
      const extraMonths = (phaseIdx - (generatedCount + 1)) * freqMonths;
      const phaseAnchor = new Date(nextGenBase);
      phaseAnchor.setMonth(phaseAnchor.getMonth() + extraMonths);
      phaseAnchor.setDate(25); // fixed generation day

      // Build the invoice due date from the anchor (5th of the following month).
      const dueDate = new Date(phaseAnchor);
      dueDate.setMonth(dueDate.getMonth() + 1);
      dueDate.setDate(5);

      const issueDateYmd = payment_date
        ? String(payment_date).slice(0, 10)
        : formatYmdLocal(new Date()); // today server time
      const dueDateYmd = formatYmdLocal(dueDate);

      const invoiceAmount = Number(profile.amount || 0);
      const phaseStart = parseInt(profile.phase_start || 1, 10);
      const absolutePhaseNumber = phaseStart + (phaseIdx - 1);
      const creatorUserId = req.user.userId || req.user.user_id || null;

      // ---- Create invoice ----------------------------------------------
      // NOTE: invoice_ar_number is appended by insertInvoiceWithArNumber as
      // the last bind parameter — it must be the trailing column / placeholder.
      const newInvoice = await insertInvoiceWithArNumber(
        client,
        `INSERT INTO invoicestbl
           (invoice_description, branch_id, amount, status, remarks, issue_date, due_date,
            created_by, installmentinvoiceprofiles_id, invoice_ar_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          'TEMP',
          profile.branch_id || null,
          invoiceAmount,
          'Paid',
          `Advance payment — Phase ${absolutePhaseNumber} (profile #${id})`,
          issueDateYmd,
          dueDateYmd,
          creatorUserId,
          parseInt(id, 10),
        ]
      );

      await client.query(
        'UPDATE invoicestbl SET invoice_description = $1 WHERE invoice_id = $2',
        [`INV-${newInvoice.invoice_id}`, newInvoice.invoice_id]
      );

      // Invoice item.
      await client.query(
        `INSERT INTO invoiceitemstbl (invoice_id, description, amount)
         VALUES ($1, $2, $3)`,
        [
          newInvoice.invoice_id,
          `Installment Phase ${absolutePhaseNumber} — advance payment`,
          invoiceAmount,
        ]
      );

      // Link student to invoice.
      await client.query(
        'INSERT INTO invoicestudentstbl (invoice_id, student_id) VALUES ($1, $2)',
        [newInvoice.invoice_id, profile.student_id]
      );

      // ---- Create payment record ---------------------------------------
      // Advance payments are NEVER auto-approved (regardless of method,
      // including Cash). Finance/Superfinance must verify them via the
      // standard payment approval flow so they don't bypass review.
      const tipValue = tip_amount != null ? parseFloat(tip_amount) : 0;
      await client.query(
        `INSERT INTO paymenttbl
           (invoice_id, student_id, branch_id, payment_method, payment_type,
            payable_amount, tip_amount, issue_date, status, approval_status,
            reference_number, remarks, payment_attachment_url, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          newInvoice.invoice_id,
          profile.student_id,
          profile.branch_id || null,
          payment_method,
          'Full',
          invoiceAmount,
          tipValue || 0,
          issueDateYmd,
          'Completed',
          'Pending',
          reference_number || null,
          remarks || null,
          attachment_url || null,
          creatorUserId,
        ]
      );
      await syncProgramPaymentStatusForInvoice(client, newInvoice.invoice_id);

      // ---- Advance the auto-generation schedule ------------------------
      // Push next_generation_date forward by (phasesToAdvance × freqMonths)
      // so the auto-generator skips the advance-paid phase(s) and targets
      // the next unpaid one.
      //
      // next_invoice_month is derived from next_generation_date using the
      // same rule as buildFixedInstallmentCycleDates:
      //   generation anchor → 25th of month M
      //   invoice month     → 1st of month M+1
      //
      // We intentionally do NOT parse sched_next_inv_month from the DB
      // because the pg driver returns date columns as JS Date objects;
      // treating them as strings would produce an Invalid Date and write
      // NULL back to the DB (the original bug that caused "Next Month: -").
      const phasesToAdvance = phaseIdx - generatedCount; // e.g. paying phase 2 when gen=1 → 1
      if (profile.installmentinvoicedtl_id) {
        // New generation anchor: current anchor + phasesToAdvance months, pinned to 25th.
        const newNextGen = new Date(nextGenBase);
        newNextGen.setMonth(newNextGen.getMonth() + phasesToAdvance * freqMonths);
        newNextGen.setDate(25);

        // Invoice month = 1st of the month following the generation anchor.
        const newNextInvMonth = new Date(newNextGen);
        newNextInvMonth.setDate(1);
        newNextInvMonth.setMonth(newNextInvMonth.getMonth() + 1);

        await client.query(
          `UPDATE installmentinvoicestbl
           SET next_generation_date = $1, next_invoice_month = $2
           WHERE installmentinvoicedtl_id = $3`,
          [formatYmdLocal(newNextGen), formatYmdLocal(newNextInvMonth), profile.installmentinvoicedtl_id]
        );
      }

      // ---- Increment generated_count on the profile --------------------
      const newGeneratedCount = generatedCount + 1;
      const isLastPhase = totalPhases !== null && newGeneratedCount >= totalPhases;

      await client.query(
        `UPDATE installmentinvoiceprofilestbl
         SET generated_count = $1 ${isLastPhase ? ', is_active = false' : ''}
         WHERE installmentinvoiceprofiles_id = $2`,
        [newGeneratedCount, id]
      );

      // ---- Enroll student in class for this phase ---------------------
      if (profile.class_id && profile.student_id) {
        const existsRes = await client.query(
          `SELECT 1 FROM classstudentstbl
           WHERE student_id = $1 AND class_id = $2 AND phase_number = $3`,
          [profile.student_id, profile.class_id, absolutePhaseNumber]
        );
        if (existsRes.rows.length === 0) {
          const phaseEnrollmentStatus = await determineRejoinAwarePhaseStatus({
            db: client,
            studentId: profile.student_id,
            classId: profile.class_id,
            phaseNumber: absolutePhaseNumber,
            defaultStatus: 're_enrolled',
          });
          await client.query(
            `INSERT INTO classstudentstbl (student_id, class_id, phase_number, enrolled_at, program_enrollment_status, enrolled_by)
             VALUES ($1, $2, $3, NOW(), $4, $5)`,
            [
              profile.student_id,
              profile.class_id,
              absolutePhaseNumber,
              phaseEnrollmentStatus,
              String(creatorUserId || 'system'),
            ]
          );
        }
      }

      await client.query('COMMIT');

      return res.json({
        success: true,
        message: `Advance payment recorded for Phase ${absolutePhaseNumber}.`,
        data: {
          invoice_id: newInvoice.invoice_id,
          invoice_ar_number: newInvoice.invoice_ar_number || null,
          phase_index: phaseIdx,
          absolute_phase_number: absolutePhaseNumber,
          amount: invoiceAmount,
          issue_date: issueDateYmd,
          due_date: dueDateYmd,
          new_generated_count: newGeneratedCount,
          is_last_phase: isLastPhase,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      return next(err);
    } finally {
      client.release();
    }
  }
);

/**
 * POST /api/sms/installment-invoices/program-payment-status/sync-all
 *
 * One-time or periodic backfill: rebuilds program_payment_statustbl from
 * invoicestbl + invoicestudentstbl + payments (via sync helper).
 * Non-Superadmin users are limited to their branch_id.
 *
 * Access: Superadmin, Admin, Finance, Superfinance
 */
router.post(
  '/program-payment-status/sync-all',
  requireRole('Superadmin', 'Admin', 'Finance', 'Superfinance'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      const userType = req.user?.userType;
      const branchId =
        userType === 'Superadmin'
          ? null
          : req.user?.branchId != null
            ? Number(req.user.branchId)
            : null;
      const result = await syncAllProgramPaymentStatuses(client, { branchId });
      res.json({
        success: true,
        message: `Synced ${result.synced} program payment status row(s) from ${result.invoices} invoice(s).`,
        data: result,
      });
    } catch (err) {
      next(err);
    } finally {
      client.release();
    }
  }
);

/**
 * POST /api/sms/installment-invoices/mark-completed
 *
 * Cron / scheduled job endpoint: scans classstudentstbl and sets
 * program_enrollment_status = 'completed'.
 *
 * Rules:
 *   A) Installment students — when paid phase progress reaches
 *      total_phases (paid >= total), mark ALL rows for that
 *      student+class as completed.
 *   B) Full-payment students (no linked installment profile) — when
 *      class end_date < today, mark their rows as completed.
 *
 * Access: Superadmin only (or internal cron key)
 */
router.post(
  '/mark-completed',
  requireRole('Superadmin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // ── A) Installment students: paid phase progress reached total phases ──
      // Only the LAST phase row should be "completed"; earlier phases stay "re_enrolled".
      const installmentKeepFirstPhaseNewResult = await client.query(`
        WITH profile_progress AS (
          SELECT
            ip.student_id,
            ip.class_id,
            COALESCE(ip.phase_start, 1)::integer AS phase_start,
            COALESCE(ip.total_phases, 0)::integer AS total_phases,
            COUNT(DISTINCT CASE
              WHEN i.status = 'Paid' THEN COALESCE(i.invoice_chain_root_id, i.invoice_id)
              ELSE NULL
            END)::integer AS paid_phases
          FROM installmentinvoiceprofilestbl ip
          LEFT JOIN invoicestbl i
            ON i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
           AND (
             ip.downpayment_invoice_id IS NULL
             OR COALESCE(i.invoice_chain_root_id, i.invoice_id) <> ip.downpayment_invoice_id::INTEGER
           )
          WHERE ip.student_id IS NOT NULL
            AND ip.class_id IS NOT NULL
          GROUP BY ip.student_id, ip.class_id, ip.phase_start, ip.total_phases
        ),
        completed_profiles AS (
          SELECT
            student_id,
            class_id,
            phase_start,
            (phase_start + total_phases - 1) AS final_phase
          FROM profile_progress
          WHERE total_phases > 0
            AND paid_phases >= total_phases
        )
        UPDATE classstudentstbl cs
        SET program_enrollment_status = CASE
              WHEN cs.program_enrollment_status = 'rejoin' THEN 'rejoin'
              ELSE 'new'
            END
        FROM completed_profiles cp
        WHERE cs.student_id = cp.student_id
          AND cs.class_id = cp.class_id
          AND cs.phase_number = cp.phase_start
          AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'completed')
          AND cs.removed_at IS NULL
        RETURNING cs.classstudent_id
      `);
      const installmentReEnrolledResult = await client.query(`
        WITH profile_progress AS (
          SELECT
            ip.student_id,
            ip.class_id,
            COALESCE(ip.phase_start, 1)::integer AS phase_start,
            COALESCE(ip.total_phases, 0)::integer AS total_phases,
            COUNT(DISTINCT CASE
              WHEN i.status = 'Paid' THEN COALESCE(i.invoice_chain_root_id, i.invoice_id)
              ELSE NULL
            END)::integer AS paid_phases
          FROM installmentinvoiceprofilestbl ip
          LEFT JOIN invoicestbl i
            ON i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
           AND (
             ip.downpayment_invoice_id IS NULL
             OR COALESCE(i.invoice_chain_root_id, i.invoice_id) <> ip.downpayment_invoice_id::INTEGER
           )
          WHERE ip.student_id IS NOT NULL
            AND ip.class_id IS NOT NULL
          GROUP BY ip.student_id, ip.class_id, ip.phase_start, ip.total_phases
        ),
        completed_profiles AS (
          SELECT
            student_id,
            class_id,
            phase_start,
            (phase_start + total_phases - 1) AS final_phase
          FROM profile_progress
          WHERE total_phases > 0
            AND paid_phases >= total_phases
        )
        UPDATE classstudentstbl cs
        SET program_enrollment_status = 're_enrolled'
        FROM completed_profiles cp
        WHERE cs.student_id = cp.student_id
          AND cs.class_id = cp.class_id
          AND cs.phase_number > cp.phase_start
          AND cs.phase_number < cp.final_phase
          AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'completed')
          AND cs.removed_at IS NULL
        RETURNING cs.classstudent_id
      `);
      const installmentCompletedResult = await client.query(`
        WITH profile_progress AS (
          SELECT
            ip.student_id,
            ip.class_id,
            COALESCE(ip.phase_start, 1)::integer AS phase_start,
            COALESCE(ip.total_phases, 0)::integer AS total_phases,
            COUNT(DISTINCT CASE
              WHEN i.status = 'Paid' THEN COALESCE(i.invoice_chain_root_id, i.invoice_id)
              ELSE NULL
            END)::integer AS paid_phases
          FROM installmentinvoiceprofilestbl ip
          LEFT JOIN invoicestbl i
            ON i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
           AND (
             ip.downpayment_invoice_id IS NULL
             OR COALESCE(i.invoice_chain_root_id, i.invoice_id) <> ip.downpayment_invoice_id::INTEGER
           )
          WHERE ip.student_id IS NOT NULL
            AND ip.class_id IS NOT NULL
          GROUP BY ip.student_id, ip.class_id, ip.phase_start, ip.total_phases
        ),
        completed_profiles AS (
          SELECT
            student_id,
            class_id,
            (phase_start + total_phases - 1) AS final_phase
          FROM profile_progress
          WHERE total_phases > 0
            AND paid_phases >= total_phases
        )
        UPDATE classstudentstbl cs
        SET program_enrollment_status = 'completed'
        FROM completed_profiles cp
        WHERE cs.student_id = cp.student_id
          AND cs.class_id = cp.class_id
          AND cs.phase_number = cp.final_phase
          AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'completed')
          AND cs.removed_at IS NULL
        RETURNING cs.classstudent_id
      `);

      // ── B) Full-payment students: class end_date passed ────────────────────
      // Full-payment enrollments create one classstudentstbl row per phase:
      // first phase stays "new", middle phases stay "re_enrolled", and only
      // the final phase becomes "completed" after the class end date.
      const fullPayKeepFirstPhaseNewResult = await client.query(`
        WITH full_payment_rows AS (
          SELECT
            cs.classstudent_id,
            MIN(cs.phase_number) OVER (PARTITION BY cs.student_id, cs.class_id) AS first_phase
          FROM classstudentstbl cs
          JOIN classestbl c ON cs.class_id = c.class_id
          WHERE cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'completed')
            AND cs.removed_at IS NULL
            AND c.end_date IS NOT NULL
            AND c.end_date < CURRENT_DATE
            AND NOT EXISTS (
              SELECT 1 FROM installmentinvoiceprofilestbl ip
              WHERE ip.student_id = cs.student_id
                AND ip.class_id = cs.class_id
            )
        )
        UPDATE classstudentstbl cs
        SET program_enrollment_status = CASE
              WHEN cs.program_enrollment_status = 'rejoin' THEN 'rejoin'
              ELSE 'new'
            END
        FROM full_payment_rows fpr
        WHERE cs.classstudent_id = fpr.classstudent_id
          AND cs.phase_number = fpr.first_phase
        RETURNING cs.classstudent_id
      `);
      const fullPayReEnrolledResult = await client.query(`
        WITH full_payment_rows AS (
          SELECT
            cs.classstudent_id,
            cs.phase_number,
            MIN(cs.phase_number) OVER (PARTITION BY cs.student_id, cs.class_id) AS first_phase,
            MAX(cs.phase_number) OVER (PARTITION BY cs.student_id, cs.class_id) AS final_phase
          FROM classstudentstbl cs
          JOIN classestbl c ON cs.class_id = c.class_id
          WHERE cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'completed')
            AND cs.removed_at IS NULL
            AND c.end_date IS NOT NULL
            AND c.end_date < CURRENT_DATE
            AND NOT EXISTS (
              SELECT 1 FROM installmentinvoiceprofilestbl ip
              WHERE ip.student_id = cs.student_id
                AND ip.class_id = cs.class_id
            )
        )
        UPDATE classstudentstbl cs
        SET program_enrollment_status = 're_enrolled'
        FROM full_payment_rows fpr
        WHERE cs.classstudent_id = fpr.classstudent_id
          AND cs.phase_number > fpr.first_phase
          AND cs.phase_number < fpr.final_phase
        RETURNING cs.classstudent_id
      `);
      const fullPayCompletedResult = await client.query(`
        WITH full_payment_rows AS (
          SELECT
            cs.classstudent_id,
            MAX(cs.phase_number) OVER (PARTITION BY cs.student_id, cs.class_id) AS final_phase
          FROM classstudentstbl cs
          JOIN classestbl c ON cs.class_id = c.class_id
          WHERE cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'completed')
            AND cs.removed_at IS NULL
            AND c.end_date IS NOT NULL
            AND c.end_date < CURRENT_DATE
            AND NOT EXISTS (
              SELECT 1 FROM installmentinvoiceprofilestbl ip
              WHERE ip.student_id = cs.student_id
                AND ip.class_id = cs.class_id
            )
        )
        UPDATE classstudentstbl cs
        SET program_enrollment_status = 'completed'
        FROM full_payment_rows fpr
        WHERE cs.classstudent_id = fpr.classstudent_id
          AND cs.phase_number = fpr.final_phase
        RETURNING cs.classstudent_id
      `);

      const programPaymentStatusResult = await syncAllProgramPaymentStatuses(client);

      await client.query('COMMIT');

      const totalMarked =
        installmentCompletedResult.rowCount + fullPayCompletedResult.rowCount;

      console.log(
        `[mark-completed] Marked ${installmentCompletedResult.rowCount} installment final-phase row(s) as completed` +
        ` and kept ${installmentKeepFirstPhaseNewResult.rowCount} first-phase row(s) as new` +
        ` and reset ${installmentReEnrolledResult.rowCount} intermediate installment row(s) to re_enrolled` +
        ` and marked ${fullPayCompletedResult.rowCount} full-payment final-phase row(s) as completed` +
        ` while keeping ${fullPayKeepFirstPhaseNewResult.rowCount} first-phase row(s) as new` +
        ` and ${fullPayReEnrolledResult.rowCount} intermediate full-payment row(s) as re_enrolled` +
        ` and synced ${programPaymentStatusResult.synced} program payment status row(s).`
      );

      res.json({
        success: true,
        message: `Marked ${totalMarked} enrollment row(s) as completed.`,
        data: {
          installment_rows_completed: installmentCompletedResult.rowCount,
          installment_rows_first_phase_new: installmentKeepFirstPhaseNewResult.rowCount,
          installment_rows_re_enrolled: installmentReEnrolledResult.rowCount,
          full_payment_rows_completed: fullPayCompletedResult.rowCount,
          full_payment_rows_first_phase_new: fullPayKeepFirstPhaseNewResult.rowCount,
          full_payment_rows_re_enrolled: fullPayReEnrolledResult.rowCount,
          program_payment_status_invoices_scanned: programPaymentStatusResult.invoices,
          program_payment_status_rows_synced: programPaymentStatusResult.synced,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

export default router;

