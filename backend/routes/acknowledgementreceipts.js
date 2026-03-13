import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query, getClient } from '../config/database.js';
import { formatYmdLocal } from '../utils/dateUtils.js';

const router = express.Router();

// All routes require authentication and branch access
router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

const generateAckReceiptNumber = () => {
  const now = new Date();
  const y = now.getFullYear().toString();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 900) + 100;
  return `AR-${y}${m}${d}-${h}${min}${s}-${rand}`;
};

/**
 * GET /api/sms/acknowledgement-receipts
 * List acknowledgement receipts with optional filters
 * Access: Superadmin, Admin, Finance, Superfinance
 */
router.get(
  '/',
  [
    queryValidator('status').optional().isString().withMessage('Status must be a string'),
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('search').optional().isString().withMessage('Search term must be a string'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance', 'Superfinance'),
  async (req, res, next) => {
    try {
      const { status, branch_id, search, page = 1, limit = 20 } = req.query;
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 20;
      const offset = (pageNum - 1) * limitNum;

      let sql = `
        SELECT
          ar.*,
          COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
          p.package_name,
          u.full_name AS student_name
        FROM acknowledgement_receiptstbl ar
        LEFT JOIN branchestbl b ON ar.branch_id = b.branch_id
        LEFT JOIN packagestbl p ON ar.package_id = p.package_id
        LEFT JOIN userstbl u ON ar.student_id = u.user_id
        WHERE 1=1
      `;

      const params = [];
      let paramCount = 0;

      // Branch restriction for non-superadmin users
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        paramCount += 1;
        sql += ` AND ar.branch_id = $${paramCount}`;
        params.push(req.user.branchId);
      } else if (branch_id) {
        paramCount += 1;
        sql += ` AND ar.branch_id = $${paramCount}`;
        params.push(branch_id);
      }

      if (status) {
        const statuses = String(status).split(',').map((s) => s.trim()).filter(Boolean);
        if (statuses.length > 0) {
          paramCount += 1;
          sql += ` AND ar.status = ANY($${paramCount}::text[])`;
          params.push(statuses);
        }
      }

      if (search) {
        paramCount += 1;
        const likeParam = `%${search}%`;
        sql += ` AND (
          ar.ack_receipt_number ILIKE $${paramCount}
          OR ar.prospect_student_name ILIKE $${paramCount}
          OR COALESCE(ar.prospect_student_contact, '') ILIKE $${paramCount}
          OR COALESCE(ar.reference_number, '') ILIKE $${paramCount}
        )`;
        params.push(likeParam);
      }

      sql += ` ORDER BY ar.ack_receipt_id DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limitNum, offset);

      const result = await query(sql, params);

      // Total count for pagination
      let countSql = `SELECT COUNT(*) AS total FROM acknowledgement_receiptstbl ar WHERE 1=1`;
      const countParams = [];
      let countParamCount = 0;

      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        countParamCount += 1;
        countSql += ` AND ar.branch_id = $${countParamCount}`;
        countParams.push(req.user.branchId);
      } else if (branch_id) {
        countParamCount += 1;
        countSql += ` AND ar.branch_id = $${countParamCount}`;
        countParams.push(branch_id);
      }

      if (status) {
        const statuses = String(status).split(',').map((s) => s.trim()).filter(Boolean);
        if (statuses.length > 0) {
          countParamCount += 1;
          countSql += ` AND ar.status = ANY($${countParamCount}::text[])`;
          countParams.push(statuses);
        }
      }

      if (search) {
        countParamCount += 1;
        const likeParam = `%${search}%`;
        countSql += ` AND (
          ar.ack_receipt_number ILIKE $${countParamCount}
          OR ar.prospect_student_name ILIKE $${countParamCount}
          OR COALESCE(ar.prospect_student_contact, '') ILIKE $${countParamCount}
          OR COALESCE(ar.reference_number, '') ILIKE $${countParamCount}
        )`;
        countParams.push(likeParam);
      }

      const countResult = await query(countSql, countParams);
      const total = parseInt(countResult.rows[0].total, 10) || 0;

      res.json({
        success: true,
        data: result.rows,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/sms/acknowledgement-receipts
 * Create a new acknowledgement receipt (front-desk fast payment)
 * Access: Superadmin, Admin, Finance, Superfinance
 */
router.post(
  '/',
  [
    body('prospect_student_name').notEmpty().isString().withMessage('Student name is required'),
    body('prospect_student_contact').notEmpty().isString().withMessage('Guardian name is required'),
    body('prospect_student_notes').optional().isString().withMessage('Notes must be a string'),
    body('package_id').isInt().withMessage('Package ID is required and must be an integer'),
    body('payment_amount').isFloat({ min: 0.01 }).withMessage('Payment amount must be greater than 0'),
    body('issue_date').isISO8601().withMessage('Issue date is required and must be a valid date'),
    body('reference_number').optional({ nullable: true }).isString().withMessage('Reference number must be a string'),
    body('payment_attachment_url').optional({ nullable: true }).isString().withMessage('Attachment URL must be a string'),
    body('level_tag').optional({ nullable: true }).isString().withMessage('Level tag must be a string'),
    body('installment_option')
      .optional({ nullable: true })
      .isIn(['downpayment_only', 'downpayment_plus_phase1'])
      .withMessage('installment_option must be downpayment_only or downpayment_plus_phase1'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance', 'Superfinance'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const {
        prospect_student_name,
        prospect_student_contact,
        prospect_student_notes,
        package_id,
        payment_amount,
        issue_date,
        reference_number,
        payment_attachment_url,
        level_tag,
        installment_option,
        branch_id: bodyBranchId,
      } = req.body;

      // Ensure package exists and get snapshot info
      const pkgResult = await client.query(
        `SELECT package_id, package_name, package_price, branch_id 
         FROM packagestbl 
         WHERE package_id = $1`,
        [package_id]
      );

      if (pkgResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Package not found',
        });
      }

      const pkg = pkgResult.rows[0];

      // Determine branch: prefer explicit branch_id from body (for Superadmin),
      // then user's branch, then package branch if available
      const branchId = bodyBranchId || req.user.branchId || pkg.branch_id || null;

      if (!branchId) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Branch is required to create an acknowledgement receipt',
        });
      }

      // Verify branch exists
      const branchCheck = await client.query('SELECT branch_id FROM branchestbl WHERE branch_id = $1', [branchId]);
      if (branchCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Branch not found',
        });
      }

      const createdBy = req.user.userId || null;

      const ackNumber = generateAckReceiptNumber();

      const insertResult = await client.query(
        `INSERT INTO acknowledgement_receiptstbl (
           ack_receipt_number,
           status,
           prospect_student_name,
           prospect_student_contact,
           prospect_student_notes,
           student_id,
           branch_id,
           package_id,
           package_name_snapshot,
           package_amount_snapshot,
           payment_amount,
           issue_date,
           reference_number,
           payment_attachment_url,
           level_tag,
           installment_option,
           invoice_id,
           payment_id,
           created_by
         )
         VALUES (
           $1, 'Paid', $2, $3, $4, NULL, $5, $6, $7, $8,
           $9, $10, $11, $12, $13, $14, NULL, NULL, $15
         )
         RETURNING *`,
        [
          ackNumber,
          prospect_student_name,
          prospect_student_contact || null,
          prospect_student_notes || null,
          branchId,
          pkg.package_id,
          pkg.package_name,
          pkg.package_price,
          payment_amount,
          issue_date,
          reference_number || null,
          payment_attachment_url || null,
          level_tag || null,
          installment_option || null,
          createdBy,
        ]
      );

      const ackReceipt = insertResult.rows[0];

      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        data: ackReceipt,
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
 * GET /api/sms/acknowledgement-receipts/:id
 * Get a single acknowledgement receipt
 * Access: Superadmin, Admin, Finance, Superfinance
 */
router.get(
  '/:id',
  [param('id').isInt().withMessage('ID must be an integer'), handleValidationErrors],
  requireRole('Superadmin', 'Admin', 'Finance', 'Superfinance'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const sql = `
        SELECT
          ar.*,
          COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
          p.package_name,
          u.full_name AS student_name
        FROM acknowledgement_receiptstbl ar
        LEFT JOIN branchestbl b ON ar.branch_id = b.branch_id
        LEFT JOIN packagestbl p ON ar.package_id = p.package_id
        LEFT JOIN userstbl u ON ar.student_id = u.user_id
        WHERE ar.ack_receipt_id = $1
      `;
      const result = await query(sql, [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Acknowledgement receipt not found',
        });
      }

      const ar = result.rows[0];

      // Enforce branch restriction for non-superadmin users
      if (req.user.userType !== 'Superadmin' && req.user.branchId && ar.branch_id !== req.user.branchId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
        });
      }

      res.json({
        success: true,
        data: ar,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/sms/acknowledgement-receipts/:id/attach-to-invoice
 * Attach an acknowledgement receipt to an invoice and create payment
 * Access: Superadmin, Admin, Finance, Superfinance
 */
router.post(
  '/:id/attach-to-invoice',
  [
    param('id').isInt().withMessage('ID must be an integer'),
    body('invoice_id').isInt().withMessage('Invoice ID is required and must be an integer'),
    body('student_id').isInt().withMessage('Student ID is required and must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance', 'Superfinance'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const { invoice_id, student_id } = req.body;

      // Load acknowledgement receipt
      const ackResult = await client.query(
        'SELECT * FROM acknowledgement_receiptstbl WHERE ack_receipt_id = $1',
        [id]
      );

      if (ackResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Acknowledgement receipt not found',
        });
      }

      const ack = ackResult.rows[0];

      if (!['Pending', 'Paid'].includes(ack.status)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Acknowledgement receipt is already attached or cancelled',
        });
      }

      // Enforce branch access: non-superadmin limited to their branch
      if (req.user.userType !== 'Superadmin' && req.user.branchId && ack.branch_id !== req.user.branchId) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          success: false,
          message: 'Access denied for this acknowledgement receipt',
        });
      }

      // Verify student exists
      const studentCheck = await client.query('SELECT * FROM userstbl WHERE user_id = $1', [student_id]);
      if (studentCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Student not found',
        });
      }

      // Verify invoice exists
      const invoiceCheck = await client.query(
        'SELECT *, installmentinvoiceprofiles_id FROM invoicestbl WHERE invoice_id = $1',
        [invoice_id]
      );
      if (invoiceCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Invoice not found',
        });
      }

      const invoice = invoiceCheck.rows[0];

      // Basic sanity: ensure invoice is not already fully paid
      if (invoice.status === 'Paid') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Invoice is already fully paid',
        });
      }

      // Determine branch_id for payment from invoice or user
      const branch_id = invoice.branch_id || req.user.branchId || ack.branch_id || null;

      if (!branch_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Unable to determine branch for payment',
        });
      }

      // Verify branch exists
      const branchCheck = await client.query('SELECT branch_id FROM branchestbl WHERE branch_id = $1', [branch_id]);
      if (branchCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Branch not found',
        });
      }

      const createdBy = req.user.userId || null;

      // Create payment record from AR details — carry over reference_number and attachment from AR
      const paymentResult = await client.query(
        `INSERT INTO paymenttbl (
           invoice_id,
           student_id,
           branch_id,
           payment_method,
           payment_type,
           payable_amount,
           issue_date,
           status,
           reference_number,
           remarks,
           created_by,
           payment_attachment_url
         )
         VALUES ($1, $2, $3, 'Cash', 'Full Payment', $4, $5, 'Completed', $6, $7, $8, $9)
         RETURNING *`,
        [
          invoice_id,
          student_id,
          branch_id,
          ack.payment_amount,
          ack.issue_date,
          ack.reference_number || null,
          ack.prospect_student_notes
            ? `Paid via AR ${ack.ack_receipt_number}: ${ack.prospect_student_notes}`
            : `Paid via AR ${ack.ack_receipt_number}`,
          createdBy,
          ack.payment_attachment_url || null,
        ]
      );

      const newPayment = paymentResult.rows[0];

      // Update invoice payments and status (reuse logic from payments POST)
      const invoiceItemsResult = await client.query(
        `SELECT 
          COALESCE(SUM(amount), 0) as item_amount,
          COALESCE(SUM(discount_amount), 0) as total_discount,
          COALESCE(SUM(penalty_amount), 0) as total_penalty,
          COALESCE(SUM(amount * COALESCE(tax_percentage, 0) / 100), 0) as total_tax
         FROM invoiceitemstbl 
         WHERE invoice_id = $1`,
        [invoice_id]
      );

      const itemAmount = parseFloat(invoiceItemsResult.rows[0].item_amount) || 0;
      const totalDiscount = parseFloat(invoiceItemsResult.rows[0].total_discount) || 0;
      const totalPenalty = parseFloat(invoiceItemsResult.rows[0].total_penalty) || 0;
      const totalTax = parseFloat(invoiceItemsResult.rows[0].total_tax) || 0;

      const originalInvoiceAmount = itemAmount - totalDiscount + totalPenalty + totalTax;

      const totalPaymentsResult = await client.query(
        'SELECT COALESCE(SUM(payable_amount), 0) as total_paid FROM paymenttbl WHERE invoice_id = $1 AND status = $2',
        [invoice_id, 'Completed']
      );
      const totalPaid = parseFloat(totalPaymentsResult.rows[0].total_paid) || 0;

      const remainingBalance = Math.max(0, originalInvoiceAmount - totalPaid);

      await client.query('UPDATE invoicestbl SET amount = $1 WHERE invoice_id = $2', [
        remainingBalance,
        invoice_id,
      ]);

      let newInvoiceStatus = invoice.status;
      if (totalPaid >= originalInvoiceAmount) {
        newInvoiceStatus = 'Paid';
      } else if (totalPaid > 0) {
        newInvoiceStatus = 'Partially Paid';
      } else {
        if (invoice.status === 'Paid' || invoice.status === 'Partially Paid') {
          newInvoiceStatus = 'Unpaid';
        }
      }

      if (newInvoiceStatus !== invoice.status) {
        await client.query('UPDATE invoicestbl SET status = $1 WHERE invoice_id = $2', [
          newInvoiceStatus,
          invoice_id,
        ]);
      }

      // ── INSTALLMENT DOWNPAYMENT LOGIC ─────────────────────────────────────────
      // If the invoice is linked to an installment profile, mirror the same
      // post-payment logic from payments.js:
      //   • Mark downpayment as paid
      //   • Create the first installment invoice record
      //   • Generate the first installment invoice (async, after COMMIT)
      let _pendingInvoiceGeneration = null;
      if (newInvoiceStatus === 'Paid' && invoice.installmentinvoiceprofiles_id) {
        try {
          const profileResult = await client.query(
            `SELECT ip.class_id, ip.student_id, ip.total_phases, ip.generated_count,
                    ip.downpayment_paid, ip.downpayment_invoice_id, ip.amount, ip.frequency,
                    ip.first_generation_date, ip.next_invoice_due_date, ip.bill_invoice_due_date,
                    ip.branch_id, ip.package_id, ip.description
             FROM installmentinvoiceprofilestbl ip
             WHERE ip.installmentinvoiceprofiles_id = $1`,
            [invoice.installmentinvoiceprofiles_id]
          );

          if (profileResult.rows.length > 0) {
            const profile = profileResult.rows[0];

            // Only act on the downpayment invoice
            if (profile.downpayment_invoice_id === invoice_id && !profile.downpayment_paid) {
              // Mark downpayment as paid
              await client.query(
                `UPDATE installmentinvoiceprofilestbl
                 SET downpayment_paid = true
                 WHERE installmentinvoiceprofiles_id = $1`,
                [invoice.installmentinvoiceprofiles_id]
              );

              // Get student name for the installment invoice record
              const studentNameResult = await client.query(
                'SELECT full_name FROM userstbl WHERE user_id = $1',
                [student_id]
              );
              const studentName = studentNameResult.rows[0]?.full_name || 'Student';

              // Calculate dates for the first installment invoice
              const firstGenerationDate = profile.first_generation_date
                ? new Date(profile.first_generation_date)
                : new Date();
              const nextInvoiceDueDate = profile.next_invoice_due_date
                ? new Date(profile.next_invoice_due_date)
                : new Date();
              // next_invoice_month must always be the first day of the SAME month as next_generation_date
              const nextInvoiceMonth = new Date(firstGenerationDate.getFullYear(), firstGenerationDate.getMonth(), 1);

              // Create the first installment invoice record
              const firstInvoiceRecordResult = await client.query(
                `INSERT INTO installmentinvoicestbl
                 (installmentinvoiceprofiles_id, scheduled_date, status, student_name,
                  total_amount_including_tax, total_amount_excluding_tax, frequency,
                  next_generation_date, next_invoice_month)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING *`,
                [
                  invoice.installmentinvoiceprofiles_id,
                  profile.bill_invoice_due_date || formatYmdLocal(nextInvoiceDueDate),
                  'Pending',
                  studentName,
                  profile.amount,
                  profile.amount,
                  profile.frequency || '1 month(s)',
                  formatYmdLocal(firstGenerationDate),
                  formatYmdLocal(nextInvoiceMonth),
                ]
              );

              const firstInvoiceRecord = firstInvoiceRecordResult.rows[0];
              console.log(`✅ AR downpayment paid: Created first installment invoice record for profile ${invoice.installmentinvoiceprofiles_id}`);

              // Store for async generation after COMMIT
              _pendingInvoiceGeneration = {
                firstInvoiceRecord,
                profile: {
                  student_id: profile.student_id,
                  branch_id: profile.branch_id || invoice.branch_id || null,
                  package_id: profile.package_id || null,
                  amount: profile.amount,
                  frequency: profile.frequency || '1 month(s)',
                  description: profile.description || 'Monthly Installment Payment',
                  generated_count: profile.generated_count || 0,
                  class_id: profile.class_id,
                },
                profileId: invoice.installmentinvoiceprofiles_id,
                // When "downpayment_plus_phase1" option: auto-pay Phase 1 after generating it
                autoPayPhase1: ack.installment_option === 'downpayment_plus_phase1',
                autoPayPhase1Data: ack.installment_option === 'downpayment_plus_phase1' ? {
                  student_id,
                  branch_id: profile.branch_id || invoice.branch_id || null,
                  ack_receipt_number: ack.ack_receipt_number,
                  issue_date: ack.issue_date,
                  created_by: req.user.userId || null,
                  class_id: profile.class_id,
                  phase_1_amount: parseFloat(profile.amount),
                  profile_id: invoice.installmentinvoiceprofiles_id,
                  reference_number: ack.reference_number || null,
                  payment_attachment_url: ack.payment_attachment_url || null,
                } : null,
              };
              // NOTE: If downpayment_only, student is NOT enrolled yet.
              // Auto-enrollment happens when Phase 1 invoice is paid (via payments.js).
              // If downpayment_plus_phase1, Phase 1 is auto-paid below and student is enrolled then.
            }
          }
        } catch (installmentError) {
          console.error('Error processing AR installment downpayment:', installmentError);
        }
      }

      // If invoice is now fully paid (and not an installment or reservation fee),
      // reuse the full-payment auto-enrollment logic from payments.
      if (
        newInvoiceStatus === 'Paid' &&
        !invoice.installmentinvoiceprofiles_id &&
        invoice.invoice_description &&
        !invoice.invoice_description.includes('Reservation Fee')
      ) {
        try {
          // Get class_id from invoice remarks field (stored as CLASS_ID:class_id)
          let classId = null;
          if (invoice.remarks && invoice.remarks.includes('CLASS_ID:')) {
            const match = invoice.remarks.match(/CLASS_ID:(\d+)/);
            if (match) {
              classId = parseInt(match[1], 10);
            }
          }

          if (classId) {
            // Get class and curriculum info
            const classResult = await client.query(
              `SELECT c.class_id, c.program_id, cu.number_of_phase
               FROM classestbl c
               LEFT JOIN programstbl p ON c.program_id = p.program_id
               LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
               WHERE c.class_id = $1`,
              [classId]
            );

            if (classResult.rows.length > 0) {
              const classData = classResult.rows[0];
              const totalPhases = classData.number_of_phase || 1;

              // Determine phase range for enrollment
              // Default: 1..totalPhases (full payment for entire class)
              // Phase packages: override using PHASE_START / PHASE_END from remarks
              let phaseStart = 1;
              let phaseEnd = totalPhases;
              if (invoice.remarks && invoice.remarks.includes('PHASE_START:')) {
                const startMatch = invoice.remarks.match(/PHASE_START:(\d+)/);
                if (startMatch) {
                  phaseStart = parseInt(startMatch[1], 10) || 1;
                }
              }
              if (invoice.remarks && invoice.remarks.includes('PHASE_END:')) {
                const endMatch = invoice.remarks.match(/PHASE_END:(\d+)/);
                if (endMatch) {
                  phaseEnd = parseInt(endMatch[1], 10) || phaseStart;
                }
              }
              // Clamp to valid range
              if (phaseStart < 1) phaseStart = 1;
              if (phaseEnd > totalPhases) phaseEnd = totalPhases;
              if (phaseEnd < phaseStart) phaseEnd = phaseStart;

              // Check if student is already enrolled in this class
              const existingEnrollmentCheck = await client.query(
                `SELECT classstudent_id, phase_number 
                 FROM classstudentstbl 
                 WHERE student_id = $1 AND class_id = $2
                 ORDER BY phase_number DESC`,
                [student_id, classId]
              );

              // If student is not enrolled, enroll in all phases for full payment
              if (existingEnrollmentCheck.rows.length === 0) {
                for (let phase = phaseStart; phase <= phaseEnd; phase += 1) {
                  await client.query(
                    `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number)
                     VALUES ($1, $2, $3, $4)`,
                    [
                      student_id,
                      classId,
                      'System (Auto-enrolled via AR full payment)',
                      phase,
                    ]
                  );
                }
              }
            }
          }
        } catch (fullPaymentError) {
          // Log error but don't fail AR attachment / payment
          console.error('Error auto-enrolling student for AR full payment:', fullPaymentError);
        }
      }

      // Link AR to invoice and payment
      await client.query(
        `UPDATE acknowledgement_receiptstbl
         SET status = 'Enrolled',
             student_id = $1,
             invoice_id = $2,
             payment_id = $3
         WHERE ack_receipt_id = $4`,
        [student_id, invoice_id, newPayment.payment_id, id]
      );

      await client.query('COMMIT');

      // Generate the first installment invoice AFTER the transaction commits
      // (mirrors the same async pattern used in payments.js)
      if (_pendingInvoiceGeneration) {
        const { firstInvoiceRecord, profile: genProfile, profileId, autoPayPhase1, autoPayPhase1Data } = _pendingInvoiceGeneration;
        (async () => {
          try {
            const { generateInvoiceFromInstallment } = await import('../utils/installmentInvoiceGenerator.js');
            const { query: dbQuery } = await import('../config/database.js');

            // Step 1: Generate Phase 1 invoice
            const generatedInvoice = await generateInvoiceFromInstallment(firstInvoiceRecord, genProfile);
            console.log(`✅ AR downpayment paid: Generated Phase 1 invoice ${generatedInvoice.invoice_id} for profile ${profileId}`);

            // Step 2: If "downpayment_plus_phase1", auto-pay Phase 1 and generate Phase 2
            if (autoPayPhase1 && autoPayPhase1Data) {
              try {
                const { student_id: sid, branch_id: bid, ack_receipt_number, issue_date: ackDate,
                  created_by: createdBy, class_id, phase_1_amount, profile_id } = autoPayPhase1Data;

                // Create payment for Phase 1 invoice — carry over AR reference and attachment
                const phase1InvoiceId = generatedInvoice.invoice_id;
                await dbQuery(
                  `INSERT INTO paymenttbl (invoice_id, student_id, branch_id, payment_method, payment_type,
                     payable_amount, issue_date, status, reference_number, remarks, created_by, payment_attachment_url)
                   VALUES ($1, $2, $3, 'Cash', 'Installment', $4, $5, 'Completed', $6, $7, $8, $9)`,
                  [
                    phase1InvoiceId,
                    sid,
                    bid,
                    phase_1_amount,
                    ackDate,
                    autoPayPhase1Data.reference_number || null,
                    `Phase 1 auto-paid via AR ${ack_receipt_number} (Downpayment + Phase 1 option)`,
                    createdBy,
                    autoPayPhase1Data.payment_attachment_url || null,
                  ]
                );

                // Mark Phase 1 invoice as Paid
                await dbQuery(
                  `UPDATE invoicestbl SET status = 'Paid', amount = 0 WHERE invoice_id = $1`,
                  [phase1InvoiceId]
                );
                console.log(`✅ AR Phase 1 auto-paid: invoice ${phase1InvoiceId}`);

                // Enroll student in Phase 1 (phase_number = 1)
                if (class_id) {
                  const existingEnroll = await dbQuery(
                    `SELECT classstudent_id FROM classstudentstbl WHERE student_id = $1 AND class_id = $2 AND phase_number = 1`,
                    [sid, class_id]
                  );
                  if (existingEnroll.rows.length === 0) {
                    await dbQuery(
                      `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number)
                       VALUES ($1, $2, $3, 1)`,
                      [sid, class_id, 'System (Auto-enrolled via AR Downpayment + Phase 1)']
                    );
                    console.log(`✅ AR Phase 1 auto-enrolled: student ${sid} in class ${class_id} phase 1`);
                  }
                }

                // Fetch the updated installmentinvoicestbl record for Phase 2 generation
                const nextInstallmentRecord = await dbQuery(
                  `SELECT * FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1 AND (status IS NULL OR status = '' OR status = 'Pending')
                   ORDER BY installmentinvoicedtl_id DESC LIMIT 1`,
                  [profile_id]
                );

                if (nextInstallmentRecord.rows.length > 0) {
                  const nextRecord = nextInstallmentRecord.rows[0];
                  // Generate Phase 2 invoice
                  const phase2Invoice = await generateInvoiceFromInstallment(nextRecord, {
                    ...genProfile,
                    generated_count: generatedInvoice.generated_count || 1,
                  });
                  console.log(`✅ AR Phase 2 generated: invoice ${phase2Invoice.invoice_id} for profile ${profile_id}`);
                } else {
                  console.log(`ℹ️ AR Phase 2 skipped: no pending installment record found (all phases generated)`);
                }
              } catch (phase1Error) {
                console.error(`⚠️ Error auto-paying Phase 1 (AR) for profile ${profileId}:`, phase1Error);
              }
            }
          } catch (invoiceGenError) {
            console.error(`⚠️ Error generating first installment invoice (AR) for profile ${profileId}:`, invoiceGenError);
          }
        })();
      }

      res.json({
        success: true,
        message: 'Acknowledgement receipt attached and payment recorded successfully',
        data: {
          acknowledgement_receipt: {
            ack_receipt_id: ack.ack_receipt_id,
            ack_receipt_number: ack.ack_receipt_number,
            status: 'Enrolled',
            invoice_id,
            payment_id: newPayment.payment_id,
          },
          payment: newPayment,
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

