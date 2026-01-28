import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query, getClient } from '../config/database.js';
import { sendInvoiceEmail } from '../utils/emailService.js';
import { generateInvoicePDFBuffer } from '../utils/pdfGenerator.js';
import { formatYmdLocal } from '../utils/dateUtils.js';

const router = express.Router();

// All routes require authentication
router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

/**
 * GET /api/sms/payments
 * Get all payments with optional filters
 * Access: All authenticated users
 */
router.get(
  '/',
  [
    queryValidator('invoice_id').optional().isInt().withMessage('Invoice ID must be an integer'),
    queryValidator('student_id').optional().isInt().withMessage('Student ID must be an integer'),
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('status').optional().isString().withMessage('Status must be a string'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { invoice_id, student_id, branch_id, status, page = 1, limit = 20 } = req.query;
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 20;
      const offset = (pageNum - 1) * limitNum;

      let sql = `SELECT p.payment_id, p.invoice_id, p.student_id, p.branch_id, 
                        p.payment_method, p.payment_type, p.payable_amount, 
                        TO_CHAR(p.issue_date, 'YYYY-MM-DD') as issue_date, 
                        p.status, p.reference_number, p.remarks, p.created_by,
                        TO_CHAR(p.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
                        u.full_name as student_name, u.email as student_email,
                        i.invoice_description, i.amount as invoice_amount,
                        b.branch_name
                 FROM paymenttbl p
                 LEFT JOIN userstbl u ON p.student_id = u.user_id
                 LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
                 LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
                 WHERE 1=1`;
      const params = [];
      let paramCount = 0;

      // Filter by branch (non-superadmin users are limited to their branch)
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        paramCount++;
        sql += ` AND p.branch_id = $${paramCount}`;
        params.push(req.user.branchId);
      } else if (branch_id) {
        paramCount++;
        sql += ` AND p.branch_id = $${paramCount}`;
        params.push(branch_id);
      }

      if (invoice_id) {
        paramCount++;
        sql += ` AND p.invoice_id = $${paramCount}`;
        params.push(invoice_id);
      }

      if (student_id) {
        paramCount++;
        sql += ` AND p.student_id = $${paramCount}`;
        params.push(student_id);
      }

      if (status) {
        paramCount++;
        sql += ` AND p.status = $${paramCount}`;
        params.push(status);
      }

      sql += ` ORDER BY p.payment_id DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limitNum, offset);

      const result = await query(sql, params);

      // Get total count for pagination
      let countSql = `SELECT COUNT(*) as total FROM paymenttbl p WHERE 1=1`;
      const countParams = [];
      let countParamCount = 0;

      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        countParamCount++;
        countSql += ` AND p.branch_id = $${countParamCount}`;
        countParams.push(req.user.branchId);
      } else if (branch_id) {
        countParamCount++;
        countSql += ` AND p.branch_id = $${countParamCount}`;
        countParams.push(branch_id);
      }

      if (invoice_id) {
        countParamCount++;
        countSql += ` AND p.invoice_id = $${countParamCount}`;
        countParams.push(invoice_id);
      }

      if (student_id) {
        countParamCount++;
        countSql += ` AND p.student_id = $${countParamCount}`;
        countParams.push(student_id);
      }

      if (status) {
        countParamCount++;
        countSql += ` AND p.status = $${countParamCount}`;
        countParams.push(status);
      }

      const countResult = await query(countSql, countParams);
      const total = parseInt(countResult.rows[0].total);

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
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/payments/:id
 * Get payment by ID
 * Access: All authenticated users
 */
router.get(
  '/:id',
  [
    param('id').isInt().withMessage('Payment ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const result = await query(
        `SELECT p.payment_id, p.invoice_id, p.student_id, p.branch_id, 
                p.payment_method, p.payment_type, p.payable_amount, 
                TO_CHAR(p.issue_date, 'YYYY-MM-DD') as issue_date, 
                p.status, p.reference_number, p.remarks, p.created_by,
                TO_CHAR(p.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
                u.full_name as student_name, u.email as student_email,
                i.invoice_description, i.amount as invoice_amount,
                b.branch_name
         FROM paymenttbl p
         LEFT JOIN userstbl u ON p.student_id = u.user_id
         LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
         LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
         WHERE p.payment_id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Payment not found',
        });
      }

      // Check branch access
      const payment = result.rows[0];
      if (req.user.userType !== 'Superadmin' && req.user.branchId && payment.branch_id !== req.user.branchId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
        });
      }

      res.json({
        success: true,
        data: payment,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/payments/invoice/:invoice_id
 * Get all payments for a specific invoice
 * Access: All authenticated users
 */
router.get(
  '/invoice/:invoice_id',
  [
    param('invoice_id').isInt().withMessage('Invoice ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { invoice_id } = req.params;

      const result = await query(
        `SELECT p.payment_id, p.invoice_id, p.student_id, p.branch_id, 
                p.payment_method, p.payment_type, p.payable_amount, 
                TO_CHAR(p.issue_date, 'YYYY-MM-DD') as issue_date, 
                p.status, p.reference_number, p.remarks, p.created_by,
                TO_CHAR(p.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
                u.full_name as student_name, u.email as student_email
         FROM paymenttbl p
         LEFT JOIN userstbl u ON p.student_id = u.user_id
         WHERE p.invoice_id = $1
         ORDER BY p.payment_id DESC`,
        [invoice_id]
      );

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sms/payments
 * Create new payment
 * Access: Superadmin, Admin
 */
router.post(
  '/',
  [
    body('invoice_id').isInt().withMessage('Invoice ID is required and must be an integer'),
    body('student_id').isInt().withMessage('Student ID is required and must be an integer'),
    body('payment_method').notEmpty().isString().withMessage('Payment method is required'),
    body('payment_type').notEmpty().isString().withMessage('Payment type is required'),
    body('payable_amount').isFloat({ min: 0.01 }).withMessage('Payable amount is required and must be greater than 0'),
    body('issue_date').isISO8601().withMessage('Issue date is required and must be a valid date'),
    body('status').optional().isString().withMessage('Status must be a string'),
    body('reference_number').optional().isString().withMessage('Reference number must be a string'),
    body('remarks').optional().isString().withMessage('Remarks must be a string'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const {
        invoice_id,
        student_id,
        payment_method,
        payment_type,
        payable_amount,
        issue_date,
        status = 'Completed',
        reference_number,
        remarks,
      } = req.body;

      // Verify invoice exists (include installmentinvoiceprofiles_id for phase tracking)
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

      // Verify student exists
      const studentCheck = await client.query('SELECT * FROM userstbl WHERE user_id = $1', [student_id]);
      if (studentCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Student not found',
        });
      }

      // Verify student is associated with the invoice
      const invoiceStudentCheck = await client.query(
        'SELECT * FROM invoicestudentstbl WHERE invoice_id = $1 AND student_id = $2',
        [invoice_id, student_id]
      );
      if (invoiceStudentCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Student is not associated with this invoice',
        });
      }

      // Get branch_id from invoice
      const branch_id = invoice.branch_id || req.user.branchId || null;

      // Verify branch exists if provided
      if (branch_id) {
        const branchCheck = await client.query('SELECT branch_id FROM branchestbl WHERE branch_id = $1', [branch_id]);
        if (branchCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            success: false,
            message: 'Branch not found',
          });
        }
      }

      // Get created_by from authenticated user
      const createdBy = req.user.userId || null;

      // Create payment
      const paymentResult = await client.query(
        `INSERT INTO paymenttbl (invoice_id, student_id, branch_id, payment_method, payment_type, 
                                 payable_amount, issue_date, status, reference_number, remarks, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          invoice_id,
          student_id,
          branch_id,
          payment_method,
          payment_type,
          payable_amount,
          issue_date,
          status,
          reference_number || null,
          remarks || null,
          createdBy,
        ]
      );

      const newPayment = paymentResult.rows[0];

      // Calculate original invoice amount from invoice items
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
      
      // Original invoice amount = items - discounts + penalties + tax
      const originalInvoiceAmount = itemAmount - totalDiscount + totalPenalty + totalTax;
      
      // Calculate total payments for this invoice
      const totalPaymentsResult = await client.query(
        'SELECT COALESCE(SUM(payable_amount), 0) as total_paid FROM paymenttbl WHERE invoice_id = $1 AND status = $2',
        [invoice_id, 'Completed']
      );
      const totalPaid = parseFloat(totalPaymentsResult.rows[0].total_paid) || 0;
      
      // Calculate remaining balance (original amount - total paid)
      const remainingBalance = Math.max(0, originalInvoiceAmount - totalPaid);
      
      // Update invoice amount to reflect remaining balance
      await client.query('UPDATE invoicestbl SET amount = $1 WHERE invoice_id = $2', [
        remainingBalance,
        invoice_id,
      ]);

      // Update invoice status based on payment
      let newInvoiceStatus = invoice.status;
      if (totalPaid >= originalInvoiceAmount) {
        newInvoiceStatus = 'Paid';
      } else if (totalPaid > 0) {
        newInvoiceStatus = 'Partially Paid';
      } else {
        // If payment is removed and invoice becomes unpaid, check if it's a package price invoice
        // If yes, remove student enrollment
        if (invoice.status === 'Paid' || invoice.status === 'Partially Paid') {
          newInvoiceStatus = 'Unpaid';
          
          // Check if this is a package price invoice (not an installment invoice, not a reservation fee)
          // Package price invoices don't have installmentinvoiceprofiles_id
          if (!invoice.installmentinvoiceprofiles_id && 
              invoice.invoice_description && 
              !invoice.invoice_description.includes('Reservation Fee')) {
            try {
              // Get student from invoice
              const invoiceStudentResult = await client.query(
                `SELECT ist.student_id 
                 FROM invoicestudentstbl ist
                 WHERE ist.invoice_id = $1
                 LIMIT 1`,
                [invoice_id]
              );
              
              if (invoiceStudentResult.rows.length > 0) {
                const invoiceStudentId = invoiceStudentResult.rows[0].student_id;
                
                // Find enrollments for this student that were created around the same time as the invoice
                // This helps identify enrollments linked to this package price invoice
                // We'll check enrollments created within 24 hours of invoice issue date
                const enrollmentResult = await client.query(
                  `SELECT cs.classstudent_id, cs.class_id, cs.phase_number, cs.student_id, cs.enrolled_at
                   FROM classstudentstbl cs
                   WHERE cs.student_id = $1
                     AND cs.enrolled_at >= $2::date - INTERVAL '24 hours'
                     AND cs.enrolled_at <= $2::date + INTERVAL '24 hours'
                   ORDER BY cs.enrolled_at DESC`,
                  [invoiceStudentId, invoice.issue_date]
                );
                
                // Remove all enrollments that were created around the same time as the invoice
                // This handles cases where student was enrolled in multiple phases (fullpayment)
                for (const enrollment of enrollmentResult.rows) {
                  await client.query(
                    `DELETE FROM classstudentstbl WHERE classstudent_id = $1`,
                    [enrollment.classstudent_id]
                  );
                  console.log(`⚠️ Student ${enrollment.student_id} removed from class ${enrollment.class_id}, phase ${enrollment.phase_number} due to unpaid package price invoice`);
                }
              }
            } catch (removalError) {
              console.error('Error removing student enrollment due to unpaid invoice:', removalError);
              // Don't fail the payment update if removal fails
            }
          }
        }
      }

      if (newInvoiceStatus !== invoice.status) {
        await client.query('UPDATE invoicestbl SET status = $1 WHERE invoice_id = $2', [
          newInvoiceStatus,
          invoice_id,
        ]);
      }

      // Check if this invoice is linked to a reservation
      // If yes, and invoice is now fully paid, update reservation status to "Fee Paid"
      // Note: Student is NOT auto-enrolled here. Enrollment only happens when reservation is upgraded.
      if (newInvoiceStatus === 'Paid') {
        const reservationCheck = await client.query(
          `SELECT r.reserved_id, r.status, r.student_id, r.class_id, r.phase_number, r.branch_id
           FROM reservedstudentstbl r
           WHERE r.invoice_id = $1`,
          [invoice_id]
        );
        
        if (reservationCheck.rows.length > 0) {
          const reservation = reservationCheck.rows[0];
          // Only update if reservation is still in "Reserved" status
          if (reservation.status === 'Reserved') {
            await client.query(
              `UPDATE reservedstudentstbl 
               SET status = 'Fee Paid', reservation_fee_paid_at = CURRENT_TIMESTAMP
               WHERE reserved_id = $1`,
              [reservation.reserved_id]
            );
            console.log(`✅ Reservation ${reservation.reserved_id} status updated to "Fee Paid" after payment`);
            // Note: Student is NOT auto-enrolled here. Enrollment only happens when reservation is upgraded.
          }
        }
      }

      // Check if this is a downpayment invoice payment
      // If yes, mark downpayment as paid and create first installment invoice record
      if (newInvoiceStatus === 'Paid' && invoice.installmentinvoiceprofiles_id) {
        try {
              // Get installment invoice profile to check if this is a downpayment invoice
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
            
            // Check if this is the downpayment invoice and it hasn't been paid yet
            if (profile.downpayment_invoice_id === invoice_id && !profile.downpayment_paid) {
              // Mark downpayment as paid
              await client.query(
                `UPDATE installmentinvoiceprofilestbl 
                 SET downpayment_paid = true 
                 WHERE installmentinvoiceprofiles_id = $1`,
                [invoice.installmentinvoiceprofiles_id]
              );
              
              // Get student name for installment invoice record
              const studentResult = await client.query(
                'SELECT full_name FROM userstbl WHERE user_id = $1',
                [student_id]
              );
              const studentName = studentResult.rows[0]?.full_name || 'Student';
              
              // Calculate dates for first installment invoice
              const firstGenerationDate = profile.first_generation_date 
                ? new Date(profile.first_generation_date)
                : new Date();
              const nextInvoiceDueDate = profile.next_invoice_due_date
                ? new Date(profile.next_invoice_due_date)
                : new Date();
              
              // Create the first installment invoice record (needed before generating invoice)
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
                  'Pending', // Will be updated to 'Generated' after invoice is created
                  studentName,
                  profile.amount, // Installment amount (monthly amount)
                  profile.amount, // Assuming no tax for now
                  profile.frequency || '1 month(s)',
                  formatYmdLocal(firstGenerationDate),
                  formatYmdLocal(nextInvoiceDueDate),
                ]
              );
              
              const firstInvoiceRecord = firstInvoiceRecordResult.rows[0];
              
              console.log(`✅ Downpayment paid: Created first installment invoice record for profile ${invoice.installmentinvoiceprofiles_id}`);
              
              // Store invoice generation data to process after transaction commits
              // This avoids transaction conflicts
              const invoiceGenData = {
                firstInvoiceRecord,
                profile: {
                  student_id: profile.student_id,
                  branch_id: profile.branch_id || invoice.branch_id || null,
                  package_id: profile.package_id || invoice.package_id || null,
                  amount: profile.amount,
                  frequency: profile.frequency || '1 month(s)',
                  description: profile.description || 'Monthly Installment Payment',
                },
                profileId: invoice.installmentinvoiceprofiles_id
              };
              
              // NOTE: Student is NOT enrolled yet when downpayment is paid
              // Student will appear in enroll modal (via invoice link) but won't be counted as enrolled
              // Student will be enrolled in Phase 1 when the first installment invoice (Phase 1) is paid
              
              // Skip the rest of the installment payment logic since this is just the downpayment
              // The actual installment invoices will be handled separately
              
              // Generate invoice after transaction commits (to avoid conflicts)
              // This will be done in a separate async operation after COMMIT
              if (invoiceGenData) {
                // Store for processing after commit
                req._pendingInvoiceGeneration = invoiceGenData;
              }
            } else {
              // This is a regular installment invoice payment (not downpayment)
              // Continue with existing logic
              
              // Only proceed if we have class_id and student_id matches
              if (profile.class_id && profile.student_id === student_id) {
              // Get all enrollments for this student in this class to find the highest phase
              const enrollmentResult = await client.query(
                `SELECT classstudent_id, phase_number 
                 FROM classstudentstbl 
                 WHERE student_id = $1 AND class_id = $2
                 ORDER BY phase_number DESC
                 LIMIT 1`,
                [student_id, profile.class_id]
              );

              // Get total phases from curriculum
              const classResult = await client.query(
                `SELECT cu.number_of_phase
                 FROM classestbl c
                 LEFT JOIN programstbl p ON c.program_id = p.program_id
                 LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
                 WHERE c.class_id = $1`,
                [profile.class_id]
              );

              const totalPhases = classResult.rows[0]?.number_of_phase || profile.total_phases;
              
              // Check if student has any enrollment in this class
              const hasEnrollment = enrollmentResult.rows.length > 0;
              
              if (!hasEnrollment) {
                // First invoice payment: Enroll student in Phase 1
                await client.query(
                  `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number)
                   VALUES ($1, $2, $3, $4)`,
                  [
                    student_id,
                    profile.class_id,
                    'System (Auto-enrolled via first installment payment)',
                    1
                  ]
                );
                
                console.log(`✅ First installment payment: Auto-enrolled student ${student_id} in Phase 1 after paying first invoice`);
              } else {
                // Subsequent invoice payment: Progress to next phase
                const highestPhase = enrollmentResult.rows[0].phase_number || 1;
                
                // Calculate next phase (highest phase + 1)
                // But don't exceed total phases
                const nextPhase = totalPhases ? Math.min(highestPhase + 1, totalPhases) : highestPhase + 1;
                
                // Check if student already has an enrollment for this next phase
                const existingPhaseEnrollment = await client.query(
                  `SELECT classstudent_id 
                   FROM classstudentstbl 
                   WHERE student_id = $1 AND class_id = $2 AND phase_number = $3`,
                  [student_id, profile.class_id, nextPhase]
                );
                
                // Only create new enrollment if:
                // 1. Next phase is greater than highest phase
                // 2. Next phase doesn't exceed total phases
                // 3. Student doesn't already have an enrollment for this phase
                if (nextPhase > highestPhase && 
                    (!totalPhases || nextPhase <= totalPhases) &&
                    existingPhaseEnrollment.rows.length === 0) {
                  
                  // Create a new enrollment record for the next phase
                  // This allows student to be enrolled in multiple phases simultaneously
                  await client.query(
                    `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number)
                     VALUES ($1, $2, $3, $4)`,
                    [
                      student_id,
                      profile.class_id,
                      'System (Auto-enrolled via installment payment)',
                      nextPhase
                    ]
                  );
                  
                  console.log(`✅ Auto-enrolled student ${student_id} in Phase ${nextPhase} (keeping Phase ${highestPhase} enrollment) after installment payment`);
                }
              }
              }
            }
          }
        } catch (phaseError) {
          // Log error but don't fail payment processing
          console.error('Error processing installment payment:', phaseError);
        }
      }
      
      // Check if this is a full payment invoice (not installment, not reservation fee)
      // If yes, and invoice is now fully paid, enroll student in all phases
      // For Phase packages, only enroll in the specified phase range (PHASE_START/PHASE_END in remarks)
      if (newInvoiceStatus === 'Paid' && 
          !invoice.installmentinvoiceprofiles_id && 
          invoice.invoice_description && 
          !invoice.invoice_description.includes('Reservation Fee')) {
        try {
          // Get class_id from invoice remarks field (stored as CLASS_ID:class_id)
          let classId = null;
          if (invoice.remarks && invoice.remarks.includes('CLASS_ID:')) {
            const match = invoice.remarks.match(/CLASS_ID:(\d+)/);
            if (match) {
              classId = parseInt(match[1]);
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
                  phaseStart = parseInt(startMatch[1]) || 1;
                }
              }
              if (invoice.remarks && invoice.remarks.includes('PHASE_END:')) {
                const endMatch = invoice.remarks.match(/PHASE_END:(\d+)/);
                if (endMatch) {
                  phaseEnd = parseInt(endMatch[1]) || phaseStart;
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
                // Enroll student in the applicable phase range
                for (let phase = phaseStart; phase <= phaseEnd; phase++) {
                  await client.query(
                    `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number)
                     VALUES ($1, $2, $3, $4)`,
                    [
                      student_id,
                      classId,
                      'System (Auto-enrolled via full payment)',
                      phase
                    ]
                  );
                }
                
                console.log(`✅ Full payment: Auto-enrolled student ${student_id} in all ${totalPhases} phases of class ${classId} after payment`);
              }
            }
          }
        } catch (fullPaymentError) {
          // Log error but don't fail payment processing
          console.error('Error auto-enrolling student for full payment:', fullPaymentError);
        }
      }

      await client.query('COMMIT');

      // Generate first installment invoice after transaction commits (if downpayment was paid)
      if (req._pendingInvoiceGeneration) {
        const { firstInvoiceRecord, profile, profileId } = req._pendingInvoiceGeneration;
        // Process asynchronously so it doesn't block the response
        (async () => {
          try {
            const { generateInvoiceFromInstallment } = await import('../utils/installmentInvoiceGenerator.js');
            
            // Generate the first installment invoice immediately (so it appears in invoice page)
            const generatedInvoice = await generateInvoiceFromInstallment(firstInvoiceRecord, profile);
            
            console.log(`✅ Downpayment paid: Generated first installment invoice ${generatedInvoice.invoice_id} for profile ${profileId}`);
          } catch (invoiceGenError) {
            // Log error but don't fail the payment - invoice generation can be retried
            console.error(`⚠️ Error generating first installment invoice for profile ${profileId}:`, invoiceGenError);
            // The installment invoice record is already created, so it can be generated later by the cron job
          }
        })();
        delete req._pendingInvoiceGeneration;
      }

      // Fetch the complete payment with related data
      const paymentWithDetails = await query(
        `SELECT p.payment_id, p.invoice_id, p.student_id, p.branch_id, 
                p.payment_method, p.payment_type, p.payable_amount, 
                TO_CHAR(p.issue_date, 'YYYY-MM-DD') as issue_date, 
                p.status, p.reference_number, p.remarks, p.created_by,
                TO_CHAR(p.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
                u.full_name as student_name, u.email as student_email,
                i.invoice_description, i.amount as invoice_amount,
                b.branch_name
         FROM paymenttbl p
         LEFT JOIN userstbl u ON p.student_id = u.user_id
         LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
         LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
         WHERE p.payment_id = $1`,
        [newPayment.payment_id]
      );

      const paymentData = paymentWithDetails.rows[0];

      // Send invoice email to student (non-blocking - don't fail payment if email fails)
      if (paymentData.student_email) {
        // Send email asynchronously without blocking the response
        (async () => {
          try {
            // Generate PDF buffer
            const pdfBuffer = await generateInvoicePDFBuffer(invoice_id);
            
            // Send email with PDF attachment
            await sendInvoiceEmail({
              to: paymentData.student_email,
              studentName: paymentData.student_name || 'Student',
              invoiceId: invoice_id,
              invoiceNumber: `INV-${invoice_id}`,
              pdfBuffer: pdfBuffer,
            });
            
            console.log(`✅ Invoice email sent successfully to ${paymentData.student_email} for invoice ${invoice_id}`);
          } catch (emailError) {
            // Log error but don't fail the payment
            console.error(`❌ Error sending invoice email to ${paymentData.student_email}:`, emailError.message);
            // Payment still succeeds even if email fails
          }
        })();
      } else {
        console.warn(`⚠️ No email address found for student ${student_id}, skipping email notification`);
      }

      res.status(201).json({
        success: true,
        message: 'Payment created successfully',
        data: paymentData,
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
 * PUT /api/sms/payments/:id
 * Update payment
 * Access: Superadmin, Admin
 */
router.put(
  '/:id',
  [
    param('id').isInt().withMessage('Payment ID must be an integer'),
    body('payment_method').optional().isString().withMessage('Payment method must be a string'),
    body('payment_type').optional().isString().withMessage('Payment type must be a string'),
    body('payable_amount').optional().isFloat({ min: 0.01 }).withMessage('Payable amount must be greater than 0'),
    body('issue_date').optional().isISO8601().withMessage('Issue date must be a valid date'),
    body('status').optional().isString().withMessage('Status must be a string'),
    body('reference_number').optional().isString().withMessage('Reference number must be a string'),
    body('remarks').optional().isString().withMessage('Remarks must be a string'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const { payment_method, payment_type, payable_amount, issue_date, status, reference_number, remarks } = req.body;

      // Check if payment exists
      const existingPayment = await client.query('SELECT * FROM paymenttbl WHERE payment_id = $1', [id]);
      if (existingPayment.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Payment not found',
        });
      }

      const payment = existingPayment.rows[0];

      // Check branch access
      if (req.user.userType !== 'Superadmin' && req.user.branchId && payment.branch_id !== req.user.branchId) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          success: false,
          message: 'Access denied',
        });
      }

      // Build update query
      const updates = [];
      const params = [];
      let paramCount = 0;

      const fields = { payment_method, payment_type, payable_amount, issue_date, status, reference_number, remarks };
      Object.entries(fields).forEach(([key, value]) => {
        if (value !== undefined) {
          paramCount++;
          updates.push(`${key} = $${paramCount}`);
          params.push(value);
        }
      });

      if (updates.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'No fields to update',
        });
      }

      paramCount++;
      params.push(id);

      const updateSql = `UPDATE paymenttbl SET ${updates.join(', ')} WHERE payment_id = $${paramCount}`;
      await client.query(updateSql, params);

      // If amount or status changed, recalculate invoice amount and status
      if (payable_amount !== undefined || status !== undefined) {
        const invoiceResult = await client.query(
          'SELECT *, installmentinvoiceprofiles_id FROM invoicestbl WHERE invoice_id = $1', 
          [payment.invoice_id]
        );
        if (invoiceResult.rows.length > 0) {
          const invoice = invoiceResult.rows[0];
          
          // Calculate original invoice amount from invoice items
          const invoiceItemsResult = await client.query(
            `SELECT 
              COALESCE(SUM(amount), 0) as item_amount,
              COALESCE(SUM(discount_amount), 0) as total_discount,
              COALESCE(SUM(penalty_amount), 0) as total_penalty,
              COALESCE(SUM(amount * COALESCE(tax_percentage, 0) / 100), 0) as total_tax
             FROM invoiceitemstbl 
             WHERE invoice_id = $1`,
            [payment.invoice_id]
          );
          
          const itemAmount = parseFloat(invoiceItemsResult.rows[0].item_amount) || 0;
          const totalDiscount = parseFloat(invoiceItemsResult.rows[0].total_discount) || 0;
          const totalPenalty = parseFloat(invoiceItemsResult.rows[0].total_penalty) || 0;
          const totalTax = parseFloat(invoiceItemsResult.rows[0].total_tax) || 0;
          
          // Original invoice amount = items - discounts + penalties + tax
          const originalInvoiceAmount = itemAmount - totalDiscount + totalPenalty + totalTax;
          
          const totalPaymentsResult = await client.query(
            'SELECT COALESCE(SUM(payable_amount), 0) as total_paid FROM paymenttbl WHERE invoice_id = $1 AND status = $2',
            [payment.invoice_id, 'Completed']
          );
          const totalPaid = parseFloat(totalPaymentsResult.rows[0].total_paid) || 0;
          
          // Calculate remaining balance (original amount - total paid)
          const remainingBalance = Math.max(0, originalInvoiceAmount - totalPaid);
          
          // Update invoice amount to reflect remaining balance
          await client.query('UPDATE invoicestbl SET amount = $1 WHERE invoice_id = $2', [
            remainingBalance,
            payment.invoice_id,
          ]);

          let newInvoiceStatus = invoice.status;
          if (totalPaid >= originalInvoiceAmount) {
            newInvoiceStatus = 'Paid';
          } else if (totalPaid > 0) {
            newInvoiceStatus = 'Partially Paid';
          } else {
            newInvoiceStatus = 'Unpaid';
          }

          if (newInvoiceStatus !== invoice.status) {
            await client.query('UPDATE invoicestbl SET status = $1 WHERE invoice_id = $2', [
              newInvoiceStatus,
              payment.invoice_id,
            ]);
          }

          // Check if this invoice is linked to a reservation
          // If yes, and invoice is now fully paid, update reservation status to "Fee Paid" and auto-enroll student
          if (newInvoiceStatus === 'Paid') {
            const reservationCheck = await client.query(
              `SELECT r.reserved_id, r.status, r.student_id, r.class_id, r.phase_number, r.branch_id
               FROM reservedstudentstbl r
               WHERE r.invoice_id = $1`,
              [payment.invoice_id]
            );
            
            if (reservationCheck.rows.length > 0) {
              const reservation = reservationCheck.rows[0];
              // Only update if reservation is still in "Reserved" status
              if (reservation.status === 'Reserved') {
                await client.query(
                  `UPDATE reservedstudentstbl 
                   SET status = 'Fee Paid', reservation_fee_paid_at = CURRENT_TIMESTAMP
                   WHERE reserved_id = $1`,
                  [reservation.reserved_id]
                );
                console.log(`✅ Reservation ${reservation.reserved_id} status updated to "Fee Paid" after payment update`);
                // Note: Student is NOT auto-enrolled here. Enrollment only happens when reservation is upgraded.
              }
            }
          }
          
          // Check if invoice becomes unpaid and is a package price invoice
          // If yes, remove student enrollment
          if (newInvoiceStatus === 'Unpaid' && 
              !invoice.installmentinvoiceprofiles_id && 
              invoice.invoice_description && 
              !invoice.invoice_description.includes('Reservation Fee')) {
            try {
              // Get student from invoice
              const invoiceStudentResult = await client.query(
                `SELECT ist.student_id 
                 FROM invoicestudentstbl ist
                 WHERE ist.invoice_id = $1
                 LIMIT 1`,
                [payment.invoice_id]
              );
              
              if (invoiceStudentResult.rows.length > 0) {
                const invoiceStudentId = invoiceStudentResult.rows[0].student_id;
                
                // Find enrollments for this student that were created around the same time as the invoice
                const enrollmentResult = await client.query(
                  `SELECT cs.classstudent_id, cs.class_id, cs.phase_number, cs.student_id, cs.enrolled_at
                   FROM classstudentstbl cs
                   WHERE cs.student_id = $1
                     AND cs.enrolled_at >= $2::date - INTERVAL '24 hours'
                     AND cs.enrolled_at <= $2::date + INTERVAL '24 hours'
                   ORDER BY cs.enrolled_at DESC`,
                  [invoiceStudentId, invoice.issue_date]
                );
                
                // Remove all enrollments that were created around the same time as the invoice
                for (const enrollment of enrollmentResult.rows) {
                  await client.query(
                    `DELETE FROM classstudentstbl WHERE classstudent_id = $1`,
                    [enrollment.classstudent_id]
                  );
                  console.log(`⚠️ Student ${enrollment.student_id} removed from class ${enrollment.class_id}, phase ${enrollment.phase_number} due to unpaid package price invoice`);
                }
              }
            } catch (removalError) {
              console.error('Error removing student enrollment due to unpaid invoice:', removalError);
              // Don't fail the payment update if removal fails
            }
          }

          // Check if this is a full payment invoice (not installment, not reservation fee)
          // If yes, and invoice is now fully paid, enroll student in all phases
          // For Phase packages, only enroll in the specified phase range (PHASE_START/PHASE_END in remarks)
          if (newInvoiceStatus === 'Paid' && 
              !invoice.installmentinvoiceprofiles_id && 
              invoice.invoice_description && 
              !invoice.invoice_description.includes('Reservation Fee')) {
            try {
              // Get class_id from invoice remarks field (stored as CLASS_ID:class_id)
              let classId = null;
              if (invoice.remarks && invoice.remarks.includes('CLASS_ID:')) {
                const match = invoice.remarks.match(/CLASS_ID:(\d+)/);
                if (match) {
                  classId = parseInt(match[1]);
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
                      phaseStart = parseInt(startMatch[1]) || 1;
                    }
                  }
                  if (invoice.remarks && invoice.remarks.includes('PHASE_END:')) {
                    const endMatch = invoice.remarks.match(/PHASE_END:(\d+)/);
                    if (endMatch) {
                      phaseEnd = parseInt(endMatch[1]) || phaseStart;
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
                    [payment.student_id, classId]
                  );
                  
                  // If student is not enrolled, enroll in the applicable phases for full payment
                  if (existingEnrollmentCheck.rows.length === 0) {
                    // Enroll student in the applicable phase range
                    for (let phase = phaseStart; phase <= phaseEnd; phase++) {
                      await client.query(
                        `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number)
                         VALUES ($1, $2, $3, $4)`,
                        [
                          payment.student_id,
                          classId,
                          'System (Auto-enrolled via full payment)',
                          phase
                        ]
                      );
                    }
                    
                    console.log(`✅ Full payment: Auto-enrolled student ${payment.student_id} in all ${totalPhases} phases of class ${classId} after payment update`);
                  }
                }
              }
            } catch (fullPaymentError) {
              // Log error but don't fail payment update
              console.error('Error auto-enrolling student for full payment:', fullPaymentError);
            }
          }
          
          // Check if this invoice is from an installment invoice profile and is now fully paid
          // If yes, check if it's a downpayment invoice or regular installment invoice
          if (newInvoiceStatus === 'Paid' && invoice.installmentinvoiceprofiles_id) {
            try {
              // Get installment invoice profile to check if this is a downpayment invoice
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
                
                // Check if this is the downpayment invoice and it hasn't been paid yet
                if (profile.downpayment_invoice_id === payment.invoice_id && !profile.downpayment_paid) {
                  // Mark downpayment as paid
                  await client.query(
                    `UPDATE installmentinvoiceprofilestbl 
                     SET downpayment_paid = true 
                     WHERE installmentinvoiceprofiles_id = $1`,
                    [invoice.installmentinvoiceprofiles_id]
                  );
                  
                  // Get student name for installment invoice record
                  const studentResult = await client.query(
                    'SELECT full_name FROM userstbl WHERE user_id = $1',
                    [payment.student_id]
                  );
                  const studentName = studentResult.rows[0]?.full_name || 'Student';
                  
                  // Calculate dates for first installment invoice
                  const firstGenerationDate = profile.first_generation_date 
                    ? new Date(profile.first_generation_date)
                    : new Date();
                  const nextInvoiceDueDate = profile.next_invoice_due_date
                    ? new Date(profile.next_invoice_due_date)
                    : new Date();
                  
                  // Create the first installment invoice record (needed before generating invoice)
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
                      'Pending', // Will be updated to 'Generated' after invoice is created
                      studentName,
                      profile.amount, // Installment amount (monthly amount)
                      profile.amount, // Assuming no tax for now
                      profile.frequency || '1 month(s)',
                      formatYmdLocal(firstGenerationDate),
                      formatYmdLocal(nextInvoiceDueDate),
                    ]
                  );
                  
                  const firstInvoiceRecord = firstInvoiceRecordResult.rows[0];
                  
                  console.log(`✅ Downpayment paid (via update): Created first installment invoice record for profile ${invoice.installmentinvoiceprofiles_id}`);
                  
                  // Store invoice generation data to process after transaction commits
                  // This avoids transaction conflicts
                  const invoiceGenData = {
                    firstInvoiceRecord,
                    profile: {
                      student_id: profile.student_id,
                      branch_id: profile.branch_id || invoice.branch_id || null,
                      package_id: profile.package_id || invoice.package_id || null,
                      amount: profile.amount,
                      frequency: profile.frequency || '1 month(s)',
                      description: profile.description || 'Monthly Installment Payment',
                    },
                    profileId: invoice.installmentinvoiceprofiles_id
                  };
                  
                  // NOTE: Student is NOT enrolled yet when downpayment is paid
                  // Student will appear in enroll modal (via invoice link) but won't be counted as enrolled
                  // Student will be enrolled in Phase 1 when the first installment invoice (Phase 1) is paid
                  
                  // Skip the rest of the installment payment logic since this is just the downpayment
                  // The actual installment invoices will be handled separately
                  
                  // Generate invoice after transaction commits (to avoid conflicts)
                  // This will be done in a separate async operation after COMMIT
                  if (invoiceGenData) {
                    // Store for processing after commit
                    req._pendingInvoiceGeneration = invoiceGenData;
                  }
                } else {
                  // This is a regular installment invoice payment (not downpayment)
                  // Continue with existing logic
                  
                  // Only proceed if we have class_id and student_id matches
                  if (profile.class_id && profile.student_id === payment.student_id) {
                  // Get all enrollments for this student in this class to find the highest phase
                  const enrollmentResult = await client.query(
                    `SELECT classstudent_id, phase_number 
                     FROM classstudentstbl 
                     WHERE student_id = $1 AND class_id = $2
                     ORDER BY phase_number DESC
                     LIMIT 1`,
                    [payment.student_id, profile.class_id]
                  );

                  // Get total phases from curriculum
                  const classResult = await client.query(
                    `SELECT cu.number_of_phase
                     FROM classestbl c
                     LEFT JOIN programstbl p ON c.program_id = p.program_id
                     LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
                     WHERE c.class_id = $1`,
                    [profile.class_id]
                  );

                  const totalPhases = classResult.rows[0]?.number_of_phase || profile.total_phases;
                  
                  // Determine the highest current phase (or default to 1 if no enrollment found)
                  const highestPhase = enrollmentResult.rows.length > 0 
                    ? (enrollmentResult.rows[0].phase_number || 1)
                    : 1;
                  
                  // Calculate next phase (highest phase + 1)
                  // But don't exceed total phases
                  const nextPhase = totalPhases ? Math.min(highestPhase + 1, totalPhases) : highestPhase + 1;
                  
                  // Check if student already has an enrollment for this next phase
                  const existingPhaseEnrollment = await client.query(
                    `SELECT classstudent_id 
                     FROM classstudentstbl 
                     WHERE student_id = $1 AND class_id = $2 AND phase_number = $3`,
                    [payment.student_id, profile.class_id, nextPhase]
                  );
                  
                  // Only create new enrollment if:
                  // 1. Next phase is greater than highest phase
                  // 2. Next phase doesn't exceed total phases
                  // 3. Student doesn't already have an enrollment for this phase
                  if (nextPhase > highestPhase && 
                      (!totalPhases || nextPhase <= totalPhases) &&
                      existingPhaseEnrollment.rows.length === 0) {
                    
                    // Create a new enrollment record for the next phase
                    // This allows student to be enrolled in multiple phases simultaneously
                    await client.query(
                      `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number)
                       VALUES ($1, $2, $3, $4)`,
                      [
                        payment.student_id,
                        profile.class_id,
                        'System (Auto-enrolled via installment payment)',
                        nextPhase
                      ]
                    );
                    
                    console.log(`✅ Auto-enrolled student ${payment.student_id} in Phase ${nextPhase} (keeping Phase ${highestPhase} enrollment) after installment payment update`);
                  }
                }
                }
              }
            } catch (phaseError) {
              // Log error but don't fail payment update
              console.error('Error processing installment payment:', phaseError);
            }
          }
        }
      }

      await client.query('COMMIT');

      // Generate first installment invoice after transaction commits (if downpayment was paid)
      if (req._pendingInvoiceGeneration) {
        const { firstInvoiceRecord, profile, profileId } = req._pendingInvoiceGeneration;
        // Process asynchronously so it doesn't block the response
        (async () => {
          try {
            const { generateInvoiceFromInstallment } = await import('../utils/installmentInvoiceGenerator.js');
            
            // Generate the first installment invoice immediately (so it appears in invoice page)
            const generatedInvoice = await generateInvoiceFromInstallment(firstInvoiceRecord, profile);
            
            console.log(`✅ Downpayment paid (via update): Generated first installment invoice ${generatedInvoice.invoice_id} for profile ${profileId}`);
          } catch (invoiceGenError) {
            // Log error but don't fail the payment - invoice generation can be retried
            console.error(`⚠️ Error generating first installment invoice for profile ${profileId}:`, invoiceGenError);
            // The installment invoice record is already created, so it can be generated later by the cron job
          }
        })();
        delete req._pendingInvoiceGeneration;
      }

      // Fetch updated payment
      const updatedPayment = await query(
        `SELECT p.payment_id, p.invoice_id, p.student_id, p.branch_id, 
                p.payment_method, p.payment_type, p.payable_amount, 
                TO_CHAR(p.issue_date, 'YYYY-MM-DD') as issue_date, 
                p.status, p.reference_number, p.remarks, p.created_by,
                TO_CHAR(p.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
                u.full_name as student_name, u.email as student_email,
                i.invoice_description, i.amount as invoice_amount,
                b.branch_name
         FROM paymenttbl p
         LEFT JOIN userstbl u ON p.student_id = u.user_id
         LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
         LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
         WHERE p.payment_id = $1`,
        [id]
      );

      res.json({
        success: true,
        message: 'Payment updated successfully',
        data: updatedPayment.rows[0],
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
 * DELETE /api/sms/payments/:id
 * Delete payment
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('Payment ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;

      // Check if payment exists
      const existingPayment = await client.query('SELECT * FROM paymenttbl WHERE payment_id = $1', [id]);
      if (existingPayment.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Payment not found',
        });
      }

      const payment = existingPayment.rows[0];

      // Check branch access
      if (req.user.userType !== 'Superadmin' && req.user.branchId && payment.branch_id !== req.user.branchId) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          success: false,
          message: 'Access denied',
        });
      }

      // Delete payment
      await client.query('DELETE FROM paymenttbl WHERE payment_id = $1', [id]);

      // Recalculate invoice amount and status (include installmentinvoiceprofiles_id for phase tracking)
      const invoiceResult = await client.query(
        'SELECT *, installmentinvoiceprofiles_id FROM invoicestbl WHERE invoice_id = $1', 
        [payment.invoice_id]
      );
      if (invoiceResult.rows.length > 0) {
        const invoice = invoiceResult.rows[0];
        
        // Calculate original invoice amount from invoice items
        const invoiceItemsResult = await client.query(
          `SELECT 
            COALESCE(SUM(amount), 0) as item_amount,
            COALESCE(SUM(discount_amount), 0) as total_discount,
            COALESCE(SUM(penalty_amount), 0) as total_penalty,
            COALESCE(SUM(amount * COALESCE(tax_percentage, 0) / 100), 0) as total_tax
           FROM invoiceitemstbl 
           WHERE invoice_id = $1`,
          [payment.invoice_id]
        );
        
        const itemAmount = parseFloat(invoiceItemsResult.rows[0].item_amount) || 0;
        const totalDiscount = parseFloat(invoiceItemsResult.rows[0].total_discount) || 0;
        const totalPenalty = parseFloat(invoiceItemsResult.rows[0].total_penalty) || 0;
        const totalTax = parseFloat(invoiceItemsResult.rows[0].total_tax) || 0;
        
        // Original invoice amount = items - discounts + penalties + tax
        const originalInvoiceAmount = itemAmount - totalDiscount + totalPenalty + totalTax;
        
        const totalPaymentsResult = await client.query(
          'SELECT COALESCE(SUM(payable_amount), 0) as total_paid FROM paymenttbl WHERE invoice_id = $1 AND status = $2',
          [payment.invoice_id, 'Completed']
        );
        const totalPaid = parseFloat(totalPaymentsResult.rows[0].total_paid) || 0;
        
        // Calculate remaining balance (original amount - total paid)
        const remainingBalance = Math.max(0, originalInvoiceAmount - totalPaid);
        
        // Update invoice amount to reflect remaining balance
        await client.query('UPDATE invoicestbl SET amount = $1 WHERE invoice_id = $2', [
          remainingBalance,
          payment.invoice_id,
        ]);

        let newInvoiceStatus = 'Unpaid';
        if (totalPaid >= originalInvoiceAmount) {
          newInvoiceStatus = 'Paid';
        } else if (totalPaid > 0) {
          newInvoiceStatus = 'Partially Paid';
        }

        await client.query('UPDATE invoicestbl SET status = $1 WHERE invoice_id = $2', [
          newInvoiceStatus,
          payment.invoice_id,
        ]);
        
        // Check if this was a downpayment invoice that became unpaid
        if (newInvoiceStatus === 'Unpaid' && invoice.installmentinvoiceprofiles_id) {
          try {
            const profileResult = await client.query(
              `SELECT downpayment_invoice_id, downpayment_paid 
               FROM installmentinvoiceprofilestbl 
               WHERE installmentinvoiceprofiles_id = $1 AND downpayment_invoice_id = $2`,
              [invoice.installmentinvoiceprofiles_id, payment.invoice_id]
            );
            
            if (profileResult.rows.length > 0 && profileResult.rows[0].downpayment_paid) {
              // Downpayment was paid but payment was deleted - revert downpayment status
              await client.query(
                `UPDATE installmentinvoiceprofilestbl 
                 SET downpayment_paid = false 
                 WHERE installmentinvoiceprofiles_id = $1`,
                [invoice.installmentinvoiceprofiles_id]
              );
              
              // Delete the first installment invoice record if it exists
              await client.query(
                `DELETE FROM installmentinvoicestbl 
                 WHERE installmentinvoiceprofiles_id = $1 
                 AND status = 'Pending'
                 ORDER BY scheduled_date ASC
                 LIMIT 1`,
                [invoice.installmentinvoiceprofiles_id]
              );
              
              console.log(`⚠️ Downpayment payment deleted: Reverted downpayment status and removed first installment invoice record`);
            }
          } catch (downpaymentError) {
            console.error('Error handling downpayment payment deletion:', downpaymentError);
          }
        }
        
        // Check if invoice becomes unpaid
        if (newInvoiceStatus === 'Unpaid') {
          // Check if this is a reservation fee invoice
          const isReservationFee = invoice.invoice_description && 
            invoice.invoice_description.includes('Reservation Fee');
          
          if (isReservationFee) {
            // Handle reservation fee invoice becoming unpaid
            try {
              const reservationResult = await client.query(
                `SELECT r.reserved_id, r.status, r.student_id, r.class_id, r.phase_number, r.due_date
                 FROM reservedstudentstbl r
                 WHERE r.invoice_id = $1`,
                [payment.invoice_id]
              );
              
              if (reservationResult.rows.length > 0) {
                const reservation = reservationResult.rows[0];
                
                // If reservation was upgraded, unenroll the student
                if (reservation.status === 'Upgraded') {
                  const enrollmentResult = await client.query(
                    `SELECT cs.classstudent_id 
                     FROM classstudentstbl cs
                     WHERE cs.student_id = $1 
                       AND cs.class_id = $2
                       ${reservation.phase_number ? `AND cs.phase_number = $3` : ''}`,
                    reservation.phase_number 
                      ? [reservation.student_id, reservation.class_id, reservation.phase_number]
                      : [reservation.student_id, reservation.class_id]
                  );
                  
                  // Unenroll student
                  for (const enrollment of enrollmentResult.rows) {
                    await client.query(
                      'DELETE FROM classstudentstbl WHERE classstudent_id = $1',
                      [enrollment.classstudent_id]
                    );
                    console.log(`⚠️ Student ${reservation.student_id} unenrolled from class ${reservation.class_id} due to reservation fee payment deletion`);
                  }
                }
                
                // Update reservation status based on due date
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const dueDate = reservation.due_date ? new Date(reservation.due_date) : null;
                
                if (dueDate && dueDate < today) {
                  // Past due date - expire reservation
                  await client.query(
                    `UPDATE reservedstudentstbl 
                     SET status = 'Expired', expired_at = CURRENT_TIMESTAMP
                     WHERE reserved_id = $1`,
                    [reservation.reserved_id]
                  );
                  console.log(`✅ Reservation ${reservation.reserved_id} expired due to unpaid reservation fee (past due date)`);
                } else {
                  // Not past due date yet - revert to 'Reserved'
                  await client.query(
                    `UPDATE reservedstudentstbl 
                     SET status = 'Reserved', reservation_fee_paid_at = NULL
                     WHERE reserved_id = $1`,
                    [reservation.reserved_id]
                  );
                  console.log(`✅ Reservation ${reservation.reserved_id} status reverted to 'Reserved' due to reservation fee payment deletion`);
                }
              }
            } catch (reservationError) {
              console.error('Error handling reservation fee invoice payment deletion:', reservationError);
              // Don't fail the payment deletion if reservation handling fails
            }
          } else if (!invoice.installmentinvoiceprofiles_id) {
            // Handle package price invoice becoming unpaid - remove student enrollment
            try {
              // Get student from invoice
              const invoiceStudentResult = await client.query(
                `SELECT ist.student_id 
                 FROM invoicestudentstbl ist
                 WHERE ist.invoice_id = $1
                 LIMIT 1`,
                [payment.invoice_id]
              );
              
              if (invoiceStudentResult.rows.length > 0) {
                const invoiceStudentId = invoiceStudentResult.rows[0].student_id;
                
                // Find enrollments for this student that were created around the same time as the invoice
                const enrollmentResult = await client.query(
                  `SELECT cs.classstudent_id, cs.class_id, cs.phase_number, cs.student_id, cs.enrolled_at
                   FROM classstudentstbl cs
                   WHERE cs.student_id = $1
                     AND cs.enrolled_at >= $2::timestamp - INTERVAL '1 hour'
                     AND cs.enrolled_at <= $2::timestamp + INTERVAL '1 hour'
                   ORDER BY cs.enrolled_at DESC`,
                  [invoiceStudentId, invoice.issue_date || invoice.created_at]
                );
                
                // Remove all enrollments that were created around the same time as the invoice
                for (const enrollment of enrollmentResult.rows) {
                  await client.query(
                    `DELETE FROM classstudentstbl WHERE classstudent_id = $1`,
                    [enrollment.classstudent_id]
                  );
                  console.log(`⚠️ Student ${enrollment.student_id} removed from class ${enrollment.class_id}, phase ${enrollment.phase_number} due to unpaid package price invoice (payment deleted)`);
                }
              }
            } catch (removalError) {
              console.error('Error removing student enrollment due to unpaid invoice:', removalError);
              // Don't fail the payment deletion if removal fails
            }
          }
        }
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Payment deleted successfully',
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
 * GET /api/sms/payments/student/:studentId
 * Get payment logs for a specific student
 * Access: Students (can only view their own payments)
 */
router.get(
  '/student/:studentId',
  [
    param('studentId').isInt().withMessage('Student ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Student'),
  async (req, res, next) => {
    try {
      const { studentId } = req.params;
      const studentUserId = req.user.userId || req.user.user_id;

      // Check access permission - students can only view their own payments
      if (parseInt(studentId) !== parseInt(studentUserId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view your own payment logs.',
        });
      }

      const result = await query(
        `SELECT p.payment_id, p.invoice_id, p.student_id, p.branch_id, 
                p.payment_method, p.payment_type, p.payable_amount, 
                TO_CHAR(p.issue_date, 'YYYY-MM-DD') as issue_date, 
                p.status, p.reference_number, p.remarks, p.created_by,
                TO_CHAR(p.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
                u.full_name as student_name, u.email as student_email,
                i.invoice_description, i.amount as invoice_amount,
                b.branch_name
         FROM paymenttbl p
         LEFT JOIN userstbl u ON p.student_id = u.user_id
         LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
         LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
         WHERE p.student_id = $1
         ORDER BY p.payment_id DESC`,
        [studentId]
      );

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

