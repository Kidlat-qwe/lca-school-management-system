import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import pool, { query, getClient } from '../config/database.js';
import { insertInvoiceWithArNumber } from '../utils/invoiceArNumber.js';
import {
  getChainFinancialSummary,
  getChainRootInvoiceId,
  resolveInvoiceDisplayDescription,
} from '../utils/balanceInvoice.js';
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
    queryValidator('issue_date_from').optional().isISO8601().withMessage('issue_date_from must be YYYY-MM-DD'),
    queryValidator('issue_date_to').optional().isISO8601().withMessage('issue_date_to must be YYYY-MM-DD'),
    queryValidator('created_date_from').optional().isISO8601().withMessage('created_date_from must be YYYY-MM-DD'),
    queryValidator('created_date_to').optional().isISO8601().withMessage('created_date_to must be YYYY-MM-DD'),
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

      const { branch_id, status } = req.query;
      const issueDateFrom = req.query.issue_date_from ? String(req.query.issue_date_from).trim().slice(0, 10) : '';
      const issueDateTo = req.query.issue_date_to ? String(req.query.issue_date_to).trim().slice(0, 10) : '';
      const useIssueRange = Boolean(issueDateFrom || issueDateTo);
      const createdDateFrom = req.query.created_date_from ? String(req.query.created_date_from).trim().slice(0, 10) : '';
      const createdDateTo = req.query.created_date_to ? String(req.query.created_date_to).trim().slice(0, 10) : '';
      const useCreatedRange = Boolean(createdDateFrom || createdDateTo);

      let sql = `SELECT i.invoice_id, i.invoice_description, i.branch_id, i.amount, i.status, i.remarks, 
                       TO_CHAR(i.issue_date, 'YYYY-MM-DD') as issue_date, 
                       TO_CHAR(i.due_date, 'YYYY-MM-DD') as due_date, 
                       (
                         SELECT TO_CHAR(MAX(p.issue_date), 'YYYY-MM-DD')
                         FROM paymenttbl p
                         WHERE p.invoice_id = i.invoice_id
                           AND p.status = 'Completed'
                           AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'
                       ) AS last_payment_date,
                        i.created_by,
                        i.installmentinvoiceprofiles_id,
                        i.parent_invoice_id, i.balance_invoice_id, i.invoice_chain_root_id,
                        i.ack_receipt_id,
                        i.invoice_ar_number,
                        ar.prospect_student_name as ar_prospect_student_name,
                        CASE
                          WHEN i.status IN ('Unpaid', 'Pending', 'Draft') AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE
                          THEN 'Unpaid'
                          ELSE i.status
                        END as computed_status
                 FROM invoicestbl i
                 LEFT JOIN acknowledgement_receiptstbl ar ON ar.invoice_id = i.invoice_id
                 WHERE 1=1`;
      const params = [];
      let paramCount = 0;

      // Filter by branch (non-superadmin users are limited to their branch)
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        paramCount++;
        sql += ` AND i.branch_id = $${paramCount}`;
        params.push(req.user.branchId);
      } else if (branch_id) {
        paramCount++;
        sql += ` AND i.branch_id = $${paramCount}`;
        params.push(branch_id);
      }

      if (status) {
        paramCount++;
        sql += ` AND i.status = $${paramCount}`;
        params.push(status);
      }

      if (useIssueRange) {
        if (issueDateFrom && issueDateTo && issueDateFrom > issueDateTo) {
          return res.status(400).json({
            success: false,
            message: 'issue_date_from must be on or before issue_date_to',
          });
        }
        if (issueDateFrom) {
          paramCount++;
          sql += ` AND i.issue_date >= $${paramCount}::date`;
          params.push(issueDateFrom);
        }
        if (issueDateTo) {
          paramCount++;
          sql += ` AND i.issue_date <= $${paramCount}::date`;
          params.push(issueDateTo);
        }
      }

      if (useCreatedRange) {
        if (createdDateFrom && createdDateTo && createdDateFrom > createdDateTo) {
          return res.status(400).json({
            success: false,
            message: 'created_date_from must be on or before created_date_to',
          });
        }
        if (createdDateFrom) {
          paramCount++;
          sql += ` AND i.created_at::date >= $${paramCount}::date`;
          params.push(createdDateFrom);
        }
        if (createdDateTo) {
          paramCount++;
          sql += ` AND i.created_at::date <= $${paramCount}::date`;
          params.push(createdDateTo);
        }
      }

      // Return all matching invoices, ordered from newest to oldest
      sql += ' ORDER BY invoice_id DESC';

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

            // For AR-linked invoices (e.g. merchandise), use prospect_student_name from AR instead of Walk-in Customer
            let arProspectName = null;
            if (invoice.ack_receipt_id) {
              const arResult = await query(
                'SELECT prospect_student_name FROM acknowledgement_receiptstbl WHERE ack_receipt_id = $1',
                [invoice.ack_receipt_id]
              );
              arProspectName = arResult.rows[0]?.prospect_student_name || null;
            }
            const studentsWithDisplayName = (studentsResult.rows || []).map((s) => {
              const isWalkIn = (s.email || '').toLowerCase() === 'walkin@merchandise.psms.internal';
              return {
                ...s,
                full_name: isWalkIn && (arProspectName || invoice.ar_prospect_student_name)
                  ? (arProspectName || invoice.ar_prospect_student_name)
                  : (s.full_name || '-'),
              };
            });

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

            const items = itemsResult.rows || [];
            const baseAmountFromItems = items.length > 0
              ? Math.max(
                  0,
                  items.reduce(
                    (sum, i) =>
                      sum +
                      (Number(i.amount) || 0) -
                      (Number(i.discount_amount) || 0) +
                      (Number(i.penalty_amount) || 0),
                    0
                  )
                )
              : null;

            const paymentsResult = await query(
              `SELECT COALESCE(SUM(payable_amount), 0) AS total_paid,
                      COALESCE(SUM(COALESCE(payable_amount, 0) + COALESCE(discount_amount, 0)), 0) AS total_settled,
                      COALESCE(SUM(COALESCE(tip_amount, 0)), 0) AS total_tip
               FROM paymenttbl
               WHERE invoice_id = $1
                 AND status = 'Completed'
                 AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
              [invoice.invoice_id]
            );
            const totalPaid = Number(paymentsResult.rows[0]?.total_paid || 0);
            const totalSettled = Number(paymentsResult.rows[0]?.total_settled || totalPaid);
            const totalTip = Number(paymentsResult.rows[0]?.total_tip || 0);

            // For itemized invoices, compute remaining from items - completed payments.
            // For non-itemized/manual invoices, invoicestbl.amount is already treated as remaining.
            const effectiveAmount =
              baseAmountFromItems !== null
                ? Math.max(0, baseAmountFromItems - totalSettled)
                : Number(invoice.amount) || 0;

            const canRecordPayment =
              !invoice.balance_invoice_id &&
              invoice.status !== 'Balance Invoiced' &&
              invoice.status !== 'Paid' &&
              invoice.status !== 'Cancelled';
            const displayDescription = await resolveInvoiceDisplayDescription(pool, invoice);
            let chainSummary = null;
            if (invoice.parent_invoice_id || invoice.balance_invoice_id || invoice.invoice_chain_root_id) {
              try {
                chainSummary = await getChainFinancialSummary(pool, invoice.invoice_id);
              } catch (chainError) {
                console.error(`getChainFinancialSummary for invoice ${invoice.invoice_id}:`, chainError);
              }
            }
            let effectiveStatus = invoice.computed_status || invoice.status;
            if (
              invoice.balance_invoice_id &&
              totalSettled > 0 &&
              effectiveStatus !== 'Paid' &&
              effectiveStatus !== 'Cancelled'
            ) {
              effectiveStatus = 'Partially Paid';
            } else if (
              chainSummary &&
              Number(chainSummary.leaf_invoice_id) === Number(invoice.invoice_id) &&
              invoice.parent_invoice_id &&
              !invoice.balance_invoice_id &&
              effectiveStatus !== 'Paid' &&
              effectiveStatus !== 'Cancelled' &&
              Number(chainSummary.total_paid_in_chain) > 0 &&
              Number(chainSummary.remaining_on_leaf) > 0
            ) {
              effectiveStatus = 'Balance Invoiced';
            }

            return {
              ...invoice,
              amount: effectiveAmount,
              status: effectiveStatus,
              display_description: displayDescription,
              paid_amount:
                effectiveStatus === 'Balance Invoiced'
                  ? Number(chainSummary?.total_paid_in_chain ?? totalPaid)
                  : totalPaid,
              total_tip_amount: totalTip,
              total_received_amount:
                (effectiveStatus === 'Balance Invoiced'
                  ? Number(chainSummary?.total_paid_in_chain ?? totalPaid)
                  : totalPaid) + totalTip,
              balance_invoice_amount:
                effectiveStatus === 'Balance Invoiced'
                  ? Number(chainSummary?.remaining_on_leaf ?? effectiveAmount)
                  : null,
              items,
              students: studentsWithDisplayName,
              can_record_payment: canRecordPayment,
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

      // For AR-linked invoices, use prospect_student_name from AR instead of Walk-in Customer
      let arProspectName = null;
      const invoiceRow = result.rows[0];
      if (invoiceRow.ack_receipt_id) {
        const arResult = await query(
          'SELECT prospect_student_name FROM acknowledgement_receiptstbl WHERE ack_receipt_id = $1',
          [invoiceRow.ack_receipt_id]
        );
        arProspectName = arResult.rows[0]?.prospect_student_name || null;
      }
      const studentsWithDisplayName = (studentsResult.rows || []).map((s) => {
        const isWalkIn = (s.email || '').toLowerCase() === 'walkin@merchandise.psms.internal';
        return {
          ...s,
          full_name: isWalkIn && arProspectName ? arProspectName : (s.full_name || '-'),
        };
      });

      const resChainRootId = await getChainRootInvoiceId(pool, id);

      // Check if this invoice is linked to a reservation
      const reservationResult = await query(
        `SELECT r.reserved_id, r.status as reservation_status, r.due_date as reservation_due_date,
                r.expired_at, TO_CHAR(r.due_date, 'YYYY-MM-DD') as reservation_due_date_str,
                c.class_name, u.full_name as student_name
         FROM reservedstudentstbl r
         LEFT JOIN classestbl c ON r.class_id = c.class_id
         LEFT JOIN userstbl u ON r.student_id = u.user_id
         WHERE r.invoice_id = $1 OR r.invoice_id = $2`,
        [id, resChainRootId]
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

      const items = itemsResult.rows || [];
      const baseAmountFromItems = items.length > 0
        ? Math.max(
            0,
            items.reduce(
              (sum, i) =>
                sum +
                (Number(i.amount) || 0) -
                (Number(i.discount_amount) || 0) +
                (Number(i.penalty_amount) || 0),
              0
            )
          )
        : null;

      const paymentsResult = await query(
              `SELECT COALESCE(SUM(payable_amount), 0) AS total_paid,
                      COALESCE(SUM(COALESCE(payable_amount, 0) + COALESCE(discount_amount, 0)), 0) AS total_settled,
                COALESCE(SUM(COALESCE(tip_amount, 0)), 0) AS total_tip
         FROM paymenttbl
         WHERE invoice_id = $1
           AND status = 'Completed'
           AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
        [id]
      );
      const totalPaid = Number(paymentsResult.rows[0]?.total_paid || 0);
      const totalSettled = Number(paymentsResult.rows[0]?.total_settled || totalPaid);
      const totalTip = Number(paymentsResult.rows[0]?.total_tip || 0);

      const effectiveAmount =
        baseAmountFromItems !== null
          ? Math.max(0, baseAmountFromItems - totalSettled)
          : Number(invoiceRow.amount) || 0;

      let chainSummary = null;
      try {
        chainSummary = await getChainFinancialSummary(pool, id);
      } catch (e) {
        console.error('getChainFinancialSummary:', e);
      }
      let effectiveStatus = invoiceRow.status;
      if (
        invoiceRow.balance_invoice_id &&
        totalSettled > 0 &&
        effectiveStatus !== 'Paid' &&
        effectiveStatus !== 'Cancelled'
      ) {
        effectiveStatus = 'Partially Paid';
      } else if (
        chainSummary &&
        Number(chainSummary.leaf_invoice_id) === Number(invoiceRow.invoice_id) &&
        invoiceRow.parent_invoice_id &&
        !invoiceRow.balance_invoice_id &&
        effectiveStatus !== 'Paid' &&
        effectiveStatus !== 'Cancelled' &&
        Number(chainSummary.total_paid_in_chain) > 0 &&
        Number(chainSummary.remaining_on_leaf) > 0
      ) {
        effectiveStatus = 'Balance Invoiced';
      }

      const displayDescription = await resolveInvoiceDisplayDescription(pool, invoiceRow);

      let continuedToInvoice = null;
      if (invoiceRow.balance_invoice_id) {
        const tip = await query(
          `SELECT * FROM invoicestbl WHERE invoice_id = $1`,
          [invoiceRow.balance_invoice_id]
        );
        continuedToInvoice = tip.rows[0]
          ? {
              ...tip.rows[0],
              display_description: await resolveInvoiceDisplayDescription(pool, tip.rows[0]),
            }
          : null;
      }

      const canRecordPayment =
        !invoiceRow.balance_invoice_id &&
        invoiceRow.status !== 'Balance Invoiced' &&
        invoiceRow.status !== 'Paid' &&
        invoiceRow.status !== 'Cancelled';

      res.json({
        success: true,
        data: {
          ...invoiceRow,
          status: effectiveStatus,
          amount: effectiveAmount,
          total_tip_amount: totalTip,
          total_received_amount: totalPaid + totalTip,
          last_payment_date: (
            await query(
              `SELECT TO_CHAR(MAX(p.issue_date), 'YYYY-MM-DD') AS last_payment_date
               FROM paymenttbl p
               WHERE p.invoice_id = $1
                 AND p.status = 'Completed'
                 AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'`,
              [id]
            )
          ).rows?.[0]?.last_payment_date || null,
          display_description: displayDescription,
          items,
          students: studentsWithDisplayName,
          chain_summary: chainSummary,
          continued_to_invoice: continuedToInvoice,
          can_record_payment: canRecordPayment,
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
 * Download invoice, SOA, or AR as PDF
 */
router.get(
  '/:id/pdf',
  [
    param('id').isInt().withMessage('Invoice ID must be an integer'),
    queryValidator('doc_type').optional().isIn(['invoice', 'soa', 'ar']).withMessage('doc_type must be invoice, soa, or ar'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const docType = ['invoice', 'soa', 'ar'].includes(req.query?.doc_type) ? req.query.doc_type : 'invoice';
      const isSoa = docType === 'soa';
      const isAr = docType === 'ar';

      // Fetch invoice
      const invoiceResult = await query(
        `SELECT invoice_id, invoice_ar_number, invoice_description, branch_id, amount, status, remarks,
                installmentinvoiceprofiles_id,
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
          `SELECT
             COALESCE(branch_nickname, branch_name) AS branch_name,
             branch_address,
             branch_phone_number,
             branch_email
           FROM branchestbl
           WHERE branch_id = $1`,
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

      // Fetch class label(s) for AR: program_code + level_tag of linked student(s)
      let arClassLabel = '-';
      const invoiceStudentIds = (studentsResult.rows || [])
        .map((s) => Number(s.student_id))
        .filter((idVal) => Number.isInteger(idVal) && idVal > 0);

      if (invoiceStudentIds.length > 0) {
        const classLabelResult = await query(
          `SELECT DISTINCT ON (cs.student_id)
              cs.student_id,
              NULLIF(TRIM(p.program_code), '') AS program_code,
              NULLIF(TRIM(c.level_tag), '') AS level_tag
           FROM classstudentstbl cs
           INNER JOIN classestbl c ON cs.class_id = c.class_id
           LEFT JOIN programstbl p ON c.program_id = p.program_id
           WHERE cs.student_id = ANY($1::int[])
           ORDER BY cs.student_id, cs.classstudent_id DESC`,
          [invoiceStudentIds]
        );

        const labels = classLabelResult.rows
          .map((row) => {
            const code = row.program_code || '-';
            const levelTag = row.level_tag || '-';
            return `${code} - ${levelTag}`;
          })
          .filter(Boolean);

        if (labels.length > 0) {
          arClassLabel = Array.from(new Set(labels)).join(', ');
        }
      }

      // Fetch payments for this invoice (and compute the actual recorded payment date)
      const paymentsResult = await query(
        `SELECT p.payment_method, p.payment_type, p.payable_amount, COALESCE(p.discount_amount, 0) AS discount_amount, p.reference_number,
                TO_CHAR(p.issue_date, 'YYYY-MM-DD') as payment_date_raw
         FROM paymenttbl p
         WHERE p.invoice_id = $1
           AND p.status = 'Completed'
           AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'
         ORDER BY p.issue_date DESC`,
        [id]
      );
      const lastPaymentDateResult = await query(
        `SELECT TO_CHAR(MAX(p.issue_date), 'YYYY-MM-DD') AS last_payment_ymd
         FROM paymenttbl p
         WHERE p.invoice_id = $1
           AND p.status = 'Completed'
           AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'`,
        [id]
      );
      const lastPaymentYmd = lastPaymentDateResult.rows?.[0]?.last_payment_ymd || null;

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
      const totalPayments = paymentsResult.rows.reduce(
        (sum, p) => sum + (Number(p.payable_amount) || 0) + (Number(p.discount_amount) || 0),
        0
      );
      const amountDue = grandTotal - totalPayments;

      const doc = new PDFDocument({ margin: 40, size: 'A4', layout: isAr ? 'landscape' : 'portrait' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=${isAr ? 'acknowledgement-receipt' : isSoa ? 'soa' : 'invoice'}-${id}.pdf`);

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

      if (isAr) {
        const pageWidth = doc.page.width;
        const left = 40;
        const right = pageWidth - 40;
        const contentWidth = right - left;
        let y = 42;

        // Prefer AR prospect_student_name (merchandise flow) and avoid "Walk-in Customer" placeholder.
        let studentName = 'No student linked';
        try {
          // 1) AR-provided prospect name (most reliable for merchandise ARs)
          let arProspectStudentName = '';
          try {
            const arNameRes = await query(
              `SELECT NULLIF(TRIM(ar.prospect_student_name), '') AS prospect_student_name
               FROM acknowledgement_receiptstbl ar
               WHERE ar.invoice_id = $1
               ORDER BY ar.ack_receipt_id DESC
               LIMIT 1`,
              [id]
            );
            arProspectStudentName = String(arNameRes.rows[0]?.prospect_student_name || '').trim();
          } catch {
            arProspectStudentName = '';
          }

          if (arProspectStudentName) {
            studentName = arProspectStudentName;
          } else {
            // 2) Latest completed payment student, but ignore walk-in placeholder user
            const payNameRes = await query(
              `SELECT u.full_name, u.email
             FROM paymenttbl p
             LEFT JOIN userstbl u ON p.student_id = u.user_id
             WHERE p.invoice_id = $1
               AND p.status = 'Completed'
               AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'
             ORDER BY p.payment_id DESC
             LIMIT 1`,
              [id]
            );

            const paymentStudentName = String(payNameRes.rows[0]?.full_name || '').trim();
            const paymentStudentEmail = String(payNameRes.rows[0]?.email || '').trim().toLowerCase();
            const isWalkInPaymentStudent =
              paymentStudentEmail === 'walkin@merchandise.psms.internal' ||
              paymentStudentName.toLowerCase() === 'walk-in customer';

            if (paymentStudentName && !isWalkInPaymentStudent) {
              studentName = paymentStudentName;
            } else if (studentsResult.rows.length > 0) {
              // 3) Invoice-linked students, skipping walk-in placeholder if possible
              const names = (studentsResult.rows || [])
                .map((s) => String(s?.full_name || '').trim())
                .filter(Boolean)
                .filter((n) => n.toLowerCase() !== 'walk-in customer');
              if (names.length > 0) {
                studentName = names.join(', ');
              }
            }
          }
        } catch {
          if (studentsResult.rows.length > 0) {
            const names = (studentsResult.rows || [])
              .map((s) => String(s?.full_name || '').trim())
              .filter(Boolean)
              .filter((n) => n.toLowerCase() !== 'walk-in customer');
            if (names.length > 0) {
              studentName = names.join(', ');
            }
          }
        }
        const classLabel = arClassLabel;
        const arNumber = invoice.invoice_ar_number || `AR-${invoice.invoice_id}`;
        // For AR, show actual payment date (Manila-normalized), not scheduled invoice issue_date.
        // Use the pre-formatted YMD string to avoid timezone day shifts.
        const arDate = formatDate(lastPaymentYmd || invoice.issue_date) || '-';
        const amountPaid = Math.max(0, totalPayments || 0);

        // Header
        doc.font('Helvetica-Bold').fontSize(19).fillColor('#111827')
          .text('ACKNOWLEDGEMENT RECEIPT', left, y, { width: contentWidth, align: 'right' });
        y += 6;

        if (hasLogo) {
          doc.image(logoPath, left, y + 4, { width: 42, height: 42 });
        }
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#111827')
          .text('Little Champions Academy Inc.', hasLogo ? left + 52 : left, y + 6, { width: 360 });
        doc.font('Helvetica').fontSize(9).fillColor('#374151')
          .text(branchInfo?.branch_address || '-', hasLogo ? left + 52 : left, y + 24, { width: 360 });
        doc.font('Helvetica').fontSize(9).fillColor('#374151')
          .text(`Contact: ${branchInfo?.branch_phone_number || '-'}`, hasLogo ? left + 52 : left, y + 36, { width: 360 });
        doc.font('Helvetica').fontSize(9).fillColor('#374151')
          .text(`Email: ${branchInfo?.branch_email || '-'}`, hasLogo ? left + 52 : left, y + 48, { width: 360 });

        doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827')
          .text(`No. ${arNumber}`, right - 180, y + 34, { width: 180, align: 'right' });
        y += 74;

        // Receipt meta
        const metaStartY = y;
        doc.font('Helvetica').fontSize(10).fillColor('#111827');
        doc.text(`DATE: ${arDate}`, right - 230, metaStartY, { width: 230, align: 'right' });
        doc.text(`STUDENT NAME: ${studentName}`, left, metaStartY, { width: contentWidth - 20 });
        y += 20;
        doc.text(`CLASS: ${classLabel}`, left, y, { width: 320 });
        y += 24;

        // Table
        const tLeft = left;
        const tWidth = contentWidth;
        const rowH = 24;
        const headerH = 24;
        const detailRows = 5;
        const footerRows = 1;
        const totalRows = detailRows + footerRows;
        // Layout (post-MONTH-removal): DESCRIPTION 50% | RATE 25% | AMOUNT 25%
        const descW = tWidth * 0.50;
        const rateW = tWidth * 0.25;
        const amountW = tWidth - descW - rateW;
        const xDesc = tLeft + 8;
        const xRate = tLeft + descW + 8;
        const xAmount = tLeft + descW + rateW + 8;

        doc.save();
        doc.rect(tLeft, y, tWidth, headerH).fill('#f3f4f6');
        doc.restore();
        doc.rect(tLeft, y, tWidth, headerH + rowH * totalRows).lineWidth(1).strokeColor('#111827').stroke();
        doc.moveTo(tLeft + descW, y).lineTo(tLeft + descW, y + headerH + rowH * totalRows).stroke();
        doc.moveTo(tLeft + descW + rateW, y).lineTo(tLeft + descW + rateW, y + headerH + rowH * totalRows).stroke();

        for (let i = 1; i <= totalRows; i += 1) {
          const yLine = y + headerH + rowH * i;
          doc.moveTo(tLeft, yLine).lineTo(tLeft + tWidth, yLine).stroke();
        }

        doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827');
        doc.text('DESCRIPTION', xDesc, y + 8, { width: descW - 16, align: 'center' });
        doc.text('RATE', xRate, y + 8, { width: rateW - 16, align: 'center' });
        doc.text('AMOUNT', xAmount, y + 8, { width: amountW - 16, align: 'center' });

        const itemDescriptions = items
          .map((item) => (item?.description || '').trim())
          .filter(Boolean);
        const mergedItemDescription = itemDescriptions.length > 0
          ? itemDescriptions.join(' | ')
          : '';
        const invoiceDescription = (invoice.invoice_description || '').trim();
        const looksLikeInvoiceCodeOnly = /^INV-\d+$/i.test(invoiceDescription);
        const firstLineDescription = mergedItemDescription
          || (!looksLikeInvoiceCodeOnly ? invoiceDescription : '')
          || `Invoice INV-${invoice.invoice_id}`;
        doc.font('Helvetica').fontSize(9).fillColor('#111827');
        doc.text(firstLineDescription, xDesc, y + headerH + 8, { width: descW - 16 });
        doc.text(formatCurrency(amountPaid), xRate, y + headerH + 8, { width: rateW - 16, align: 'right' });
        doc.text(formatCurrency(amountPaid), xAmount, y + headerH + 8, { width: amountW - 16, align: 'right' });

        // Footer rows inside the main table container
        const footerRowY = y + headerH + rowH * detailRows + 8;

        doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827')
          .text(`TOTAL  ${formatCurrency(amountPaid)}`, xRate, footerRowY, { width: rateW + amountW - 16, align: 'right' });
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827')
          .text('T  H  A  N  K    Y  O  U  !', xDesc, footerRowY, { width: descW - 16, align: 'center' });

        y += headerH + rowH * totalRows + 24;
        doc.font('Helvetica').fontSize(9).fillColor('#111827');
        doc.text('Prepared by:', left, y);
        doc.moveTo(left + 68, y + 10).lineTo(left + 250, y + 10).stroke();
        doc.text('Received by:', right - 200, y);
        doc.moveTo(right - 118, y + 10).lineTo(right, y + 10).stroke();

        doc.end();
        return;
      }

      if (isSoa) {
        // ----------------------------------------------------------------
        // Statement of Account (portrait, branded)
        //
        // Layout follows the design reference provided by the school:
        // header band -> "Statement of Account" + academy info -> billed-to
        // summary -> program/SY label -> phases table (INSTALLMENT,
        // REG. FEE, MONTHLY FEE, TOTAL PAID) -> total balance/total paid
        // band -> payable-to grid -> terms & conditions footer.
        //
        // When the invoice is part of an installment plan we render
        // EVERY phase in the curriculum (paid + unpaid + not-yet-
        // generated) so the statement reflects the full schedule. For
        // standalone (one-off) invoices we degrade gracefully to a
        // single-row table seeded from invoice items.
        // ----------------------------------------------------------------
        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;
        const left = 40;
        const right = pageWidth - 40;
        const contentWidth = right - left;
        const currency = (v) => `PHP ${(Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const ordinal = (n) => {
          const num = Math.max(0, Number(n) || 0);
          const s = ['th', 'st', 'nd', 'rd'];
          const v = num % 100;
          return `${num}${s[(v - 20) % 10] || s[v] || s[0]}`;
        };

        // ---- Resolve installment plan (if any) -----------------------
        let installmentProfile = null;
        let phases = [];
        let downpaymentRow = null;
        let totalPaid = 0;
        let totalOutstanding = 0;
        let levelTag = null;
        let programName = null;
        let schoolYearLabel = '';

        const profileId = invoice.installmentinvoiceprofiles_id != null
          ? Number(invoice.installmentinvoiceprofiles_id)
          : null;

        if (profileId) {
          try {
            const profileRes = await query(
              `SELECT ip.*,
                      u.full_name AS student_name,
                      u.email AS student_email,
                      p.program_name,
                      c.level_tag,
                      pkg.package_name AS package_description
               FROM installmentinvoiceprofilestbl ip
               LEFT JOIN userstbl u ON ip.student_id = u.user_id
               LEFT JOIN classestbl c ON ip.class_id = c.class_id
               LEFT JOIN programstbl p ON c.program_id = p.program_id
               LEFT JOIN packagestbl pkg ON ip.package_id = pkg.package_id
               WHERE ip.installmentinvoiceprofiles_id = $1`,
              [profileId]
            );
            if (profileRes.rows.length > 0) {
              installmentProfile = profileRes.rows[0];
              levelTag = installmentProfile.level_tag || null;
              programName = installmentProfile.program_name || null;

              const downpaymentInvoiceId = installmentProfile.downpayment_invoice_id != null
                ? Number(installmentProfile.downpayment_invoice_id)
                : null;

              // Pull every invoice linked to this profile so we can
              // build per-phase paid totals (chain-aware: balance/
              // re-billed invoices share a chain with their root).
              const phaseInvoicesRes = await query(
                `SELECT i.invoice_id,
                        i.invoice_description,
                        i.amount,
                        i.status,
                        TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue_date,
                        TO_CHAR(i.due_date, 'YYYY-MM-DD')   AS due_date,
                        COALESCE(i.invoice_chain_root_id, i.invoice_id) AS chain_root_id,
                        COALESCE((
                          SELECT SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.discount_amount, 0))
                          FROM paymenttbl p
                          WHERE p.invoice_id = i.invoice_id
                            AND p.status = 'Completed'
                            AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'
                        ), 0)::numeric AS paid_total_for_invoice
                 FROM invoicestbl i
                 WHERE i.installmentinvoiceprofiles_id = $1
                 ORDER BY i.issue_date ASC NULLS LAST, i.invoice_id ASC`,
                [profileId]
              );

              const chains = new Map();
              for (const inv of phaseInvoicesRes.rows) {
                const chainRoot = Number(inv.chain_root_id);
                if (!chains.has(chainRoot)) {
                  chains.set(chainRoot, {
                    chain_root_id: chainRoot,
                    representative: inv,
                    paid_amount: 0,
                  });
                }
                const chain = chains.get(chainRoot);
                chain.paid_amount += Number(inv.paid_total_for_invoice || 0);
                const currentRep = chain.representative;
                if (
                  (inv.issue_date || '') > (currentRep.issue_date || '') ||
                  ((inv.issue_date || '') === (currentRep.issue_date || '') &&
                    Number(inv.invoice_id) > Number(currentRep.invoice_id))
                ) {
                  chain.representative = inv;
                }
              }

              let downpaymentChain = null;
              const phaseChains = [];
              for (const chain of chains.values()) {
                if (downpaymentInvoiceId && chain.chain_root_id === downpaymentInvoiceId) {
                  downpaymentChain = chain;
                } else {
                  phaseChains.push(chain);
                }
              }
              phaseChains.sort((a, b) => {
                const da = a.representative.issue_date || '';
                const db = b.representative.issue_date || '';
                if (da !== db) return da < db ? -1 : 1;
                return Number(a.chain_root_id) - Number(b.chain_root_id);
              });

              const profilePhaseAmount = installmentProfile.amount != null
                ? Number(installmentProfile.amount)
                : 0;
              const totalPhases = installmentProfile.total_phases != null
                ? Math.max(0, Number(installmentProfile.total_phases))
                : phaseChains.length;
              const phaseRowCount = Math.max(totalPhases, phaseChains.length);

              for (let i = 0; i < phaseRowCount; i += 1) {
                const chain = phaseChains[i] || null;
                if (!chain) {
                  phases.push({
                    phase_number: i + 1,
                    amount: profilePhaseAmount,
                    paid_amount: 0,
                    is_generated: false,
                  });
                } else {
                  const rep = chain.representative;
                  phases.push({
                    phase_number: i + 1,
                    amount: rep.amount != null ? Number(rep.amount) : profilePhaseAmount,
                    paid_amount: Number(chain.paid_amount || 0),
                    is_generated: true,
                  });
                }
              }

              if (downpaymentChain) {
                const rep = downpaymentChain.representative;
                downpaymentRow = {
                  amount: rep.amount != null ? Number(rep.amount) : 0,
                  paid_amount: Number(downpaymentChain.paid_amount || 0),
                };
              }

              const totalPaidPhases = phases.reduce(
                (sum, p) => sum + Number(p.paid_amount || 0),
                0
              );
              const totalPaidDownpayment = downpaymentRow
                ? Number(downpaymentRow.paid_amount || 0)
                : 0;
              totalPaid = totalPaidPhases + totalPaidDownpayment;

              const outstandingGenerated = phases.reduce((sum, p) => {
                if (!p.is_generated) return sum;
                return sum + Math.max(0, Number(p.amount || 0) - Number(p.paid_amount || 0));
              }, 0);
              const outstandingNotGenerated = phases.reduce(
                (sum, p) => sum + (p.is_generated ? 0 : profilePhaseAmount),
                0
              );
              const outstandingDownpayment = downpaymentRow
                ? Math.max(
                    0,
                    Number(downpaymentRow.amount || 0) - Number(downpaymentRow.paid_amount || 0)
                  )
                : 0;
              totalOutstanding = outstandingGenerated + outstandingNotGenerated + outstandingDownpayment;
            }
          } catch (planErr) {
            console.error('SOA: failed to load installment plan', planErr);
          }
        }

        // For non-installment SOAs, surface a single phase row built
        // from the invoice itself so the template still renders.
        if (phases.length === 0 && !downpaymentRow) {
          phases.push({
            phase_number: 1,
            amount: grandTotal,
            paid_amount: totalPayments,
            is_generated: true,
          });
          totalPaid = totalPayments;
          totalOutstanding = Math.max(0, grandTotal - totalPayments);
        }

        // ---- School Year ---------------------------------------------
        // Manila school year typically runs June -> May the following
        // year. Anchor on the earliest issue_date of the plan if
        // available, otherwise fall back to the invoice issue_date /
        // current date.
        const computeSchoolYear = (anchorYmd) => {
          const ref = (() => {
            if (anchorYmd) {
              const d = new Date(anchorYmd);
              if (!Number.isNaN(d.getTime())) return d;
            }
            return new Date();
          })();
          const month = ref.getUTCMonth() + 1;
          const year = ref.getUTCFullYear();
          if (month >= 6) return `${year}-${year + 1}`;
          return `${year - 1}-${year}`;
        };
        const planAnchor = (() => {
          if (phases.length > 0 && installmentProfile) {
            // Earliest issue date among generated phases, if any.
            // (Not stored on phases array; fall back to invoice.)
          }
          return invoice.issue_date || null;
        })();
        schoolYearLabel = computeSchoolYear(planAnchor);

        // ---- Billed-to ------------------------------------------------
        const billedToName = (() => {
          if (installmentProfile?.student_name) return installmentProfile.student_name;
          if (studentsResult.rows.length > 0) {
            return studentsResult.rows.map((s) => s.full_name || 'Student').join(', ');
          }
          return 'No student linked';
        })();
        const billedToEmail = (() => {
          if (installmentProfile?.student_email) return installmentProfile.student_email;
          if (studentsResult.rows.length > 0) {
            const emails = studentsResult.rows.map((s) => s.email).filter(Boolean);
            if (emails.length > 0) return emails.join(', ');
          }
          return '';
        })();
        const programLabel = (() => {
          const lvl = (levelTag || '').trim();
          const prog = (programName || '').trim();
          const head = lvl || prog || (installmentProfile?.package_description || '').trim() || 'Program';
          return `${head} Program S.Y. ${schoolYearLabel}`;
        })();

        // ---- Brand colors --------------------------------------------
        const colorBrand = '#f5b800'; // warm gold accent (top/bottom band, table header bg)
        const colorBrandSoft = '#fde9a3';
        const colorTotalsBand = '#f6a623';
        const colorTextPrimary = '#1f2937';
        const colorTextMuted = '#4b5563';

        // ===== Top brand band =========================================
        let y = 0;
        doc.save();
        doc.rect(0, 0, pageWidth, 22).fill(colorBrand);
        doc.restore();
        y = 32;

        // ===== Header (title + logo) ==================================
        // Logo on right, branding on left.
        if (hasLogo) {
          try {
            doc.image(logoPath, right - 70, y - 4, { width: 70, height: 70 });
          } catch {
            // ignore logo render errors
          }
        }
        doc.font('Times-Italic').fontSize(28).fillColor(colorTextPrimary)
          .text('Statement of Account', left, y, { width: contentWidth - 90 });
        y += 36;
        doc.font('Helvetica-Bold').fontSize(15).fillColor(colorTextPrimary)
          .text('LITTLE CHAMPIONS ACADEMY INC.', left, y, { width: contentWidth - 90 });
        y += 18;
        doc.font('Helvetica').fontSize(9).fillColor(colorTextMuted)
          .text(branchInfo?.branch_address || '4th Level, Vista Mall Malolos, Bulacan', left, y, {
            width: contentWidth - 90,
          });
        y += 12;
        doc.font('Helvetica').fontSize(9).fillColor(colorTextMuted)
          .text('www.little-champions.com', left, y, { width: contentWidth - 90 });
        y += 28;

        // ===== Billed To strip ========================================
        const billedBoxY = y;
        const billedBoxH = 40;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(colorTextMuted)
          .text('Billed To :', right - 240, billedBoxY, { width: 240, align: 'left' });
        doc.font('Helvetica-Bold').fontSize(13).fillColor(colorTextPrimary)
          .text(billedToName, right - 240, billedBoxY + 12, { width: 240 });
        if (billedToEmail) {
          doc.font('Helvetica').fontSize(9).fillColor(colorTextMuted)
            .text(billedToEmail, right - 240, billedBoxY + 28, { width: 240 });
        }
        y = billedBoxY + billedBoxH + 14;

        // ===== Program / SY label =====================================
        doc.font('Helvetica-Bold').fontSize(13).fillColor(colorTextPrimary)
          .text(programLabel, left, y, { width: contentWidth });
        y += 22;

        // ===== Phases Table ===========================================
        const tableLeft = left;
        const tableRight = right;
        const tableWidth = tableRight - tableLeft;
        // Column widths chosen so the most important number (Total Paid)
        // and the description fit comfortably.
        const colInstallmentW = Math.round(tableWidth * 0.32);
        const colRegFeeW = Math.round(tableWidth * 0.18);
        const colMonthlyW = Math.round(tableWidth * 0.25);
        const colTotalPaidW = tableWidth - colInstallmentW - colRegFeeW - colMonthlyW;
        const colXInstallment = tableLeft;
        const colXRegFee = tableLeft + colInstallmentW;
        const colXMonthly = colXRegFee + colRegFeeW;
        const colXTotalPaid = colXMonthly + colMonthlyW;
        const tableHeaderH = 30;
        const tableRowH = 22;

        // Header
          doc.save();
        doc.roundedRect(tableLeft, y, tableWidth, tableHeaderH, 4).fill(colorBrand);
          doc.restore();
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff');
        const headerTextY = y + tableHeaderH / 2 - 4;
        doc.text('INSTALLMENT', colXInstallment + 10, headerTextY, {
          width: colInstallmentW - 20,
        });
        doc.text('REG. FEE', colXRegFee, headerTextY, {
          width: colRegFeeW,
          align: 'center',
        });
        doc.text('MONTHLY FEE', colXMonthly, headerTextY, {
          width: colMonthlyW,
          align: 'center',
        });
        doc.text('TOTAL PAID', colXTotalPaid, headerTextY, {
          width: colTotalPaidW - 10,
          align: 'right',
        });
        y += tableHeaderH;

        // Body rows: optional downpayment first, then 1st..Nth phase.
        const drawRow = (label, regFee, monthly, paid, opts = {}) => {
          if (y + tableRowH > pageHeight - 220) {
            // Page break (preserve enough room for totals + payable-to
            // band on a new page).
            doc.addPage({ size: 'A4', margin: 40 });
            y = 60;
          }
          if (opts.zebra) {
            doc.save();
            doc.rect(tableLeft, y, tableWidth, tableRowH).fill('#fff8e1');
            doc.restore();
          }
          doc.strokeColor('#e5d68a').lineWidth(0.5);
          doc.moveTo(tableLeft, y + tableRowH).lineTo(tableLeft + tableWidth, y + tableRowH).stroke();

          const textY = y + tableRowH / 2 - 4;
          doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(
            opts.muted ? colorTextMuted : colorTextPrimary
          );
          doc.text(label, colXInstallment + 10, textY, { width: colInstallmentW - 20 });
          doc.text(
            regFee == null ? '-' : (typeof regFee === 'string' ? regFee : currency(regFee)),
            colXRegFee,
            textY,
            { width: colRegFeeW, align: 'center' }
          );
          doc.text(
            monthly == null ? '-' : (typeof monthly === 'string' ? monthly : currency(monthly)),
            colXMonthly,
            textY,
            { width: colMonthlyW, align: 'center' }
          );
          doc.text(
            paid == null ? '-' : (typeof paid === 'string' ? paid : currency(paid)),
            colXTotalPaid,
            textY,
            { width: colTotalPaidW - 10, align: 'right' }
          );
          y += tableRowH;
        };

        if (downpaymentRow) {
          drawRow(
            'Downpayment',
            '0',
            Number(downpaymentRow.amount || 0),
            Number(downpaymentRow.paid_amount || 0),
            { zebra: true, bold: true }
          );
        }
        // Use absolute phase numbering so a profile that starts at phase 6
        // displays "6th Phase ... 10th Phase" instead of "1st Phase ... 5th
        // Phase". Profiles with no phase_start (or starting at 1) are
        // unchanged.
        const soaPhaseStartRaw =
          installmentProfile && installmentProfile.phase_start != null
            ? Number(installmentProfile.phase_start)
            : 1;
        const soaPhaseStartOffset = Math.max(
          0,
          (Number.isFinite(soaPhaseStartRaw) ? soaPhaseStartRaw : 1) - 1
        );
        phases.forEach((phase, idx) => {
          const absolutePhaseNumber = Number(phase.phase_number) + soaPhaseStartOffset;
          const label = `${ordinal(absolutePhaseNumber)} Phase`;
          drawRow(
            label,
            '0',
            Number(phase.amount || 0),
            Number(phase.paid_amount || 0),
            {
              zebra: (idx + (downpaymentRow ? 1 : 0)) % 2 === 1,
              muted: !phase.is_generated,
            }
          );
        });

        y += 8;

        // ===== Totals band ============================================
        const totalsBandH = 38;
        if (y + totalsBandH > pageHeight - 180) {
          doc.addPage({ size: 'A4', margin: 40 });
          y = 60;
        }
        doc.save();
        doc.roundedRect(tableLeft, y, tableWidth, totalsBandH, 4).fill(colorTotalsBand);
        doc.restore();
        const halfW = tableWidth / 2;
        const labelY = y + 8;
        const valueY = y + 21;
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff')
          .text('TOTAL BALANCE DUE:', tableLeft + 14, labelY, { width: halfW - 14 });
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#ffffff')
          .text(currency(totalOutstanding), tableLeft + 14, valueY, { width: halfW - 14 });
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff')
          .text('TOTAL PAID:', tableLeft + halfW, labelY, { width: halfW - 14, align: 'right' });
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#ffffff')
          .text(currency(totalPaid), tableLeft + halfW, valueY, {
            width: halfW - 14,
            align: 'right',
          });
        y += totalsBandH + 18;

        // ===== Payable To grid ========================================
        if (y + 110 > pageHeight - 60) {
          doc.addPage({ size: 'A4', margin: 40 });
          y = 60;
        }
        doc.font('Helvetica-Bold').fontSize(11).fillColor(colorTextPrimary)
          .text('PAYABLE TO:', left, y, { width: contentWidth, align: 'right' });
        y += 16;

        const payableToOptions = [
          {
            label: 'UNIONBANK',
            account: 'RISING HOPE EDUTECH CORPORATION',
            number: '0026 - 4001 - 0150',
          },
          {
            label: 'AUB ACCOUNT',
            account: 'RISING HOPE EDUTECH CORPORATION',
            number: '072-01-001-3081',
          },
          {
            label: 'GCASH',
            account: 'RISING HOPE EDUTECH CORPORATION',
            number: '',
          },
          {
            label: 'PAYMAYA',
            account: 'LITTLE CHAMPIONS GUIGUINTO BULACAN',
            number: '',
          },
        ];
        const cellW = (contentWidth - 12) / 2;
        const cellH = 56;
        payableToOptions.forEach((opt, idx) => {
          const col = idx % 2;
          const row = Math.floor(idx / 2);
          const cx = left + col * (cellW + 12);
          const cy = y + row * (cellH + 10);
              doc.save();
          doc.roundedRect(cx, cy, cellW, cellH, 6).fillAndStroke(colorBrandSoft, '#caa64f');
              doc.restore();
          doc.font('Helvetica-Bold').fontSize(10).fillColor(colorTextPrimary)
            .text(opt.label, cx + 12, cy + 8, { width: cellW - 24 });
          doc.font('Helvetica').fontSize(8.5).fillColor(colorTextPrimary)
            .text(opt.account, cx + 12, cy + 24, { width: cellW - 24 });
          if (opt.number) {
            doc.font('Helvetica').fontSize(8.5).fillColor(colorTextMuted)
              .text(opt.number, cx + 12, cy + 38, { width: cellW - 24 });
          }
        });
        y += cellH * 2 + 10 + 14;

        // ===== Terms ==================================================
        if (y + 30 > pageHeight - 28) {
          doc.addPage({ size: 'A4', margin: 40 });
          y = 60;
        }
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#a16207')
          .text('Terms and Conditions', left, y, { width: contentWidth, align: 'center' });
        y += 14;
        doc.font('Helvetica').fontSize(9).fillColor(colorTextMuted)
          .text('All fees are non-refundable and non-transferable.', left, y, {
            width: contentWidth,
            align: 'center',
          });

        // ===== Bottom brand band ======================================
        doc.save();
        doc.rect(0, pageHeight - 22, pageWidth, 22).fill(colorBrand);
        doc.restore();

        doc.end();
        return;
      }

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

      // Document title on the right
      doc.fontSize(32).fillColor('#000000').font('Helvetica-Bold');
      doc.text(isSoa ? 'SOA' : 'INVOICE', 400, headerY, { align: 'right', width: 150 });

      // Invoice Details Section
      let currentY = headerY + 70;
      doc.fontSize(10).fillColor('#333333').font('Helvetica');
      doc.text(`${isSoa ? 'SOA' : 'Invoice'} Number: INV-${invoice.invoice_id}`, 50, currentY);
      currentY += 12;
      doc.text(`${isSoa ? 'Statement' : 'Invoice'} Date: ${formatDate(invoice.issue_date)}`, 50, currentY);
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
          const paymentType = payment.payment_type || 'Payment';
          const refNum = payment.reference_number || '';
          const paymentDate = payment.payment_date_raw ? formatDate(payment.payment_date_raw) : '';
          const paymentAmount = Number(payment.payable_amount) || 0;
          
          // Payment summary label on the left
          doc.fontSize(9).fillColor('#333333').font('Helvetica');
          const paymentMethodText = `${paymentType} via ${paymentMethod}${refNum ? ` ${refNum}` : ''}`;
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
        `SELECT i.*, COALESCE(b.branch_nickname, b.branch_name) AS branch_name
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
      const newInvoice = await insertInvoiceWithArNumber(
        client,
        `INSERT INTO invoicestbl (invoice_description, branch_id, amount, status, remarks, issue_date, due_date, created_by, invoice_ar_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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

      // Delete or unlink all records that reference this invoice (so delete succeeds even if student is unenrolled or profile inactive)
      await client.query('DELETE FROM paymenttbl WHERE invoice_id = $1', [id]);
      await client.query('DELETE FROM promousagetbl WHERE invoice_id = $1', [id]);
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
                i.created_by,
                i.invoice_ar_number
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

