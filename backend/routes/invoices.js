import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query, getClient } from '../config/database.js';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// All routes require authentication
router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

/**
 * GET /api/sms/invoices
 * Get all invoices with their items and students
 * Access: All authenticated users
 */
router.get(
  '/',
  [
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('status').optional().isString().withMessage('Status must be a string'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      // Auto-expire unpaid reservations that are past due date
      // This checks and expires reservations when invoices are fetched
      try {
        const expireClient = await getClient();
        try {
          await expireClient.query('BEGIN');
          
          // Find reservations that need to be expired:
          // 1. Status is 'Reserved' (reservation fee not paid)
          // 2. Due date has passed
          // 3. Invoice is unpaid or doesn't exist
          const expiredReservations = await expireClient.query(
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
          for (const reservation of expiredReservations.rows) {
            // Check if student is enrolled (reservation was upgraded before - should not happen for 'Reserved' status, but check anyway)
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

            // If student is enrolled, unenroll them (removes from class count)
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

          // Update all expired reservations
          if (expiredIds.length > 0) {
            await expireClient.query(
              `UPDATE reservedstudentstbl 
               SET status = 'Expired', expired_at = CURRENT_TIMESTAMP
               WHERE reserved_id = ANY($1::int[])`,
              [expiredIds]
            );
            console.log(`✅ Auto-expired ${expiredIds.length} reservation(s) past due date`);
          }
          
          await expireClient.query('COMMIT');
        } catch (expireError) {
          await expireClient.query('ROLLBACK');
          console.error('Error auto-expiring reservations:', expireError);
          // Continue with invoice fetching even if expiration check fails
        } finally {
          expireClient.release();
        }
      } catch (getClientError) {
        console.error('Error getting client for expiration check:', getClientError);
        // Continue with invoice fetching even if expiration check fails
      }

      const { branch_id, status, page = 1, limit = 20 } = req.query;
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 20;
      const offset = (pageNum - 1) * limitNum;

      let sql = `SELECT invoice_id, invoice_description, branch_id, amount, status, remarks, 
                        TO_CHAR(issue_date, 'YYYY-MM-DD') as issue_date, 
                        TO_CHAR(due_date, 'YYYY-MM-DD') as due_date, 
                        created_by,
                        CASE 
                          WHEN status NOT IN ('Paid', 'Cancelled') AND due_date IS NOT NULL AND due_date < CURRENT_DATE 
                          THEN 'Unpaid'
                          ELSE status
                        END as computed_status
                 FROM invoicestbl WHERE 1=1`;
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

      if (status) {
        paramCount++;
        sql += ` AND status = $${paramCount}`;
        params.push(status);
      }

      sql += ` ORDER BY invoice_id DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limitNum, offset);

      const result = await query(sql, params);

      // Fetch invoice items, students, and reservation info for each invoice
      const invoicesWithDetails = await Promise.all(
        result.rows.map(async (invoice) => {
          try {
            const itemsResult = await query(
              'SELECT * FROM invoiceitemstbl WHERE invoice_id = $1',
              [invoice.invoice_id]
            );
            
            const studentsResult = await query(
              'SELECT inv_student.*, u.full_name, u.email FROM invoicestudentstbl inv_student LEFT JOIN userstbl u ON inv_student.student_id = u.user_id WHERE inv_student.invoice_id = $1',
              [invoice.invoice_id]
            );

            // Check if this invoice is linked to a reservation
            const reservationResult = await query(
              `SELECT r.reserved_id, r.status as reservation_status, r.due_date as reservation_due_date,
                      r.expired_at, TO_CHAR(r.due_date, 'YYYY-MM-DD') as reservation_due_date_str,
                      c.class_name, u.full_name as student_name
               FROM reservedstudentstbl r
               LEFT JOIN classestbl c ON r.class_id = c.class_id
               LEFT JOIN userstbl u ON r.student_id = u.user_id
               WHERE r.invoice_id = $1`,
              [invoice.invoice_id]
            );

            const reservation = reservationResult.rows.length > 0 ? reservationResult.rows[0] : null;
            
            // Check if reservation is expired (past due date and invoice unpaid)
            let reservationExpired = false;
            if (reservation && reservation.reservation_due_date && reservation.reservation_status !== 'Expired' && reservation.reservation_status !== 'Upgraded' && reservation.reservation_status !== 'Cancelled') {
              const dueDate = new Date(reservation.reservation_due_date);
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              if (dueDate < today && invoice.status !== 'Paid') {
                reservationExpired = true;
              }
            }

            return {
              ...invoice,
              status: invoice.computed_status || invoice.status, // Use computed status if available
              items: itemsResult.rows || [],
              students: studentsResult.rows || [],
              reservation: reservation ? {
                reserved_id: reservation.reserved_id,
                status: reservation.reservation_status,
                due_date: reservation.reservation_due_date_str,
                expired_at: reservation.expired_at,
                is_expired: reservation.reservation_status === 'Expired' || reservationExpired,
                class_name: reservation.class_name,
                student_name: reservation.student_name,
              } : null,
            };
          } catch (err) {
            console.error(`Error fetching details for invoice ${invoice.invoice_id}:`, err);
            // Return invoice with empty items/students if there's an error
            return {
              ...invoice,
              items: [],
              students: [],
              reservation: null,
            };
          }
        })
      );

      res.json({
        success: true,
        data: invoicesWithDetails,
        pagination: {
          page: pageNum,
          limit: limitNum,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/invoices/:id
 * Get invoice by ID with items and students
 */
router.get(
  '/:id',
  [
    param('id').isInt().withMessage('Invoice ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const result = await query('SELECT * FROM invoicestbl WHERE invoice_id = $1', [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Invoice not found',
        });
      }

      // Fetch invoice items
      const itemsResult = await query(
        'SELECT * FROM invoiceitemstbl WHERE invoice_id = $1',
        [id]
      );

      // Fetch invoice students
      const studentsResult = await query(
        'SELECT inv_student.*, u.full_name, u.email FROM invoicestudentstbl inv_student JOIN userstbl u ON inv_student.student_id = u.user_id WHERE inv_student.invoice_id = $1',
        [id]
      );

      // Check if this invoice is linked to a reservation
      const reservationResult = await query(
        `SELECT r.reserved_id, r.status as reservation_status, r.due_date as reservation_due_date,
                r.expired_at, TO_CHAR(r.due_date, 'YYYY-MM-DD') as reservation_due_date_str,
                c.class_name, u.full_name as student_name
         FROM reservedstudentstbl r
         LEFT JOIN classestbl c ON r.class_id = c.class_id
         LEFT JOIN userstbl u ON r.student_id = u.user_id
         WHERE r.invoice_id = $1`,
        [id]
      );

      const reservation = reservationResult.rows.length > 0 ? reservationResult.rows[0] : null;
      
      // Check if reservation is expired (past due date and invoice unpaid)
      let reservationExpired = false;
      if (reservation && reservation.reservation_due_date && reservation.reservation_status !== 'Expired' && reservation.reservation_status !== 'Upgraded' && reservation.reservation_status !== 'Cancelled') {
        const dueDate = new Date(reservation.reservation_due_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (dueDate < today && result.rows[0].status !== 'Paid') {
          reservationExpired = true;
        }
      }

      res.json({
        success: true,
        data: {
          ...result.rows[0],
          items: itemsResult.rows,
          students: studentsResult.rows,
          reservation: reservation ? {
            reserved_id: reservation.reserved_id,
            status: reservation.reservation_status,
            due_date: reservation.reservation_due_date_str,
            expired_at: reservation.expired_at,
            is_expired: reservation.reservation_status === 'Expired' || reservationExpired,
            class_name: reservation.class_name,
            student_name: reservation.student_name,
          } : null,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/invoices/:id/pdf
 * Download invoice as PDF
 */
router.get(
  '/:id/pdf',
  [
    param('id').isInt().withMessage('Invoice ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Fetch invoice
      const invoiceResult = await query(
        `SELECT invoice_id, invoice_description, branch_id, amount, status, remarks,
                TO_CHAR(issue_date, 'YYYY-MM-DD') as issue_date,
                TO_CHAR(due_date, 'YYYY-MM-DD') as due_date
         FROM invoicestbl
         WHERE invoice_id = $1`,
        [id]
      );

      if (invoiceResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Invoice not found',
        });
      }

      const invoice = invoiceResult.rows[0];

      // Fetch branch information
      let branchInfo = null;
      if (invoice.branch_id) {
        const branchResult = await query(
          'SELECT branch_name, branch_address FROM branchestbl WHERE branch_id = $1',
          [invoice.branch_id]
        );
        if (branchResult.rows.length > 0) {
          branchInfo = branchResult.rows[0];
        }
      }

      // Fetch items
      const itemsResult = await query(
        'SELECT description, amount, tax_item, tax_percentage, discount_amount, penalty_amount FROM invoiceitemstbl WHERE invoice_id = $1',
        [id]
      );

      // Fetch students with phone numbers
      const studentsResult = await query(
        `SELECT inv_student.student_id, u.full_name, u.email, u.phone_number
         FROM invoicestudentstbl inv_student
         LEFT JOIN userstbl u ON inv_student.student_id = u.user_id
         WHERE inv_student.invoice_id = $1`,
        [id]
      );

      // Fetch payments for this invoice
      const paymentsResult = await query(
        `SELECT p.payment_method, p.payment_type, p.payable_amount, p.reference_number,
                TO_CHAR(p.issue_date, 'YYYY-MM-DD') as payment_date_raw
         FROM paymenttbl p
         WHERE p.invoice_id = $1 AND p.status = 'Completed'
         ORDER BY p.issue_date DESC`,
        [id]
      );

      // Prepare logo path (if exists)
      const logoPath = path.resolve(process.cwd(), '../frontend/public/LCA Icon.png');
      const hasLogo = fs.existsSync(logoPath);

      // Calculate totals
      const formatCurrency = (value) => `PHP ${(Number(value) || 0).toFixed(2)}`;
      const formatDate = (dateString) => {
        if (!dateString) return '';
        try {
          const date = new Date(dateString);
          if (Number.isNaN(date.getTime())) return '';
          const day = String(date.getUTCDate()).padStart(2, '0');
          const month = String(date.getUTCMonth() + 1).padStart(2, '0');
          const year = date.getUTCFullYear();
          return `${day}/${month}/${year}`;
        } catch {
          return dateString;
        }
      };

      const items = itemsResult.rows || [];
      const totals = items.reduce(
        (acc, item) => {
          const amt = Number(item.amount) || 0;
          const discount = Number(item.discount_amount) || 0;
          const penalty = Number(item.penalty_amount) || 0;
          const taxPct = Number(item.tax_percentage) || 0;
          const taxableBase = amt - discount + penalty;
          const tax = taxableBase * (taxPct / 100);
          acc.subtotal += amt;
          acc.discount += discount;
          acc.penalty += penalty;
          acc.tax += tax;
          return acc;
        },
        { subtotal: 0, discount: 0, penalty: 0, tax: 0 }
      );
      const grandTotal = totals.subtotal - totals.discount + totals.penalty + totals.tax;

      // Calculate total payments
      const totalPayments = paymentsResult.rows.reduce((sum, p) => sum + (Number(p.payable_amount) || 0), 0);
      const amountDue = grandTotal - totalPayments;

      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=invoice-${id}.pdf`);

      doc.pipe(res);

      // Helper function to extract package name from description
      const extractPackage = (description) => {
        if (!description) return '';
        // Look for package patterns like "Package: Nursery" or just extract level tag
        const packageMatch = description.match(/Package:\s*([^:]+)/i);
        if (packageMatch) return packageMatch[1].trim();
        // Try to extract level tag (e.g., "Nursery", "Pre-Kindergarten")
        const levelMatch = description.match(/^(Nursery|Pre-Kindergarten|Kindergarten|Elementary|Junior High|Senior High)/i);
        if (levelMatch) return levelMatch[1];
        return '';
      };

      // Header Section
      const headerY = 50;
      if (hasLogo) {
        doc.image(logoPath, 50, headerY, { width: 50, height: 50 });
      }
      
      // School name and address
      const schoolNameX = hasLogo ? 120 : 50;
      doc.fontSize(16).fillColor('#000000').font('Helvetica-Bold');
      doc.text('LITTLE CHAMPIONS ACADEMY INC.', schoolNameX, headerY);
      
      // Branch address
      const branchAddress = branchInfo?.branch_address || (branchInfo?.branch_name || '');
      if (branchAddress) {
        doc.fontSize(10).fillColor('#333333').font('Helvetica');
        doc.text(branchAddress, schoolNameX, headerY + 20);
      }

      // INVOICE text on the right
      doc.fontSize(32).fillColor('#000000').font('Helvetica-Bold');
      doc.text('INVOICE', 400, headerY, { align: 'right', width: 150 });

      // Invoice Details Section
      let currentY = headerY + 70;
      doc.fontSize(10).fillColor('#333333').font('Helvetica');
      doc.text(`Invoice Number: INV-${invoice.invoice_id}`, 50, currentY);
      currentY += 12;
      doc.text(`Invoice Date: ${formatDate(invoice.issue_date)}`, 50, currentY);
      currentY += 12;
      doc.text(`Invoice Due Date: ${formatDate(invoice.due_date)}`, 50, currentY);

      currentY += 20;

      // BILL TO Section
      doc.fontSize(12).fillColor('#000000').font('Helvetica-Bold');
      doc.text('BILL TO', 50, currentY);
      currentY += 15;
      
      doc.fontSize(10).fillColor('#333333').font('Helvetica');
      if (studentsResult.rows.length === 0) {
        doc.text('No student linked.', 50, currentY);
        currentY += 12;
        doc.text('Email: -', 50, currentY);
        currentY += 12;
        doc.text('Phone: -', 50, currentY);
        currentY += 12;
        doc.text('Country: Philippines', 50, currentY);
      } else {
        // Combine all student names
        const studentNames = studentsResult.rows.map(s => s.full_name || 'Student').join(', ');
        doc.text(`Name: ${studentNames}`, 50, currentY);
        currentY += 12;
        
        // Combine all emails
        const emails = studentsResult.rows.filter(s => s.email).map(s => s.email).join(', ');
        doc.text(`Email: ${emails || '-'}`, 50, currentY);
        currentY += 12;
        
        // Combine all phone numbers
        const phones = studentsResult.rows.filter(s => s.phone_number).map(s => s.phone_number).join(', ');
        doc.text(`Phone: ${phones ? `+63 ${phones.replace(/^63/, '')}` : '-'}`, 50, currentY);
        currentY += 12;
        doc.text('Country: Philippines', 50, currentY);
      }

      currentY += 20;

      // Line Items Table
      doc.fontSize(10).fillColor('#000000').font('Helvetica-Bold');
      const tableStartY = currentY;
      const colNum = 50;
      const colDesc = 80;
      const colPackage = 350;
      const colQty = 420;
      const colNetAmount = 480;

      // Table Header
      doc.text('#', colNum, tableStartY);
      doc.text('Description', colDesc, tableStartY);
      doc.text('Package', colPackage, tableStartY);
      doc.text('Qty', colQty, tableStartY);
      doc.text('Net Amount', colNetAmount, tableStartY, { width: 70, align: 'right' });
      
      // Draw header line
      doc.moveTo(50, tableStartY + 15).lineTo(550, tableStartY + 15).strokeColor('#000000').lineWidth(0.5).stroke();

      currentY = tableStartY + 25;
      doc.fontSize(9).fillColor('#333333').font('Helvetica');

      if (items.length === 0) {
        doc.text('No items.', colDesc, currentY);
        currentY += 15;
      } else {
        items.forEach((item, idx) => {
          // Show the effective line amount so penalties are visible on the invoice.
          // (amount - discount + penalty + tax)
          const amt = Number(item.amount) || 0;
          const discount = Number(item.discount_amount) || 0;
          const penalty = Number(item.penalty_amount) || 0;
          const taxPct = Number(item.tax_percentage) || 0;
          const taxableBase = amt - discount + penalty;
          const tax = taxableBase * (taxPct / 100);
          const netAmount = taxableBase + tax;
          const packageName = extractPackage(item.description);
          
          doc.text((idx + 1).toString(), colNum, currentY);
          doc.text(item.description || '-', colDesc, currentY, { width: 250 });
          doc.text(packageName || '-', colPackage, currentY, { width: 60 });
          doc.text('1', colQty, currentY, { width: 30, align: 'center' });
          doc.text(formatCurrency(netAmount), colNetAmount, currentY, { width: 70, align: 'right' });
          currentY += 15;
        });
      }

      currentY += 15;

      // Financial Summary
      doc.fontSize(10).fillColor('#000000').font('Helvetica-Bold');
      doc.text('Total', colNetAmount, currentY, { width: 70, align: 'right' });
      doc.text(formatCurrency(grandTotal), colNetAmount, currentY + 12, { width: 70, align: 'right' });
      currentY += 25;

      // Draw horizontal line after Total
      doc.moveTo(50, currentY).lineTo(550, currentY).strokeColor('#000000').lineWidth(0.5).stroke();
      currentY += 10;

      // Payment details
      if (paymentsResult.rows.length > 0) {
        paymentsResult.rows.forEach((payment) => {
          const paymentMethod = payment.payment_method || 'Cash';
          const refNum = payment.reference_number || '';
          const paymentDate = payment.payment_date_raw ? formatDate(payment.payment_date_raw) : '';
          const paymentAmount = Number(payment.payable_amount) || 0;
          
          // "Fully Settled Via" label on the left
          doc.fontSize(9).fillColor('#333333').font('Helvetica');
          const paymentMethodText = `Fully Settled Via ${paymentMethod}${refNum ? ` ${refNum}` : ''}`;
          doc.text(paymentMethodText, 50, currentY, { width: 300 });
          
          // Payment amount on the right (same line)
          doc.text(formatCurrency(paymentAmount), colNetAmount, currentY, { width: 70, align: 'right' });
          currentY += 15;
          
          // Payment date below, indented
          if (paymentDate) {
            doc.fontSize(8).fillColor('#666666').font('Helvetica');
            doc.text(`(${paymentDate})`, 60, currentY, { width: 300 }); // Indented by 10px
            currentY += 15;
          }
        });
      }

      // Draw horizontal line before Amount Due
      doc.moveTo(50, currentY).lineTo(550, currentY).strokeColor('#000000').lineWidth(0.5).stroke();
      currentY += 10;

      // Amount Due
      doc.fontSize(10).fillColor('#000000').font('Helvetica-Bold');
      doc.text('Amount Due', colNetAmount, currentY, { width: 70, align: 'right' });
      doc.text(formatCurrency(amountDue), colNetAmount, currentY + 12, { width: 70, align: 'right' });

      currentY += 25;

      // Remarks Section - Check if we need to start a new page
      // Only add new page if we're very close to the bottom (be very lenient to avoid unnecessary page breaks)
      const currentPageHeight = doc.page.height;
      const pageTopMargin = 50;
      const pageBottomMargin = 50; // Bottom margin for footer
      // Actual remarks section height is approximately:
      // Thank you (15) + Reminder (20) + Disregard (15) + Facebook Q (12) + URL (12) + Growth (18) + 
      // Regards (12) + Company (12) + Tagline (12) + Branch Address (12) = ~140px
      const estimatedRemarksHeight = 150; // Accurate estimated height including all text and spacing
      const safetyMargin = 10; // Small safety margin
      
      // Calculate usable page height (page height minus margins)
      const usableHeight = currentPageHeight - pageTopMargin - pageBottomMargin;
      // Only create new page if content will definitely overflow the usable area
      // Use a more lenient check - only break if we're really close to the limit
      if (currentY > pageTopMargin && currentY + estimatedRemarksHeight + safetyMargin > currentPageHeight - pageBottomMargin) {
        doc.addPage();
        currentY = pageTopMargin;
      }
      
      doc.fontSize(9).fillColor('#333333').font('Helvetica');
      const remarksY = currentY;
      doc.text('Thank you for choosing Little Champions Academy. Your trust and support are truly valuable to us.', 50, remarksY, { width: 500 });
      currentY += 15;
      
      doc.text('We kindly remind all parents and guardians that payments for monthly tuition fees are due on the 5th day of each month. To avoid inconvenience, we encourage timely payments, as a 10% penalty will be applied to accounts settled after the due date.', 50, currentY, { width: 500 });
      currentY += 20;
      
      doc.text('Please disregard this invoice if payment has already been made.', 50, currentY, { width: 500 });
      currentY += 15;
      
      // Facebook page text with hyperlink - formatted better
      const fbUrl = 'https://www.facebook.com/littlechampionsacademy';
      doc.text('If you have any questions or need assistance, please don\'t hesitate to reach out to our Facebook Page:', 50, currentY, { width: 500 });
      currentY += 12;
      
      // Put URL on its own line with proper formatting
      const urlStartX = 50;
      const urlY = currentY;
      const urlWidth = doc.widthOfString(fbUrl);
      
      // Add hyperlink for the URL
      doc.link(urlStartX, urlY - 2, urlStartX + urlWidth, urlY + 10, fbUrl);
      
      // Write URL in blue color and underline to indicate it's clickable
      doc.fillColor('#0066cc');
      doc.text(fbUrl, urlStartX, urlY, { 
        width: 500,
        link: fbUrl
      });
      
      // Reset color
      doc.fillColor('#333333');
      currentY += 12;
      
      doc.text('We look forward to another great month of learning and growth together.', 50, currentY, { width: 500 });
      currentY += 18;
      
      doc.text('Warmest regards,', 50, currentY);
      currentY += 12;
      doc.font('Helvetica-Bold');
      doc.text('Little Champions Academy, Inc.', 50, currentY);
      currentY += 12;
      doc.font('Helvetica');
      doc.text('Play. Learn. Succeed.', 50, currentY);
      
      // Add branch address below "Play. Learn. Succeed."
      if (branchInfo?.branch_address) {
        currentY += 12;
        doc.fontSize(9).fillColor('#333333').font('Helvetica');
        doc.text(branchInfo.branch_address, 50, currentY, { width: 500 });
      }

      // Footer - Add at bottom of current page if there's space
      // Calculate footer position: page height minus bottom margin (pageBottomMargin already declared above)
      const footerY = currentPageHeight - pageBottomMargin;
      
      // Only add footer if there's enough space on current page (with 20px buffer)
      if (currentY + 20 < footerY) {
        doc.fontSize(8).fillColor('#666666').font('Helvetica');
        doc.text('This invoice is powered by little-champions academy', 50, footerY, { align: 'center', width: 500 });
      } else {
        // If content is too long, add footer after address (but don't create new page)
        currentY += 15;
        doc.fontSize(8).fillColor('#666666').font('Helvetica');
        doc.text('This invoice is powered by little-champions academy', 50, currentY, { align: 'center', width: 500 });
      }

      doc.end();
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sms/invoices/:id/send-overdue-email
 * Send overdue payment reminder email to student(s) for an invoice
 * Access: Superadmin, Admin, Finance
 */
router.post(
  '/:id/send-overdue-email',
  [
    param('id').isInt().withMessage('Invoice ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      const { id } = req.params;

      // Get invoice details
      const invoiceResult = await client.query(
        `SELECT i.*, b.branch_name
         FROM invoicestbl i
         LEFT JOIN branchestbl b ON i.branch_id = b.branch_id
         WHERE i.invoice_id = $1`,
        [id]
      );

      if (invoiceResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Invoice not found',
        });
      }

      const invoice = invoiceResult.rows[0];

      // Check if invoice is overdue and not paid
      const today = new Date();
      const dueDate = new Date(invoice.due_date);
      const isOverdue = dueDate < today;
      const isPaid = invoice.status === 'Paid';

      if (!isOverdue) {
        return res.status(400).json({
          success: false,
          message: 'Invoice is not overdue. Email can only be sent for overdue invoices.',
        });
      }

      if (isPaid) {
        return res.status(400).json({
          success: false,
          message: 'Invoice is already paid. Email can only be sent for unpaid invoices.',
        });
      }

      // Get students linked to this invoice
      const studentsResult = await client.query(
        `SELECT inv_student.*, u.full_name, u.email
         FROM invoicestudentstbl inv_student
         JOIN userstbl u ON inv_student.student_id = u.user_id
         WHERE inv_student.invoice_id = $1`,
        [id]
      );

      if (studentsResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No students found for this invoice',
        });
      }

      // Get invoice items to calculate outstanding balance
      const itemsResult = await client.query(
        'SELECT * FROM invoiceitemstbl WHERE invoice_id = $1',
        [id]
      );

      // Calculate totals
      const totals = itemsResult.rows.reduce(
        (acc, item) => {
          const amt = Number(item.amount) || 0;
          const discount = Number(item.discount_amount) || 0;
          const penalty = Number(item.penalty_amount) || 0;
          const taxPct = Number(item.tax_percentage) || 0;
          const taxableBase = amt - discount + penalty;
          const tax = taxableBase * (taxPct / 100);
          acc.subtotal += amt;
          acc.discount += discount;
          acc.penalty += penalty;
          acc.tax += tax;
          return acc;
        },
        { subtotal: 0, discount: 0, penalty: 0, tax: 0 }
      );
      const grandTotal = totals.subtotal - totals.discount + totals.penalty + totals.tax;

      // Get total payments
      const paymentsResult = await client.query(
        `SELECT COALESCE(SUM(payable_amount), 0) as total_payments
         FROM paymentstbl
         WHERE invoice_id = $1`,
        [id]
      );
      const totalPayments = Number(paymentsResult.rows[0]?.total_payments || 0);
      const outstandingBalance = grandTotal - totalPayments;

      // Get class name if invoice is linked to enrollment
      let className = null;
      try {
        const enrollmentResult = await client.query(
          `SELECT c.class_name
           FROM enrollmentstbl e
           JOIN classestbl c ON e.class_id = c.class_id
           JOIN invoicestudentstbl inv_student ON e.student_id = inv_student.student_id
           WHERE inv_student.invoice_id = $1
           LIMIT 1`,
          [id]
        );
        if (enrollmentResult.rows.length > 0) {
          className = enrollmentResult.rows[0].class_name;
        }
      } catch (err) {
        // Class name is optional, continue without it
        console.warn('Could not fetch class name for invoice:', err);
      }

      // Import email service
      const { sendOverduePaymentReminderEmail } = await import('../utils/emailService.js');

      // Send email to each student
      const emailResults = [];
      for (const student of studentsResult.rows) {
        // Send to BOTH: guardian email (if exists) and the student's registered email
        const guardianResult = await client.query(
          `SELECT guardian_name, email
           FROM guardianstbl
           WHERE student_id = $1
           ORDER BY guardian_id ASC
           LIMIT 1`,
          [student.student_id]
        );
        const guardian = guardianResult.rows[0] || null;
        const parentName = guardian?.guardian_name || null;
        const recipientEmails = Array.from(
          new Set([guardian?.email, student.email].filter((e) => e && String(e).trim() !== ''))
        );

        if (recipientEmails.length === 0) {
          emailResults.push({
            student_id: student.student_id,
            student_name: student.full_name,
            success: false,
            message: 'No email address found for guardian or student',
          });
          continue;
        }

        try {
          await sendOverduePaymentReminderEmail({
            to: recipientEmails,
            parentName,
            studentName: student.full_name,
            invoiceId: invoice.invoice_id,
            invoiceNumber: invoice.invoice_description || `INV-${invoice.invoice_id}`,
            invoiceDescription: invoice.invoice_description || `INV-${invoice.invoice_id}`,
            amount: outstandingBalance,
            dueDate: invoice.due_date,
            className: className,
            centerName: invoice.branch_name || null,
            facebookLink: 'https://www.facebook.com/littlechampionsacademy',
          });

          emailResults.push({
            student_id: student.student_id,
            student_name: student.full_name,
            email: recipientEmails,
            success: true,
            message: 'Email sent successfully',
          });
        } catch (emailError) {
          console.error(`Error sending email to ${recipientEmails.join(', ')}:`, emailError);
          emailResults.push({
            student_id: student.student_id,
            student_name: student.full_name,
            email: recipientEmails,
            success: false,
            message: emailError.message || 'Failed to send email',
          });
        }
      }

      const successCount = emailResults.filter(r => r.success).length;
      const failCount = emailResults.filter(r => !r.success).length;

      res.json({
        success: true,
        message: `Email sent to ${successCount} student(s). ${failCount > 0 ? `${failCount} failed.` : ''}`,
        results: emailResults,
      });
    } catch (error) {
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * POST /api/sms/invoices
 * Create new invoice with items and students
 * Access: Superadmin, Admin
 */
router.post(
  '/',
  [
    body('invoice_description').optional().isString().withMessage('Invoice description must be a string'),
    body('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    body('amount').optional().isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
    body('status').optional().isString().withMessage('Status must be a string'),
    body('remarks').optional().isString().withMessage('Remarks must be a string'),
    body('issue_date').optional().isISO8601().withMessage('Issue date must be a valid date'),
    body('due_date').optional().isISO8601().withMessage('Due date must be a valid date'),
    body('items').optional().isArray().withMessage('Items must be an array'),
    body('students').optional().isArray().withMessage('Students must be an array'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const {
        invoice_description,
        branch_id,
        amount,
        status,
        remarks,
        issue_date,
        due_date,
        items = [],
        students = [],
      } = req.body;

      // Verify branch exists if provided
      if (branch_id) {
        const branchCheck = await client.query('SELECT branch_id FROM branchestbl WHERE branch_id = $1', [branch_id]);
        if (branchCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Branch not found',
          });
        }
      }

      // Get created_by from authenticated user
      const createdBy = req.user.userId || null;

      // Create invoice with temporary description (will be updated with INV-{invoice_id})
      const invoiceResult = await client.query(
        `INSERT INTO invoicestbl (invoice_description, branch_id, amount, status, remarks, issue_date, due_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          'TEMP', // Temporary description, will be updated with INV-{invoice_id}
          branch_id || null,
          amount || null,
          status || 'Draft',
          remarks || null,
          issue_date || null,
          due_date || null,
          createdBy,
        ]
      );

      const newInvoice = invoiceResult.rows[0];

      // Update invoice description with format INV-{invoice_id}
      await client.query(
        `UPDATE invoicestbl SET invoice_description = $1 WHERE invoice_id = $2`,
        [`INV-${newInvoice.invoice_id}`, newInvoice.invoice_id]
      );

      // Update the invoice object with the new description
      newInvoice.invoice_description = `INV-${newInvoice.invoice_id}`;

      // Create invoice items if provided
      if (items && items.length > 0) {
        for (const item of items) {
          const { description, amount, tax_item, tax_percentage, discount_amount, penalty_amount } = item;
          await client.query(
            `INSERT INTO invoiceitemstbl (invoice_id, description, amount, tax_item, tax_percentage, discount_amount, penalty_amount)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              newInvoice.invoice_id,
              description || null,
              amount || null,
              tax_item || null,
              tax_percentage || null,
              discount_amount || null,
              penalty_amount || null,
            ]
          );
        }
      }

      // Create invoice students if provided
      if (students && students.length > 0) {
        for (const studentId of students) {
          // Verify student exists
          const studentCheck = await client.query('SELECT user_id FROM userstbl WHERE user_id = $1', [studentId]);
          if (studentCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `Student with ID ${studentId} not found`,
            });
          }

          await client.query(
            'INSERT INTO invoicestudentstbl (invoice_id, student_id) VALUES ($1, $2)',
            [newInvoice.invoice_id, studentId]
          );
        }
      }

      await client.query('COMMIT');

      // Fetch the complete invoice with details
      const itemsResult = await query(
        'SELECT * FROM invoiceitemstbl WHERE invoice_id = $1',
        [newInvoice.invoice_id]
      );

      const studentsResult = await query(
        'SELECT inv_student.*, u.full_name, u.email FROM invoicestudentstbl inv_student JOIN userstbl u ON inv_student.student_id = u.user_id WHERE inv_student.invoice_id = $1',
        [newInvoice.invoice_id]
      );

      res.status(201).json({
        success: true,
        message: 'Invoice created successfully',
        data: {
          ...newInvoice,
          items: itemsResult.rows,
          students: studentsResult.rows,
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
 * PUT /api/sms/invoices/:id
 * Update invoice
 * Access: Superadmin, Admin
 */
router.put(
  '/:id',
  [
    param('id').isInt().withMessage('Invoice ID must be an integer'),
    body('invoice_description').optional().isString().withMessage('Invoice description must be a string'),
    body('amount').optional().isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
    body('status').optional().isString().withMessage('Status must be a string'),
    body('remarks').optional().isString().withMessage('Remarks must be a string'),
    body('issue_date').optional().isISO8601().withMessage('Issue date must be a valid date'),
    body('due_date').optional().isISO8601().withMessage('Due date must be a valid date'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { invoice_description, amount, status, remarks, issue_date, due_date, recalculate_amount } = req.body;

      // Check if invoice exists
      const existingInvoice = await query('SELECT * FROM invoicestbl WHERE invoice_id = $1', [id]);
      if (existingInvoice.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Invoice not found',
        });
      }

      // Build update query
      const updates = [];
      const params = [];
      let paramCount = 0;

      const fields = { invoice_description, amount, status, remarks, issue_date, due_date };
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
        const sql = `UPDATE invoicestbl SET ${updates.join(', ')} WHERE invoice_id = $${paramCount} RETURNING *`;
        await query(sql, params);
      }

      // Fetch updated invoice with details
      const invoiceResult = await query('SELECT * FROM invoicestbl WHERE invoice_id = $1', [id]);
      const itemsResult = await query(
        'SELECT * FROM invoiceitemstbl WHERE invoice_id = $1',
        [id]
      );
      const studentsResult = await query(
        'SELECT inv_student.*, u.full_name, u.email FROM invoicestudentstbl inv_student JOIN userstbl u ON inv_student.student_id = u.user_id WHERE inv_student.invoice_id = $1',
        [id]
      );

      res.json({
        success: true,
        message: 'Invoice updated successfully',
        data: {
          ...invoiceResult.rows[0],
          items: itemsResult.rows,
          students: studentsResult.rows,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/sms/invoices/:id
 * Delete invoice and its related records
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('Invoice ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;

      const existingInvoice = await client.query('SELECT * FROM invoicestbl WHERE invoice_id = $1', [id]);
      if (existingInvoice.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Invoice not found',
        });
      }

      // Delete related records first (due to foreign keys)
      await client.query('DELETE FROM invoicestudentstbl WHERE invoice_id = $1', [id]);
      await client.query('DELETE FROM invoiceitemstbl WHERE invoice_id = $1', [id]);
      await client.query('DELETE FROM invoicestbl WHERE invoice_id = $1', [id]);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Invoice deleted successfully',
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
 * POST /api/sms/invoices/:id/items
 * Add an item to an invoice
 * Access: Superadmin, Admin
 */
router.post(
  '/:id/items',
  [
    param('id').isInt().withMessage('Invoice ID must be an integer'),
    body('description').optional().isString().withMessage('Description must be a string'),
    body('amount').optional().isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
    body('tax_item').optional().isString().withMessage('Tax item must be a string'),
    body('tax_percentage').optional().isFloat({ min: 0, max: 100 }).withMessage('Tax percentage must be between 0 and 100'),
    body('discount_amount').optional().isFloat({ min: 0 }).withMessage('Discount amount must be a positive number'),
    body('penalty_amount').optional().isFloat({ min: 0 }).withMessage('Penalty amount must be a positive number'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { description, amount, tax_item, tax_percentage, discount_amount, penalty_amount } = req.body;

      // Check if invoice exists
      const invoiceCheck = await query('SELECT invoice_id FROM invoicestbl WHERE invoice_id = $1', [id]);
      if (invoiceCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Invoice not found',
        });
      }

      const result = await query(
        `INSERT INTO invoiceitemstbl (invoice_id, description, amount, tax_item, tax_percentage, discount_amount, penalty_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [id, description || null, amount || null, tax_item || null, tax_percentage || null, discount_amount || null, penalty_amount || null]
      );

      res.status(201).json({
        success: true,
        message: 'Invoice item added successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/sms/invoices/:id/items/:itemId
 * Remove an item from an invoice
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id/items/:itemId',
  [
    param('id').isInt().withMessage('Invoice ID must be an integer'),
    param('itemId').isInt().withMessage('Item ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    try {
      const { id, itemId } = req.params;

      // Verify item belongs to invoice
      const itemCheck = await query('SELECT * FROM invoiceitemstbl WHERE invoice_item_id = $1 AND invoice_id = $2', [itemId, id]);
      if (itemCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Invoice item not found',
        });
      }

      await query('DELETE FROM invoiceitemstbl WHERE invoice_item_id = $1', [itemId]);

      res.json({
        success: true,
        message: 'Invoice item removed successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sms/invoices/:id/students
 * Add a student to an invoice
 * Access: Superadmin, Admin
 */
router.post(
  '/:id/students',
  [
    param('id').isInt().withMessage('Invoice ID must be an integer'),
    body('student_id').isInt().withMessage('Student ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { student_id } = req.body;

      // Check if invoice exists
      const invoiceCheck = await query('SELECT invoice_id FROM invoicestbl WHERE invoice_id = $1', [id]);
      if (invoiceCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Invoice not found',
        });
      }

      // Verify student exists
      const studentCheck = await query('SELECT user_id FROM userstbl WHERE user_id = $1', [student_id]);
      if (studentCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Student not found',
        });
      }

      // Check if student is already linked to this invoice
      const existingLink = await query(
        'SELECT * FROM invoicestudentstbl WHERE invoice_id = $1 AND student_id = $2',
        [id, student_id]
      );
      if (existingLink.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Student is already linked to this invoice',
        });
      }

      const result = await query(
        'INSERT INTO invoicestudentstbl (invoice_id, student_id) VALUES ($1, $2) RETURNING *',
        [id, student_id]
      );

      res.status(201).json({
        success: true,
        message: 'Student added to invoice successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/sms/invoices/:id/students/:studentId
 * Remove a student from an invoice
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id/students/:studentId',
  [
    param('id').isInt().withMessage('Invoice ID must be an integer'),
    param('studentId').isInt().withMessage('Student ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    try {
      const { id, studentId } = req.params;

      // Verify student is linked to invoice
      const linkCheck = await query(
        'SELECT * FROM invoicestudentstbl WHERE invoice_id = $1 AND student_id = $2',
        [id, studentId]
      );
      if (linkCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Student is not linked to this invoice',
        });
      }

      await query('DELETE FROM invoicestudentstbl WHERE invoice_id = $1 AND student_id = $2', [id, studentId]);

      res.json({
        success: true,
        message: 'Student removed from invoice successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/invoices/student/:studentId
 * Get invoices for a specific student
 * Access: Students (can only view their own invoices)
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

      // Check access permission - students can only view their own invoices
      if (parseInt(studentId) !== parseInt(studentUserId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view your own invoices.',
        });
      }

      // Get invoices where the student is linked
      const invoicesResult = await query(
        `SELECT DISTINCT i.invoice_id, i.invoice_description, i.branch_id, i.amount, i.status, i.remarks, 
                TO_CHAR(i.issue_date, 'YYYY-MM-DD') as issue_date, 
                TO_CHAR(i.due_date, 'YYYY-MM-DD') as due_date, 
                i.created_by
         FROM invoicestbl i
         INNER JOIN invoicestudentstbl inv_student ON i.invoice_id = inv_student.invoice_id
         WHERE inv_student.student_id = $1
         ORDER BY i.invoice_id DESC`,
        [studentId]
      );

      // Fetch invoice items and students for each invoice
      const invoicesWithDetails = await Promise.all(
        invoicesResult.rows.map(async (invoice) => {
          try {
            const itemsResult = await query(
              'SELECT * FROM invoiceitemstbl WHERE invoice_id = $1',
              [invoice.invoice_id]
            );
            
            const studentsResult = await query(
              'SELECT inv_student.*, u.full_name, u.email FROM invoicestudentstbl inv_student LEFT JOIN userstbl u ON inv_student.student_id = u.user_id WHERE inv_student.invoice_id = $1',
              [invoice.invoice_id]
            );

            return {
              ...invoice,
              items: itemsResult.rows || [],
              students: studentsResult.rows || [],
            };
          } catch (err) {
            console.error(`Error fetching details for invoice ${invoice.invoice_id}:`, err);
            return {
              ...invoice,
              items: [],
              students: [],
            };
          }
        })
      );

      res.json({
        success: true,
        data: invoicesWithDetails,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

