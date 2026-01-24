import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { getClient, query } from '../config/database.js';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';

const router = express.Router();

// All routes require authentication
router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

/**
 * GET /api/sms/reservations
 * Get all reservations with optional filters
 * Access: Superadmin, Admin
 */
router.get(
  '/',
  [
    queryValidator('class_id').optional().isInt().withMessage('Class ID must be an integer'),
    queryValidator('student_id').optional().isInt().withMessage('Student ID must be an integer'),
    queryValidator('status').optional().isIn(['Reserved', 'Fee Paid', 'Upgraded', 'Cancelled', 'Expired']).withMessage('Invalid status'),
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      // Auto-expire unpaid reservations that are past due date
      // Use separate client for transaction
      try {
        const expireClient = await getClient();
        try {
          await expireClient.query('BEGIN');
          
          const expiredReservations = await expireClient.query(
            `SELECT r.reserved_id, r.student_id, r.class_id, r.status, r.invoice_id, r.phase_number
             FROM reservedstudentstbl r
             WHERE r.status = 'Reserved'
               AND r.due_date IS NOT NULL
               AND r.due_date < CURRENT_DATE
               AND r.expired_at IS NULL
               AND (
                 (r.invoice_id IS NULL)
                 OR
                 (r.invoice_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM invoicestbl inv 
                   WHERE inv.invoice_id = r.invoice_id 
                   AND inv.status NOT IN ('Paid', 'Partially Paid')
                 ))
               )`,
            []
          );

          const expiredIds = [];
          for (const reservation of expiredReservations.rows) {
            const enrollmentCheck = await expireClient.query(
              `SELECT cs.classstudent_id 
               FROM classstudentstbl cs
               WHERE cs.student_id = $1 
                 AND cs.class_id = $2
                 ${reservation.phase_number ? `AND cs.phase_number = $3` : ''}`,
              reservation.phase_number 
                ? [reservation.student_id, reservation.class_id, reservation.phase_number]
                : [reservation.student_id, reservation.class_id]
            );

            if (enrollmentCheck.rows.length > 0) {
              for (const enrollment of enrollmentCheck.rows) {
                await expireClient.query(
                  'DELETE FROM classstudentstbl WHERE classstudent_id = $1',
                  [enrollment.classstudent_id]
                );
                console.log(`⚠️ Student ${reservation.student_id} unenrolled from class ${reservation.class_id} due to expired reservation ${reservation.reserved_id}`);
              }
            }

            expiredIds.push(reservation.reserved_id);
          }

          if (expiredIds.length > 0) {
            await expireClient.query(
              `UPDATE reservedstudentstbl 
               SET status = 'Expired', expired_at = CURRENT_TIMESTAMP
               WHERE reserved_id = ANY($1::int[])`,
              [expiredIds]
            );
            console.log(`✅ Auto-expired ${expiredIds.length} reservation(s) when fetching reservations`);
          }
          
          await expireClient.query('COMMIT');
        } catch (expireError) {
          await expireClient.query('ROLLBACK');
          console.error('Error auto-expiring reservations:', expireError);
        } finally {
          expireClient.release();
        }
      } catch (getClientError) {
        console.error('Error getting client for expiration check:', getClientError);
        // Continue with reservation fetching even if expiration check fails
      }

      const { class_id, student_id, status, branch_id } = req.query;

      let sql = `
        SELECT 
          r.*,
          u.full_name as student_name,
          u.email as student_email,
          c.class_name,
          c.level_tag,
          p.program_name,
          pkg.package_name,
          pkg.package_price,
          inv.invoice_id as reservation_invoice_id,
          inv.status as invoice_status,
          inv.amount as invoice_amount,
          TO_CHAR(inv.due_date, 'YYYY-MM-DD') as reservation_invoice_due_date,
          CASE 
            WHEN r.phase_number IS NULL THEN 'Entire Class'
            ELSE CONCAT('Phase ', r.phase_number)
          END as reservation_scope
        FROM reservedstudentstbl r
        LEFT JOIN userstbl u ON r.student_id = u.user_id
        LEFT JOIN classestbl c ON r.class_id = c.class_id
        LEFT JOIN programstbl p ON c.program_id = p.program_id
        LEFT JOIN packagestbl pkg ON r.package_id = pkg.package_id
        LEFT JOIN invoicestbl inv ON r.invoice_id = inv.invoice_id
        WHERE 1=1
      `;
      const params = [];
      let paramCount = 0;

      // Filter by branch (non-superadmin users are limited to their branch)
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        paramCount++;
        sql += ` AND r.branch_id = $${paramCount}`;
        params.push(req.user.branchId);
      } else if (branch_id) {
        paramCount++;
        sql += ` AND r.branch_id = $${paramCount}`;
        params.push(branch_id);
      }

      if (class_id) {
        paramCount++;
        sql += ` AND r.class_id = $${paramCount}`;
        params.push(class_id);
      }

      if (student_id) {
        paramCount++;
        sql += ` AND r.student_id = $${paramCount}`;
        params.push(student_id);
      }

      if (status) {
        paramCount++;
        sql += ` AND r.status = $${paramCount}`;
        params.push(status);
      }

      sql += ` ORDER BY r.reserved_at DESC`;

      const result = await query(sql, params);

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
 * GET /api/sms/reservations/:id
 * Get reservation by ID
 * Access: Superadmin, Admin
 */
router.get(
  '/:id',
  [
    param('id').isInt().withMessage('Reservation ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const result = await query(
        `SELECT 
          r.*,
          u.full_name as student_name,
          u.email as student_email,
          c.class_name,
          c.level_tag,
          p.program_name,
          pkg.package_name,
          pkg.package_price,
          inv.invoice_id as reservation_invoice_id,
          inv.status as invoice_status,
          inv.amount as invoice_amount,
          TO_CHAR(inv.due_date, 'YYYY-MM-DD') as reservation_invoice_due_date
         FROM reservedstudentstbl r
         LEFT JOIN userstbl u ON r.student_id = u.user_id
         LEFT JOIN classestbl c ON r.class_id = c.class_id
         LEFT JOIN programstbl p ON c.program_id = p.program_id
         LEFT JOIN packagestbl pkg ON r.package_id = pkg.package_id
         LEFT JOIN invoicestbl inv ON r.invoice_id = inv.invoice_id
         WHERE r.reserved_id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Reservation not found',
        });
      }

      res.json({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sms/reservations
 * Create a new reservation
 * Access: Superadmin, Admin
 */
router.post(
  '/',
  [
    body('student_id').isInt().withMessage('Student ID is required and must be an integer'),
    body('class_id').isInt().withMessage('Class ID is required and must be an integer'),
    body('package_id').optional().isInt().withMessage('Package ID must be an integer'),
    body('reservation_fee').optional().isFloat({ min: 0 }).withMessage('Reservation fee must be a positive number'),
    body('notes').optional().isString().withMessage('Notes must be a string'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { student_id, class_id, package_id, reservation_fee, notes, invoice_id } = req.body;

      // Get class and branch info
      const classResult = await client.query(
        `SELECT c.*, p.branch_id 
         FROM classestbl c
         LEFT JOIN programstbl p ON c.program_id = p.program_id
         WHERE c.class_id = $1`,
        [class_id]
      );

      if (classResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Class not found',
        });
      }

      const classData = classResult.rows[0];
      const branch_id = classData.branch_id;

      const { phase_number } = req.body; // NULL for entire class, specific number for per-phase

      // Check if student already has a reservation for this class/phase combination
      // For entire class reservation (phase_number is NULL), check if any reservation exists
      // For per-phase reservation, check if reservation exists for that specific phase
      let existingReservation;
      if (phase_number === null || phase_number === undefined) {
        // Entire class reservation - check if any reservation exists (including per-phase)
        existingReservation = await client.query(
          `SELECT reserved_id FROM reservedstudentstbl 
           WHERE student_id = $1 AND class_id = $2 AND status NOT IN ('Cancelled', 'Expired')`,
          [student_id, class_id]
        );
      } else {
        // Per-phase reservation - check if reservation exists for this specific phase
        existingReservation = await client.query(
          `SELECT reserved_id FROM reservedstudentstbl 
           WHERE student_id = $1 AND class_id = $2 AND phase_number = $3 AND status NOT IN ('Cancelled', 'Expired')`,
          [student_id, class_id, phase_number]
        );
      }

      if (existingReservation.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: phase_number 
            ? `Student already has an active reservation for Phase ${phase_number} in this class`
            : 'Student already has an active reservation for this class',
        });
      }

      // Get package info if provided
      let packageData = null;
      let finalReservationFee = reservation_fee;
      if (package_id) {
        const packageResult = await client.query(
          'SELECT * FROM packagestbl WHERE package_id = $1',
          [package_id]
        );
        if (packageResult.rows.length > 0) {
          packageData = packageResult.rows[0];
          // Use package price as reservation fee if not provided
          if (!finalReservationFee && packageData.package_price) {
            finalReservationFee = packageData.package_price;
          }
        }
      }

      // Calculate due date (default: 7 days from now, or use provided due_date)
      const { due_date } = req.body;
      let reservationDueDate = due_date;
      if (!reservationDueDate) {
        // Default: 7 days from now
        const defaultDueDate = new Date();
        defaultDueDate.setDate(defaultDueDate.getDate() + 7);
        reservationDueDate = defaultDueDate.toISOString().split('T')[0]; // Format as YYYY-MM-DD
      }

      // Create reservation
      const result = await client.query(
        `INSERT INTO reservedstudentstbl 
         (student_id, class_id, package_id, branch_id, reservation_fee, status, reserved_by, notes, invoice_id, phase_number, due_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          student_id,
          class_id,
          package_id || null,
          branch_id,
          finalReservationFee || null,
          'Reserved',
          req.user.fullName || req.user.email,
          notes || null,
          invoice_id || null,
          phase_number || null,
          reservationDueDate,
        ]
      );

      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        data: result.rows[0],
        message: 'Reservation created successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    }
  }
);

/**
 * PUT /api/sms/reservations/:id/upgrade
 * Upgrade a reservation to actual enrollment
 * Access: Superadmin, Admin
 */
router.put(
  '/:id/upgrade',
  [
    param('id').isInt().withMessage('Reservation ID must be an integer'),
    body('enrollment_type').isIn(['Fullpayment', 'Installment', 'Per-Phase']).withMessage('Enrollment type must be Fullpayment, Installment, or Per-Phase'),
    body('package_id').optional().isInt().withMessage('Package ID must be an integer'),
    body('selected_pricing_lists').optional().isArray().withMessage('Selected pricing lists must be an array'),
    body('per_phase_amount').optional().isFloat({ min: 0 }).withMessage('Per-phase amount must be a positive number'),
    body('phase_number').optional({ nullable: true, checkFalsy: true }).custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      return Number.isInteger(value) && value >= 1;
    }).withMessage('Phase number must be null or a positive integer'),
    body('installment_settings').optional().isObject().withMessage('Installment settings must be an object'),
    body('selected_merchandise').optional().isArray().withMessage('Selected merchandise must be an array'),
    body('promo_id').optional().isInt().withMessage('Promo ID must be an integer'),
    body('promo_code').optional().trim(),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const { enrollment_type, package_id, installment_settings, selected_merchandise = [], selected_pricing_lists = [], per_phase_amount, phase_number, promo_id, promo_code } = req.body;

      // Get reservation details
      const reservationResult = await client.query(
        `SELECT * FROM reservedstudentstbl WHERE reserved_id = $1`,
        [id]
      );

      if (reservationResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Reservation not found',
        });
      }

      const reservation = reservationResult.rows[0];

      // Allow upgrade for:
      // 1. 'Fee Paid' status (normal upgrade)
      // 2. 'Reserved' status (if fee was paid but status not updated)
      // 3. 'Expired' status (re-upgrade after expiration - need to check class availability)
      if (!['Fee Paid', 'Reserved', 'Expired'].includes(reservation.status)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Cannot upgrade reservation with status: ${reservation.status}.`,
        });
      }

      // Check if already upgraded
      if (reservation.status === 'Upgraded') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Reservation has already been upgraded',
        });
      }

      // For expired reservations, we need to check if class is still available
      // and if max_students hasn't been reached
      if (reservation.status === 'Expired') {
        // Check if class is still active
        if (classData.status !== 'Active') {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `Cannot re-upgrade expired reservation. Class is no longer active (status: ${classData.status}).`,
            class_full: false,
            class_inactive: true,
          });
        }
      }

      // Get class data with curriculum info
      const classResult = await client.query(
        `SELECT c.*, cu.number_of_phase, cu.number_of_session_per_phase, p.program_name, p.curriculum_id
         FROM classestbl c
         LEFT JOIN programstbl p ON c.program_id = p.program_id
         LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
         WHERE c.class_id = $1`,
        [reservation.class_id]
      );

      if (classResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Class not found',
        });
      }

      const classData = classResult.rows[0];
      const branch_id = classData.branch_id;

      // Get student data
      const studentCheck = await client.query(
        'SELECT user_id, full_name, user_type, level_tag, branch_id FROM userstbl WHERE user_id = $1',
        [reservation.student_id]
      );
      
      if (studentCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Student not found',
        });
      }

      // Check if student is already enrolled
      const existingEnrollment = await client.query(
        `SELECT classstudent_id FROM classstudentstbl 
         WHERE student_id = $1 AND class_id = $2`,
        [reservation.student_id, reservation.class_id]
      );

      if (existingEnrollment.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'Student is already enrolled in this class',
        });
      }

      // Check class capacity before upgrading
      // Note: This reservation already counted toward max_students, so when we convert it to enrollment,
      // the total count (enrolled + reserved) stays the same. But we should still verify capacity.
      if (classData.max_students) {
        const enrolledCount = await client.query(
          'SELECT COUNT(DISTINCT student_id) as count FROM classstudentstbl WHERE class_id = $1',
          [reservation.class_id]
        );
        const reservedCount = await client.query(
          `SELECT COUNT(DISTINCT student_id) as count FROM reservedstudentstbl 
           WHERE class_id = $1 AND status NOT IN ('Cancelled', 'Expired') AND reserved_id != $2`,
          [reservation.class_id, id] // Exclude current reservation since it's being converted
        );
        const currentEnrolled = parseInt(enrolledCount.rows[0].count) || 0;
        const currentReserved = parseInt(reservedCount.rows[0].count) || 0;
        const totalAfterUpgrade = currentEnrolled + currentReserved + 1; // +1 for this upgrade
        
        if (totalAfterUpgrade > classData.max_students) {
          await client.query('ROLLBACK');
          
          // For expired reservations, provide alternative classes
          let alternativeClasses = [];
          if (reservation.status === 'Expired') {
            try {
              const alternativesResult = await client.query(
                `SELECT DISTINCT c.class_id, c.class_name, c.level_tag, c.max_students,
                        p.program_name, b.branch_name,
                        COALESCE(enrolled_counts.enrolled_count, 0) as enrolled_students,
                        COALESCE(reserved_counts.reserved_count, 0) as reserved_students,
                        (COALESCE(enrolled_counts.enrolled_count, 0) + COALESCE(reserved_counts.reserved_count, 0)) as total_occupied,
                        (c.max_students - (COALESCE(enrolled_counts.enrolled_count, 0) + COALESCE(reserved_counts.reserved_count, 0))) as available_slots
                 FROM classestbl c
                 LEFT JOIN programstbl p ON c.program_id = p.program_id
                 LEFT JOIN branchestbl b ON c.branch_id = b.branch_id
                 LEFT JOIN (
                   SELECT class_id, COUNT(DISTINCT student_id) as enrolled_count
                   FROM classstudentstbl
                   GROUP BY class_id
                 ) enrolled_counts ON c.class_id = enrolled_counts.class_id
                 LEFT JOIN (
                   SELECT class_id, COUNT(DISTINCT student_id) as reserved_count
                   FROM reservedstudentstbl
                   WHERE status NOT IN ('Cancelled', 'Expired')
                   GROUP BY class_id
                 ) reserved_counts ON c.class_id = reserved_counts.class_id
                 WHERE c.status = 'Active'
                   AND c.class_id != $1
                   AND c.level_tag = $2
                   AND (c.max_students IS NULL OR 
                        (COALESCE(enrolled_counts.enrolled_count, 0) + COALESCE(reserved_counts.reserved_count, 0)) < c.max_students)
                 ORDER BY available_slots DESC, c.class_name
                 LIMIT 5`,
                [reservation.class_id, classData.level_tag]
              );
              alternativeClasses = alternativesResult.rows;
            } catch (altError) {
              console.error('Error fetching alternative classes:', altError);
              // Continue without alternatives
            }
          }
          
          return res.status(400).json({
            success: false,
            message: `Cannot upgrade reservation. Class is full. Currently ${currentEnrolled} enrolled and ${currentReserved} other reservations (${currentEnrolled + currentReserved}/${classData.max_students} slots taken).`,
            class_full: true,
            alternative_classes: alternativeClasses,
          });
        }
      }

      // Determine enrollment phase based on reservation
      // If reservation was for entire class (phase_number is NULL), enroll in Phase 1
      // If reservation was for specific phase, enroll in that phase
      let enrollmentPhase = 1;
      if (reservation.phase_number !== null && reservation.phase_number !== undefined) {
        enrollmentPhase = parseInt(reservation.phase_number);
      }

      // Get reservation fee invoice and calculate total paid amount
      let reservationFeePaid = 0;
      if (reservation.invoice_id) {
        const reservationInvoiceResult = await client.query(
          'SELECT invoice_id, invoice_description, amount FROM invoicestbl WHERE invoice_id = $1',
          [reservation.invoice_id]
        );
        
        if (reservationInvoiceResult.rows.length > 0) {
          const reservationInvoice = reservationInvoiceResult.rows[0];
          
          // Calculate total paid for reservation fee invoice
          const reservationPaymentsResult = await client.query(
            'SELECT COALESCE(SUM(payable_amount), 0) as total_paid FROM paymenttbl WHERE invoice_id = $1 AND status = $2',
            [reservation.invoice_id, 'Completed']
          );
          reservationFeePaid = parseFloat(reservationPaymentsResult.rows[0].total_paid) || 0;
          
          console.log(`💰 Reservation fee paid: ${reservationFeePaid} (will be deducted from package price)`);
        }
      }

      // Initialize variables for invoice and package processing
      let invoiceItems = [];
      let totalAmount = 0;
      let packageName = null;
      let hasFullpaymentPricing = false;
      let installmentPricingList = null;
      let hasInstallmentPricing = false;
      let installmentPricingPrice = null;
      // Optional phase range for Phase packages (used later in invoice remarks for enrollment)
      let phaseStartForRemarks = null;
      let phaseEndForRemarks = null;
      // Promo tracking variables (scope outside package processing)
      let promoDiscount = 0;
      let promoApplied = null;

      // Process per-phase enrollment if enrollment_type is 'Per-Phase'
      if (enrollment_type === 'Per-Phase') {
        // Add per-phase amount if provided
        if (per_phase_amount && !isNaN(parseFloat(per_phase_amount))) {
          const phaseAmount = parseFloat(per_phase_amount);
          const adjustedPhaseAmount = Math.max(0, phaseAmount - reservationFeePaid);
          
          invoiceItems.push({
            description: 'Per-Phase Enrollment Amount',
            amount: phaseAmount,
          });
          
          // Add discount line item if reservation fee was paid
          if (reservationFeePaid > 0) {
            invoiceItems.push({
              description: `Discount: Reservation Fee Paid`,
              amount: -reservationFeePaid, // Negative amount for discount
            });
            console.log(`✅ Deducted reservation fee ${reservationFeePaid} from per-phase amount ${phaseAmount}. New amount: ${adjustedPhaseAmount}`);
          }
          
          totalAmount += adjustedPhaseAmount;
        }
        
        // Get selected pricing lists
        if (selected_pricing_lists && selected_pricing_lists.length > 0) {
          const pricingListsResult = await client.query(
            `SELECT pricinglist_id, name, level_tag, price 
             FROM pricingliststbl 
             WHERE pricinglist_id = ANY($1::int[])`,
            [selected_pricing_lists]
          );

          pricingListsResult.rows.forEach((pricing) => {
            if (pricing.price && !isNaN(parseFloat(pricing.price))) {
              const price = parseFloat(pricing.price);
              invoiceItems.push({
                description: `Pricing: ${pricing.name || 'Pricing'}${pricing.level_tag ? ` (${pricing.level_tag})` : ''}`,
                amount: price,
              });
              totalAmount += price;
              
              // Check for installment or fullpayment pricing lists
              if (pricing.name && pricing.name.toLowerCase().includes('new enrollee installment')) {
                hasInstallmentPricing = true;
                installmentPricingPrice = price;
              }
              if (pricing.name && pricing.name.toLowerCase().includes('new enrollee fullpayment')) {
                hasFullpaymentPricing = true;
              }
            }
          });
        }
      }

      // Process package if provided
      if (package_id) {
        const packageResult = await client.query(
          `SELECT p.*, pd.pricinglist_id, pd.merchandise_id, pd.is_included,
                  pl.name as pricing_name, pl.level_tag as pricing_level_tag, pl.price as pricing_price
           FROM packagestbl p
           LEFT JOIN packagedetailstbl pd ON p.package_id = pd.package_id
           LEFT JOIN pricingliststbl pl ON pd.pricinglist_id = pl.pricinglist_id
           WHERE p.package_id = $1`,
          [package_id]
        );

        if (packageResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            success: false,
            message: 'Package not found',
          });
        }

        const packageData = packageResult.rows[0];
        packageName = packageData.package_name;

        // If this is a Phase package, capture its phase range for invoice remarks
        if (packageData.package_type === 'Phase') {
          const pkgPhaseStart = packageData.phase_start || 1;
          const pkgPhaseEnd = packageData.phase_end || pkgPhaseStart;
          phaseStartForRemarks = pkgPhaseStart;
          phaseEndForRemarks = pkgPhaseEnd;
        }

        // Check for fullpayment pricing
        const fullpaymentPricing = packageResult.rows.find(
          pkgDetail => pkgDetail.pricinglist_id && 
          pkgDetail.pricing_name && 
          pkgDetail.pricing_name.toLowerCase().includes('new enrollee fullpayment')
        );
        
        if (fullpaymentPricing) {
          hasFullpaymentPricing = true;
        }

        // Find installment pricing list
        installmentPricingList = packageResult.rows.find(
          pkgDetail => pkgDetail.pricinglist_id && 
          pkgDetail.pricing_name && 
          pkgDetail.pricing_name.toLowerCase().includes('new enrollee installment')
        );

        // Add package price to invoice
        if (packageData.package_price && !isNaN(parseFloat(packageData.package_price))) {
          const originalPackageAmount = parseFloat(packageData.package_price);
          let packageAmountAfterPromo = originalPackageAmount;
          // Reset promo variables for this package
          promoDiscount = 0;
          promoApplied = null;
          
          // Handle promo if provided (apply BEFORE reservation fee deduction)
          if (promo_id) {
            try {
              // Fetch promo details
              const promoResult = await client.query(
                `SELECT p.*, pkg.package_price
                 FROM promostbl p
                 LEFT JOIN packagestbl pkg ON p.package_id = pkg.package_id
                 WHERE p.promo_id = $1 AND p.status = 'Active'`,
                [promo_id]
              );

              if (promoResult.rows.length > 0) {
                const promo = promoResult.rows[0];
                
                // Validate promo code if promo requires one
                if (promo.promo_code) {
                  if (!promo_code || promo_code.trim().toUpperCase() !== promo.promo_code.toUpperCase()) {
                    console.warn(`Promo ${promo_id} requires promo code but invalid or missing code provided`);
                    // Don't apply promo if code doesn't match
                    throw new Error('Invalid or missing promo code');
                  }
                }
                
                // Fetch packages from junction table
                const promoPackagesResult = await client.query(
                  'SELECT package_id FROM promopackagestbl WHERE promo_id = $1',
                  [promo_id]
                );
                const promoPackageIds = promoPackagesResult.rows.map(r => r.package_id);
                
                // If no packages in junction table, fall back to old package_id for backward compatibility
                if (promoPackageIds.length === 0 && promo.package_id) {
                  promoPackageIds.push(promo.package_id);
                }
                
                promo.package_ids = promoPackageIds;
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const startDate = promo.start_date ? new Date(promo.start_date) : null;
                const endDate = promo.end_date ? new Date(promo.end_date) : null;
                
                // Validate promo is active and within date range
                const isDateValid = (!startDate || startDate <= today) && (!endDate || endDate >= today);
                const isUsageValid = !promo.max_uses || (promo.current_uses || 0) < promo.max_uses;
                
                // Check if student already used this promo
                const usageCheck = await client.query(
                  'SELECT promousage_id FROM promousagetbl WHERE promo_id = $1 AND student_id = $2',
                  [promo_id, reservation.student_id]
                );
                const hasAlreadyUsed = usageCheck.rows.length > 0;
                
                // Check student eligibility
                let isEligible = false;
                if (!hasAlreadyUsed) {
                  // Check if student is new or existing
                  const enrollmentCheck = await client.query(
                    'SELECT COUNT(*) as count FROM classstudentstbl WHERE student_id = $1',
                    [reservation.student_id]
                  );
                  const enrollmentCount = parseInt(enrollmentCheck.rows[0]?.count || 0);
                  const isNewStudent = enrollmentCount === 0;
                  const isExistingStudent = enrollmentCount > 0;
                  
                  // Check if student has referral
                  const referralCheck = await client.query(
                    'SELECT referral_id, status FROM referralstbl WHERE referred_student_id = $1',
                    [reservation.student_id]
                  );
                  const hasReferral = referralCheck.rows.length > 0 && referralCheck.rows[0].status === 'Verified';
                  
                  // Check eligibility type
                  switch (promo.eligibility_type) {
                    case 'all':
                      isEligible = true;
                      break;
                    case 'new_students_only':
                      isEligible = isNewStudent;
                      break;
                    case 'existing_students_only':
                      isEligible = isExistingStudent;
                      break;
                    case 'referral_only':
                      isEligible = hasReferral;
                      break;
                    default:
                      isEligible = true;
                  }
                }
                
                // Check minimum payment amount
                const meetsMinPayment = !promo.min_payment_amount || originalPackageAmount >= parseFloat(promo.min_payment_amount);
                
                // Check if package_id is in promo's package_ids array
                const packageMatches = promo.package_ids && promo.package_ids.includes(package_id);
                
                if (isDateValid && isUsageValid && packageMatches && !hasAlreadyUsed && isEligible && meetsMinPayment) {
                  // Calculate discount
                  if (promo.promo_type === 'percentage_discount' && promo.discount_percentage) {
                    promoDiscount = (originalPackageAmount * parseFloat(promo.discount_percentage)) / 100;
                  } else if (promo.promo_type === 'fixed_discount' && promo.discount_amount) {
                    promoDiscount = parseFloat(promo.discount_amount);
                  } else if (promo.promo_type === 'combined') {
                    // For combined, prioritize percentage discount if both are provided
                    if (promo.discount_percentage && parseFloat(promo.discount_percentage) > 0) {
                      promoDiscount = (originalPackageAmount * parseFloat(promo.discount_percentage)) / 100;
                    } else if (promo.discount_amount && parseFloat(promo.discount_amount) > 0) {
                      promoDiscount = parseFloat(promo.discount_amount);
                    }
                  }

                  // Apply promo discount to package amount
                  packageAmountAfterPromo = Math.max(0, originalPackageAmount - promoDiscount);

                  // Add free merchandise from promo
                  const promoMerchResult = await client.query(
                    `SELECT pm.*, m.merchandise_name, m.price
                     FROM promomerchandisetbl pm
                     LEFT JOIN merchandisestbl m ON pm.merchandise_id = m.merchandise_id
                     WHERE pm.promo_id = $1`,
                    [promo_id]
                  );

                  for (const promoMerch of promoMerchResult.rows) {
                    for (let i = 0; i < (promoMerch.quantity || 1); i++) {
                      invoiceItems.push({
                        description: `Free: ${promoMerch.merchandise_name} (Promo: ${promo.promo_name})`,
                        amount: 0,
                      });
                    }
                  }

                  promoApplied = promo;
                } else {
                  // Log why promo was not applied (for debugging)
                  const reasons = [];
                  if (!isDateValid) reasons.push('promo is not within valid date range');
                  if (!isUsageValid) reasons.push('promo has reached maximum uses');
                  const packageMatches = promo.package_ids && promo.package_ids.includes(package_id);
                  if (!packageMatches) reasons.push('promo does not match selected package');
                  if (hasAlreadyUsed) reasons.push('student has already used this promo');
                  if (!isEligible) {
                    const eligibilityReason = promo.eligibility_type === 'new_students_only' 
                      ? 'student is not a new student'
                      : promo.eligibility_type === 'existing_students_only'
                      ? 'student is not an existing student'
                      : promo.eligibility_type === 'referral_only'
                      ? 'student does not have a verified referral'
                      : 'student does not meet eligibility requirements';
                    reasons.push(eligibilityReason);
                  }
                  if (!meetsMinPayment) reasons.push(`package price ($${originalPackageAmount.toFixed(2)}) is less than minimum payment ($${parseFloat(promo.min_payment_amount).toFixed(2)})`);
                  
                  console.warn(`Promo ${promo_id} could not be applied during upgrade: ${reasons.join(', ')}`);
                }
              }
            } catch (promoError) {
              console.error('Error applying promo during upgrade:', promoError);
              // Don't fail upgrade if promo fails, just log it
            }
          }
          
          // Add original package amount to invoice items (before discounts)
          invoiceItems.push({
            description: `Package: ${packageName}`,
            amount: originalPackageAmount,
          });
          
          // Add promo discount line item if promo was applied
          if (promoDiscount > 0 && promoApplied) {
            let discountDescription = `Promo Discount (${promoApplied.promo_name}): `;
            if (promoApplied.promo_type === 'percentage_discount' && promoApplied.discount_percentage) {
              discountDescription += `${promoApplied.discount_percentage}%`;
            } else if (promoApplied.promo_type === 'fixed_discount' && promoApplied.discount_amount) {
              discountDescription += `$${parseFloat(promoApplied.discount_amount).toFixed(2)}`;
            } else if (promoApplied.promo_type === 'combined') {
              if (promoApplied.discount_percentage && parseFloat(promoApplied.discount_percentage) > 0) {
                discountDescription += `${promoApplied.discount_percentage}%`;
              } else if (promoApplied.discount_amount && parseFloat(promoApplied.discount_amount) > 0) {
                discountDescription += `$${parseFloat(promoApplied.discount_amount).toFixed(2)}`;
              }
            }
            
            invoiceItems.push({
              description: discountDescription,
              amount: -promoDiscount, // Negative amount for discount
            });
          }
          
          // Deduct reservation fee from package price (after promo discount)
          const adjustedPackageAmount = Math.max(0, packageAmountAfterPromo - reservationFeePaid);
          
          // Add discount line item if reservation fee was paid
          if (reservationFeePaid > 0) {
            invoiceItems.push({
              description: `Discount: Reservation Fee Paid`,
              amount: -reservationFeePaid, // Negative amount for discount
            });
            console.log(`✅ Applied promo discount ${promoDiscount}, then deducted reservation fee ${reservationFeePaid} from package price. Original: ${originalPackageAmount}, After promo: ${packageAmountAfterPromo}, Final: ${adjustedPackageAmount}`);
          }
          
          totalAmount = adjustedPackageAmount;
        }
      }

      // Process merchandise - validate inventory and deduct
      // For packages, merchandise is included (no separate charge), but we still need to deduct from inventory
      // For per-phase enrollment, merchandise can be added separately and charged
      if (selected_merchandise && selected_merchandise.length > 0) {
        for (const selectedMerch of selected_merchandise) {
          const merchId = typeof selectedMerch === 'object' ? selectedMerch.merchandise_id : selectedMerch;
          const selectedSize = typeof selectedMerch === 'object' ? selectedMerch.size : null;
          const selectedName = typeof selectedMerch === 'object' ? selectedMerch.merchandise_name : null;

          // Find merchandise - try multiple methods to find the correct item
          let merch = null;
          
          // First try to find by ID
          if (merchId) {
            const merchByIdResult = await client.query(
              `SELECT merchandise_id, merchandise_name, size, price, quantity, branch_id
               FROM merchandisestbl 
               WHERE merchandise_id = $1`,
              [merchId]
            );
            merch = merchByIdResult.rows[0] || null;
            
            // If size is specified and the found item doesn't match the size, search by name and size
            if (merch && selectedSize && merch.size !== selectedSize) {
              const merchBySizeResult = await client.query(
                `SELECT merchandise_id, merchandise_name, size, price, quantity, branch_id
                 FROM merchandisestbl 
                 WHERE merchandise_name = $1 AND size = $2 AND branch_id = $3
                 ORDER BY merchandise_id ASC
                 LIMIT 1`,
                [selectedName || merch.merchandise_name, selectedSize, branch_id]
              );
              if (merchBySizeResult.rows.length > 0) {
                merch = merchBySizeResult.rows[0];
              }
            }
          }

          // If not found by ID, try by name and size
          if (!merch && selectedName && selectedSize) {
            const merchBySizeResult = await client.query(
              `SELECT merchandise_id, merchandise_name, size, price, quantity, branch_id
               FROM merchandisestbl 
               WHERE merchandise_name = $1 AND size = $2 AND branch_id = $3
               ORDER BY merchandise_id ASC
               LIMIT 1`,
              [selectedName, selectedSize, branch_id]
            );
            merch = merchBySizeResult.rows[0] || null;
          }

          // If still not found and no size specified, try by name only
          if (!merch && selectedName && !selectedSize) {
            const merchByNameResult = await client.query(
              `SELECT merchandise_id, merchandise_name, size, price, quantity, branch_id
               FROM merchandisestbl 
               WHERE merchandise_name = $1 AND branch_id = $2
               ORDER BY merchandise_id ASC
               LIMIT 1`,
              [selectedName, branch_id]
            );
            merch = merchByNameResult.rows[0] || null;
          }

          if (!merch) {
            console.warn(`Merchandise not found: ID=${merchId}, Name=${selectedName}, Size=${selectedSize}`);
            continue;
          }
          
          // Verify merchandise belongs to the correct branch
          if (merch.branch_id && branch_id && merch.branch_id !== branch_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `Merchandise ${merch.merchandise_name}${merch.size ? ` (${merch.size})` : ''} belongs to a different branch. Expected branch: ${branch_id}, Found: ${merch.branch_id}`,
            });
          }

          // Validate inventory
          if (merch.quantity !== null && merch.quantity !== undefined) {
            const availableQuantity = parseInt(merch.quantity);
            if (availableQuantity < 1) {
              await client.query('ROLLBACK');
              return res.status(400).json({
                success: false,
                message: `Insufficient inventory for ${merch.merchandise_name}${merch.size ? ` (${merch.size})` : ''}`,
              });
            }
          }

          // Add merchandise to invoice items only for per-phase enrollment (not for packages)
          // For packages, merchandise is included in package price, so we don't charge separately
          if (enrollment_type === 'Per-Phase' && merch.price && !isNaN(parseFloat(merch.price))) {
            const price = parseFloat(merch.price);
            const selectedCategory = typeof selectedMerch === 'object' ? (selectedMerch.category || null) : null;
            const categoryText = selectedCategory ? ` - ${selectedCategory}` : '';
            invoiceItems.push({
              description: `Merchandise: ${merch.merchandise_name || 'Merchandise'}${categoryText}${merch.size ? ` (${merch.size})` : ''}`,
              amount: price,
            });
            totalAmount += price;
          }

          // Deduct inventory (for both package and per-phase enrollment)
          if (merch.quantity !== null && merch.quantity !== undefined) {
            const newQuantity = Math.max(0, (merch.quantity || 0) - 1);
            await client.query(
              `UPDATE merchandisestbl 
               SET quantity = $1 
               WHERE merchandise_id = $2`,
              [newQuantity, merch.merchandise_id]
            );
            console.log(`✅ Deducted merchandise: ${merch.merchandise_name}${merch.size ? ` (${merch.size})` : ''} - Quantity: ${merch.quantity} → ${newQuantity}`);
          }
        }
      }

      // Create invoice
      const today = new Date();
      const issueDateStr = today.toISOString().split('T')[0];

      // Determine due_date
      let dueDateStr = null;
      if (hasFullpaymentPricing) {
        dueDateStr = null; // Full payment - no due date
      } else if (installment_settings && installment_settings.invoice_due_date) {
        dueDateStr = installment_settings.invoice_due_date;
      }

      // Build invoice description based on enrollment type
      let invoiceDescription = null;
      if (enrollment_type === 'Per-Phase') {
        invoiceDescription = `Per-Phase - ${classData.program_name || 'Enrollment'}`;
      } else if (packageName) {
        invoiceDescription = packageName;
      } else {
        invoiceDescription = `Enrollment - ${classData.program_name || 'Enrollment'}`;
      }

      // Ensure package_id and promo_id columns exist
      try {
        await client.query(`
          DO $$ 
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'invoicestbl' AND column_name = 'package_id'
            ) THEN
              ALTER TABLE invoicestbl ADD COLUMN package_id INTEGER;
            END IF;
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'invoicestbl' AND column_name = 'promo_id'
            ) THEN
              ALTER TABLE invoicestbl ADD COLUMN promo_id INTEGER;
            END IF;
          END $$;
        `);
      } catch (err) {
        console.log('Column check:', err.message);
      }

      const invoiceResult = await client.query(
        `INSERT INTO invoicestbl (invoice_description, branch_id, amount, status, issue_date, due_date, created_by, package_id, promo_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          invoiceDescription,
          branch_id,
          totalAmount || 0,
          'Pending',
          issueDateStr,
          dueDateStr,
          req.user.userId || null,
          package_id || null,
          promo_id || null,
        ]
      );

      let newInvoice = invoiceResult.rows[0];
      
      // Update invoice amount if promo was applied (to ensure accuracy)
      if (promoApplied && promoDiscount > 0) {
        await client.query(
          `UPDATE invoicestbl SET amount = $1, promo_id = $2 WHERE invoice_id = $3`,
          [totalAmount, promo_id, newInvoice.invoice_id]
        );
        newInvoice.amount = totalAmount;
        newInvoice.promo_id = promo_id;
      } else if (promo_id) {
        // Link promo to invoice even if discount is 0 (for free merchandise only promos)
        await client.query(
          `UPDATE invoicestbl SET promo_id = $1 WHERE invoice_id = $2`,
          [promo_id, newInvoice.invoice_id]
        );
        newInvoice.promo_id = promo_id;
      }
      
      // Record promo usage if promo was applied
      if (promo_id && promoApplied) {
        try {
          // Insert usage record
          await client.query(
            `INSERT INTO promousagetbl (promo_id, student_id, invoice_id, discount_applied)
             VALUES ($1, $2, $3, $4)`,
            [promo_id, reservation.student_id, newInvoice.invoice_id, promoDiscount]
          );

          // Increment current_uses and check if max uses reached
          await client.query(
            `UPDATE promostbl 
             SET current_uses = COALESCE(current_uses, 0) + 1,
                 status = CASE 
                   WHEN max_uses IS NOT NULL AND (COALESCE(current_uses, 0) + 1) >= max_uses THEN 'Inactive'
                   ELSE status
                 END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE promo_id = $1`,
            [promo_id]
          );
          
          console.log(`✅ Promo ${promo_id} applied and usage recorded for student ${reservation.student_id}`);
        } catch (usageError) {
          console.error('Error recording promo usage during upgrade:', usageError);
          // Don't fail upgrade if usage recording fails
        }
      }

      // Create invoice items
      if (invoiceItems.length > 0) {
        for (const item of invoiceItems) {
          // Handle discount items (negative amounts) by storing in discount_amount field
          if (item.amount < 0) {
            await client.query(
              `INSERT INTO invoiceitemstbl (invoice_id, description, amount, discount_amount)
               VALUES ($1, $2, $3, $4)`,
              [newInvoice.invoice_id, item.description || 'Discount', 0, Math.abs(item.amount)]
            );
          } else {
            await client.query(
              `INSERT INTO invoiceitemstbl (invoice_id, description, amount)
               VALUES ($1, $2, $3)`,
              [newInvoice.invoice_id, item.description || 'Item', item.amount || 0]
            );
          }
        }
      } else {
        await client.query(
          `INSERT INTO invoiceitemstbl (invoice_id, description, amount)
           VALUES ($1, $2, $3)`,
          [newInvoice.invoice_id, `Enrollment in ${classData.program_name}`, totalAmount || 0]
        );
      }
      
      // Store class_id (and optional phase range) in invoice remarks field for enrollment tracking
      // For Phase packages, we include PHASE_START and PHASE_END so payments.js can enroll only those phases
      let invoiceRemarks = `CLASS_ID:${reservation.class_id}`;
      if (phaseStartForRemarks !== null && phaseEndForRemarks !== null) {
        invoiceRemarks += `;PHASE_START:${phaseStartForRemarks};PHASE_END:${phaseEndForRemarks}`;
      }
      await client.query(
        `UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`,
        [invoiceRemarks, newInvoice.invoice_id]
      );

      // Link student to invoice
      await client.query(
        'INSERT INTO invoicestudentstbl (invoice_id, student_id) VALUES ($1, $2)',
        [newInvoice.invoice_id, reservation.student_id]
      );

      // Create installment invoice profile if needed
      let installmentProfile = null;
      if (installment_settings && 
          package_id && 
          !hasFullpaymentPricing &&
          installment_settings.invoice_issue_date &&
          installment_settings.billing_month &&
          installment_settings.invoice_due_date &&
          installment_settings.invoice_generation_date &&
          installment_settings.frequency_months) {
        
        // For installment, the reservation fee is deducted from the first invoice (package price)
        // The installment profile amount should be the regular installment price (not adjusted)
        // The first invoice will show the adjusted amount (package price - reservation fee)
        const installmentProfileAmount = (installmentPricingList && installmentPricingList.pricing_price && !isNaN(parseFloat(installmentPricingList.pricing_price)))
          ? parseFloat(installmentPricingList.pricing_price)
          : (packageData.package_price && !isNaN(parseFloat(packageData.package_price)))
          ? parseFloat(packageData.package_price)
          : totalAmount;

        const billingMonthParts = installment_settings.billing_month.split('-');
        const firstBillingMonth = new Date(parseInt(billingMonthParts[0]), parseInt(billingMonthParts[1]) - 1, 1);
        const dueDate = new Date(installment_settings.invoice_due_date);
        const dayOfMonth = dueDate.getDate();
        const nextInvoiceDueDate = new Date(firstBillingMonth);
        nextInvoiceDueDate.setMonth(nextInvoiceDueDate.getMonth() + (installment_settings.frequency_months || 1));
        const generationDate = new Date(installment_settings.invoice_generation_date);
        const totalPhases = classData.number_of_phase || null;

        const profileResult = await client.query(
          `INSERT INTO installmentinvoiceprofilestbl 
           (student_id, branch_id, package_id, amount, frequency, description, 
            day_of_month, is_active, bill_invoice_due_date, next_invoice_due_date, 
            first_billing_month, first_generation_date, created_by, class_id, total_phases, generated_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           RETURNING *`,
          [
            reservation.student_id,
            branch_id,
            package_id,
            installmentProfileAmount,
            `${installment_settings.frequency_months} month(s)`,
            `Installment plan for ${studentCheck.rows[0].full_name} - ${classData.program_name}`,
            dayOfMonth,
            true,
            installment_settings.invoice_due_date,
            nextInvoiceDueDate.toISOString().split('T')[0],
            firstBillingMonth.toISOString().split('T')[0],
            installment_settings.invoice_generation_date,
            req.user.fullName || req.user.email || null,
            reservation.class_id,
            totalPhases,
            0,
          ]
        );
        installmentProfile = profileResult.rows[0];

        // Link the invoice to the installment profile
        // This ensures that when the first invoice (package price) is paid,
        // it will be treated as an installment payment and enroll only in Phase 1
        await client.query(
          `UPDATE invoicestbl 
           SET installmentinvoiceprofiles_id = $1 
           WHERE invoice_id = $2`,
          [installmentProfile.installmentinvoiceprofiles_id, newInvoice.invoice_id]
        );

        // Create first installment invoice record
        const nextGenerationDate = new Date(generationDate);
        const nextInvoiceMonth = new Date(nextInvoiceDueDate);
        
        await client.query(
          `INSERT INTO installmentinvoicestbl 
           (installmentinvoiceprofiles_id, scheduled_date, status, student_name, 
            total_amount_including_tax, total_amount_excluding_tax, frequency, next_generation_date, next_invoice_month)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            installmentProfile.installmentinvoiceprofiles_id,
            installment_settings.invoice_due_date || installment_settings.invoice_generation_date,
            'Pending',
            studentCheck.rows[0].full_name,
            installmentProfileAmount, // Use pricing list price for installment invoice display
            installmentProfileAmount, // Assuming no tax for now, or can be calculated separately
            `${installment_settings.frequency_months} month(s)`,
            nextGenerationDate.toISOString().split('T')[0],
            nextInvoiceMonth.toISOString().split('T')[0], // Full date format (YYYY-MM-DD)
          ]
        );
      }

      // NOTE: Enrollment is NOT created here. Students will be enrolled only after payment is made.
      // - For installment: Enrolled in Phase 1 when first invoice is paid
      // - For full payment: Enrolled in all phases when invoice is fully paid
      // Enrollment will happen automatically in payments.js when payment is recorded
      let enrollmentResult = { rows: [] };
      let allEnrollmentRecords = [];
      
      console.log(`📝 Invoice created. Student will be enrolled after payment is made.`);

      // Update reservation status
      await client.query(
        `UPDATE reservedstudentstbl 
         SET status = 'Upgraded', 
             upgraded_at = CURRENT_TIMESTAMP,
             upgraded_by = $1,
             expired_at = NULL
         WHERE reserved_id = $2`,
        [req.user.fullName || req.user.email, id]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        data: {
          reservation: reservation,
          invoice: newInvoice,
          installmentProfile: installmentProfile || null,
        },
        message: 'Invoice generated. Student will be enrolled after payment is made.',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    }
  }
);

/**
 * PUT /api/sms/reservations/:id/status
 * Update reservation status (e.g., mark fee as paid)
 * Access: Superadmin, Admin
 */
router.put(
  '/:id/status',
  [
    param('id').isInt().withMessage('Reservation ID must be an integer'),
    body('status').isIn(['Reserved', 'Fee Paid', 'Cancelled']).withMessage('Invalid status'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const { status } = req.body;

      // Get reservation
      const reservationResult = await client.query(
        `SELECT * FROM reservedstudentstbl WHERE reserved_id = $1`,
        [id]
      );

      if (reservationResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Reservation not found',
        });
      }

      const reservation = reservationResult.rows[0];

      // Update status
      let updateFields = ['status = $1'];
      let updateValues = [status];
      let paramCount = 1;

      if (status === 'Fee Paid') {
        paramCount++;
        updateFields.push(`reservation_fee_paid_at = CURRENT_TIMESTAMP`);
      }

      paramCount++;
      updateFields.push(`reserved_id = $${paramCount}`);
      updateValues.push(id);

      await client.query(
        `UPDATE reservedstudentstbl 
         SET ${updateFields.join(', ')}
         WHERE reserved_id = $${paramCount}`,
        updateValues
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Reservation status updated successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    }
  }
);

/**
 * DELETE /api/sms/reservations/:id
 * Cancel/Delete a reservation
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('Reservation ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;

      // Check if reservation exists
      const reservationResult = await client.query(
        `SELECT * FROM reservedstudentstbl WHERE reserved_id = $1`,
        [id]
      );

      if (reservationResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Reservation not found',
        });
      }

      const reservation = reservationResult.rows[0];

      // If already upgraded, don't allow deletion
      if (reservation.status === 'Upgraded') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Cannot delete an upgraded reservation',
        });
      }

      // Mark as cancelled instead of deleting
      await client.query(
        `UPDATE reservedstudentstbl 
         SET status = 'Cancelled'
         WHERE reserved_id = $1`,
        [id]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Reservation cancelled successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    }
  }
);

/**
 * POST /api/sms/reservations/expire-unpaid
 * Expire unpaid reservations that have passed their due date
 * This should be called by a scheduled job (cron) daily or automatically when fetching invoices
 * Access: Superadmin, Admin (or can be called by system/cron)
 * 
 * Logic:
 * 1. Finds reservations with 'Reserved' or 'Fee Paid' status that are past due date
 * 2. If reservation was 'Upgraded' (student enrolled), unenrolls the student
 * 3. Updates reservation status to 'Expired' and sets expired_at timestamp
 * 4. This frees up the class slot so student can re-upgrade if class is available
 */
router.post(
  '/expire-unpaid',
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Find all reservations that:
      // 1. Are in 'Reserved' status (reservation fee not paid yet)
      // 2. Have a due_date that has passed (payment deadline)
      // 3. Have not been expired yet (expired_at IS NULL)
      // 4. Either no invoice exists OR invoice exists but is unpaid
      // Note: 'Fee Paid' reservations don't expire - they can upgrade anytime if class is available
      // Note: 'Upgraded' reservations don't expire via this endpoint
      const expiredReservations = await client.query(
        `SELECT r.reserved_id, r.student_id, r.class_id, r.status, r.invoice_id, r.phase_number
         FROM reservedstudentstbl r
         WHERE r.status = 'Reserved'
           AND r.due_date IS NOT NULL
           AND r.due_date < CURRENT_DATE
           AND r.expired_at IS NULL
           AND (
             -- Either reservation fee invoice is unpaid or doesn't exist
             (r.invoice_id IS NULL)
             OR
             (r.invoice_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM invoicestbl inv 
               WHERE inv.invoice_id = r.invoice_id 
               AND inv.status NOT IN ('Paid', 'Partially Paid')
             ))
           )`,
        []
      );

      const expiredIds = [];
      const unenrolledStudents = [];

      for (const reservation of expiredReservations.rows) {
        // Check if student is enrolled (reservation was upgraded)
        const enrollmentCheck = await client.query(
          `SELECT cs.classstudent_id 
           FROM classstudentstbl cs
           WHERE cs.student_id = $1 
             AND cs.class_id = $2
             ${reservation.phase_number ? `AND cs.phase_number = $3` : ''}`,
          reservation.phase_number 
            ? [reservation.student_id, reservation.class_id, reservation.phase_number]
            : [reservation.student_id, reservation.class_id]
        );

        // If student is enrolled, unenroll them
        if (enrollmentCheck.rows.length > 0) {
          for (const enrollment of enrollmentCheck.rows) {
            await client.query(
              'DELETE FROM classstudentstbl WHERE classstudent_id = $1',
              [enrollment.classstudent_id]
            );
            unenrolledStudents.push({
              reserved_id: reservation.reserved_id,
              student_id: reservation.student_id,
              class_id: reservation.class_id,
              enrollment_id: enrollment.classstudent_id,
            });
            console.log(`⚠️ Student ${reservation.student_id} unenrolled from class ${reservation.class_id} due to expired reservation ${reservation.reserved_id}`);
          }
        }

        expiredIds.push(reservation.reserved_id);
      }

      // Update all expired reservations
      if (expiredIds.length > 0) {
        await client.query(
          `UPDATE reservedstudentstbl 
           SET status = 'Expired', expired_at = CURRENT_TIMESTAMP
           WHERE reserved_id = ANY($1::int[])`,
          [expiredIds]
        );
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        message: `Expired ${expiredIds.length} unpaid reservation(s)${unenrolledStudents.length > 0 ? ` and unenrolled ${unenrolledStudents.length} student(s)` : ''}`,
        data: {
          expired_count: expiredIds.length,
          expired_reservations: expiredReservations.rows,
          unenrolled_count: unenrolledStudents.length,
          unenrolled_students: unenrolledStudents,
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
 * GET /api/sms/reservations/alternatives/:classId
 * Get alternative classes for a student when their desired class is full
 * Filters by same level_tag and shows classes with available slots
 * Access: Superadmin, Admin
 */
router.get(
  '/alternatives/:classId',
  [
    param('classId').isInt().withMessage('Class ID must be an integer'),
    queryValidator('level_tag').optional().isString().withMessage('Level tag must be a string'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { classId } = req.params;
      const { level_tag } = req.query;

      // Get the original class to get level_tag if not provided
      let targetLevelTag = level_tag;
      if (!targetLevelTag) {
        const classResult = await query(
          'SELECT level_tag FROM classestbl WHERE class_id = $1',
          [classId]
        );
        if (classResult.rows.length > 0) {
          targetLevelTag = classResult.rows[0].level_tag;
        }
      }

      if (!targetLevelTag) {
        return res.status(400).json({
          success: false,
          message: 'Level tag is required to find alternative classes',
        });
      }

      // Get alternative classes with available slots
      const alternativesResult = await query(
        `SELECT DISTINCT c.class_id, c.class_name, c.level_tag, c.max_students,
                c.start_date, c.end_date, c.status,
                p.program_name, b.branch_name, r.room_name,
                COALESCE(enrolled_counts.enrolled_count, 0) as enrolled_students,
                COALESCE(reserved_counts.reserved_count, 0) as reserved_students,
                (COALESCE(enrolled_counts.enrolled_count, 0) + COALESCE(reserved_counts.reserved_count, 0)) as total_occupied,
                (c.max_students - (COALESCE(enrolled_counts.enrolled_count, 0) + COALESCE(reserved_counts.reserved_count, 0))) as available_slots
         FROM classestbl c
         LEFT JOIN programstbl p ON c.program_id = p.program_id
         LEFT JOIN branchestbl b ON c.branch_id = b.branch_id
         LEFT JOIN roomstbl r ON c.room_id = r.room_id
         LEFT JOIN (
           SELECT class_id, COUNT(DISTINCT student_id) as enrolled_count
           FROM classstudentstbl
           GROUP BY class_id
         ) enrolled_counts ON c.class_id = enrolled_counts.class_id
         LEFT JOIN (
           SELECT class_id, COUNT(DISTINCT student_id) as reserved_count
           FROM reservedstudentstbl
           WHERE status NOT IN ('Cancelled', 'Expired')
           GROUP BY class_id
         ) reserved_counts ON c.class_id = reserved_counts.class_id
         WHERE c.status = 'Active'
           AND c.class_id != $1
           AND c.level_tag = $2
           AND (c.max_students IS NULL OR 
                (COALESCE(enrolled_counts.enrolled_count, 0) + COALESCE(reserved_counts.reserved_count, 0)) < c.max_students)
         ORDER BY available_slots DESC, c.class_name
         LIMIT 10`,
        [classId, targetLevelTag]
      );

      res.json({
        success: true,
        data: alternativesResult.rows,
        message: `Found ${alternativesResult.rows.length} alternative class(es) with available slots`,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

