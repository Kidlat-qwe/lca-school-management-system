import express from 'express';
import { body, param, query } from 'express-validator';
import { query as dbQuery, getClient } from '../config/database.js';
import { verifyFirebaseToken, requireRole } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(verifyFirebaseToken);

/**
 * GET /api/v1/merchandise-requests
 * Get all merchandise requests (filtered by role)
 * Access: Superadmin (all requests), Admin (their branch requests only)
 */
router.get(
  '/',
  [
    query('status').optional().isIn(['Pending', 'Approved', 'Rejected', 'Cancelled']).withMessage('Invalid status'),
    query('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { status, branch_id, page = 1, limit = 15 } = req.query;
      const offset = (page - 1) * limit;

      let sql = `
        SELECT 
          mr.*,
          u.full_name as requested_by_name,
          u.email as requested_by_email,
          b.branch_name as requested_branch_name,
          r.full_name as reviewed_by_name,
          m.image_url as merchandise_image_url,
          m.price as merchandise_price
        FROM merchandiserequestlogtbl mr
        LEFT JOIN userstbl u ON mr.requested_by = u.user_id
        LEFT JOIN branchestbl b ON mr.requested_branch_id = b.branch_id
        LEFT JOIN userstbl r ON mr.reviewed_by = r.user_id
        LEFT JOIN merchandisestbl m ON mr.merchandise_id = m.merchandise_id
        WHERE 1=1
      `;

      const params = [];
      let paramCount = 0;

      // Admin can only see their branch requests
      if (req.user.userType === 'Admin') {
        paramCount++;
        sql += ` AND mr.requested_branch_id = $${paramCount}`;
        params.push(req.user.branchId);
      }

      // Filter by status
      if (status) {
        paramCount++;
        sql += ` AND mr.status = $${paramCount}`;
        params.push(status);
      }

      // Filter by branch (Superadmin only)
      if (branch_id && req.user.userType === 'Superadmin') {
        paramCount++;
        sql += ` AND mr.requested_branch_id = $${paramCount}`;
        params.push(branch_id);
      }

      // Get total count
      const countResult = await dbQuery(`SELECT COUNT(*) as total FROM (${sql}) as count_query`, params);
      const totalItems = parseInt(countResult.rows[0].total);

      // Add ordering and pagination
      sql += ` ORDER BY mr.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limit, offset);

      const result = await dbQuery(sql, params);

      res.json({
        success: true,
        data: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalItems,
          totalPages: Math.ceil(totalItems / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/merchandise-requests/stats
 * Get request statistics
 * Access: Superadmin, Admin
 */
router.get(
  '/stats',
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      let branchFilter = '';
      const params = [];

      if (req.user.userType === 'Admin') {
        branchFilter = 'WHERE requested_branch_id = $1';
        params.push(req.user.branchId);
      }

      const statsQuery = `
        SELECT 
          COUNT(*) FILTER (WHERE status = 'Pending') as pending_count,
          COUNT(*) FILTER (WHERE status = 'Approved') as approved_count,
          COUNT(*) FILTER (WHERE status = 'Rejected') as rejected_count,
          COUNT(*) FILTER (WHERE status = 'Cancelled') as cancelled_count,
          COUNT(*) as total_count
        FROM merchandiserequestlogtbl
        ${branchFilter}
      `;

      const result = await dbQuery(statsQuery, params);

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
 * GET /api/v1/merchandise-requests/:id
 * Get specific merchandise request
 * Access: Superadmin, Admin (own branch only)
 */
router.get(
  '/:id',
  [
    param('id').isInt().withMessage('Request ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      let sql = `
        SELECT 
          mr.*,
          u.full_name as requested_by_name,
          u.email as requested_by_email,
          b.branch_name as requested_branch_name,
          r.full_name as reviewed_by_name,
          m.image_url as merchandise_image_url,
          m.price as merchandise_price,
          m.quantity as current_stock
        FROM merchandiserequestlogtbl mr
        LEFT JOIN userstbl u ON mr.requested_by = u.user_id
        LEFT JOIN branchestbl b ON mr.requested_branch_id = b.branch_id
        LEFT JOIN userstbl r ON mr.reviewed_by = r.user_id
        LEFT JOIN merchandisestbl m ON mr.merchandise_id = m.merchandise_id AND m.branch_id = mr.requested_branch_id
        WHERE mr.request_id = $1
      `;

      const params = [id];

      // Admin can only see their branch requests
      if (req.user.userType === 'Admin') {
        sql += ` AND mr.requested_branch_id = $2`;
        params.push(req.user.branchId);
      }

      const result = await dbQuery(sql, params);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Request not found',
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
 * POST /api/v1/merchandise-requests
 * Create a new merchandise request
 * Access: Admin only
 */
router.post(
  '/',
  [
    body('merchandise_id').optional().isInt().withMessage('Merchandise ID must be an integer'),
    body('merchandise_name').notEmpty().trim().withMessage('Merchandise name is required'),
    body('size').optional().trim(),
    body('requested_quantity').isInt({ min: 1 }).withMessage('Requested quantity must be at least 1'),
    body('request_reason').optional().trim(),
    body('gender').optional({ nullable: true, checkFalsy: true }).isIn(['Men', 'Women', 'Unisex', null, '']).withMessage('Gender must be one of: Men, Women, Unisex'),
    body('type').optional({ nullable: true, checkFalsy: true }).isIn(['Top', 'Bottom', null, '']).withMessage('Type must be one of: Top, Bottom'),
    handleValidationErrors,
  ],
  requireRole('Admin'),
  async (req, res, next) => {
    try {
      const { merchandise_id, merchandise_name, size, requested_quantity, request_reason, gender, type } = req.body;

      // Validate merchandise_id if provided
      if (merchandise_id) {
        const merchandiseCheck = await dbQuery(
          'SELECT merchandise_id, merchandise_name, size FROM merchandisestbl WHERE merchandise_id = $1',
          [merchandise_id]
        );

        if (merchandiseCheck.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: 'Merchandise not found',
          });
        }
      }

      // Create request
      const result = await dbQuery(
        `INSERT INTO merchandiserequestlogtbl 
        (merchandise_id, requested_by, requested_branch_id, merchandise_name, size, requested_quantity, request_reason, gender, type, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Pending')
        RETURNING *`,
        [
          merchandise_id || null,
          req.user.userId,
          req.user.branchId,
          merchandise_name,
          size || null,
          requested_quantity,
          request_reason || null,
          gender || null,
          type || null,
        ]
      );

      // Create notification for Superadmin
      const requestId = result.rows[0].request_id;
      const branchName = await dbQuery('SELECT branch_name FROM branchestbl WHERE branch_id = $1', [req.user.branchId]);
      const branchNameText = branchName.rows[0]?.branch_name || 'Unknown Branch';
      
      // Build notification message
      let notificationBody = `${req.user.fullName || req.user.email} from ${branchNameText} has requested ${requested_quantity} units of ${merchandise_name}`;
      if (gender || type) {
        const genderType = [gender, type].filter(Boolean).join(' - ');
        notificationBody += ` (${genderType})`;
      }
      if (size) {
        notificationBody += ` Size: ${size}`;
      }
      if (request_reason) {
        notificationBody += `. Reason: ${request_reason}`;
      }
      
      await dbQuery(
        `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          'New Merchandise Stock Request',
          notificationBody,
          ['Superadmin'],
          'Active',
          'High',
          req.user.userId,
        ]
      );

      res.status(201).json({
        success: true,
        message: 'Merchandise request created successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/v1/merchandise-requests/:id/approve
 * Approve a merchandise request
 * Access: Superadmin only
 */
router.put(
  '/:id/approve',
  [
    param('id').isInt().withMessage('Request ID must be an integer'),
    body('review_notes').optional().trim(),
    body('price').notEmpty().withMessage('Price is required').isFloat({ min: 0.01 }).withMessage('Price must be greater than 0'),
    handleValidationErrors,
  ],
  requireRole('Superadmin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const { review_notes, price } = req.body;

      // Get request details
      const requestResult = await client.query(
        'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1',
        [id]
      );

      if (requestResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Request not found',
        });
      }

      const request = requestResult.rows[0];

      // Check if request is still pending
      if (request.status !== 'Pending') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Cannot approve request with status: ${request.status}`,
        });
      }

      // Price is required - use provided price
      const finalPrice = parseFloat(price);
      let imageUrl = null;

      // Get image_url from reference merchandise if available
      if (request.merchandise_id) {
        const refMerchandise = await client.query(
          'SELECT image_url FROM merchandisestbl WHERE merchandise_id = $1',
          [request.merchandise_id]
        );
        if (refMerchandise.rows.length > 0) {
          imageUrl = refMerchandise.rows[0].image_url;
        }
      }

      // Use request gender & type if available
      const merchandiseGender = request.gender || null;
      const merchandiseType = request.type || null;

      // Check if merchandise exists for this branch (match by name, size, gender, and type)
      const merchandiseCheck = await client.query(
        `SELECT merchandise_id, quantity, price
         FROM merchandisestbl 
         WHERE branch_id = $1 
         AND merchandise_name = $2 
         AND (size = $3 OR (size IS NULL AND $3 IS NULL))
         AND (gender = $4 OR (gender IS NULL AND $4 IS NULL))
         AND (type = $5 OR (type IS NULL AND $5 IS NULL))`,
        [request.requested_branch_id, request.merchandise_name, request.size, merchandiseGender, merchandiseType]
      );

      if (merchandiseCheck.rows.length > 0) {
        // Merchandise exists - update quantity and price
        const existingMerchandise = merchandiseCheck.rows[0];
        const newQuantity = (existingMerchandise.quantity || 0) + request.requested_quantity;
        
        // Update quantity and price (price is required)
        await client.query(
          'UPDATE merchandisestbl SET quantity = $1, price = $2 WHERE merchandise_id = $3',
          [newQuantity, finalPrice, existingMerchandise.merchandise_id]
        );

        console.log(`✅ Updated merchandise stock: ${existingMerchandise.merchandise_id}, new quantity: ${newQuantity}`);
      } else {
        // Merchandise doesn't exist - create new entry
        // Get image_url from reference merchandise if available
        if (!imageUrl && request.merchandise_id) {
          const refMerchandise = await client.query(
            'SELECT image_url FROM merchandisestbl WHERE merchandise_id = $1',
            [request.merchandise_id]
          );
          if (refMerchandise.rows.length > 0) {
            imageUrl = refMerchandise.rows[0].image_url;
          }
        }

        await client.query(
          `INSERT INTO merchandisestbl (merchandise_name, size, quantity, price, branch_id, image_url, gender, type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            request.merchandise_name,
            request.size,
            request.requested_quantity,
            finalPrice,
            request.requested_branch_id,
            imageUrl,
            merchandiseGender,
            merchandiseType,
          ]
        );

        console.log(`✅ Created new merchandise for branch ${request.requested_branch_id}`);
      }

      // Update request status to Approved
      const updateResult = await client.query(
        `UPDATE merchandiserequestlogtbl 
         SET status = 'Approved', 
             reviewed_by = $1, 
             reviewed_at = CURRENT_TIMESTAMP, 
             review_notes = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $3
         RETURNING *`,
        [req.user.userId, review_notes || null, id]
      );

      // Create notification for Admin who made the request
      const requesterName = await client.query('SELECT full_name, email FROM userstbl WHERE user_id = $1', [request.requested_by]);
      const requesterNameText = requesterName.rows[0]?.full_name || requesterName.rows[0]?.email || 'Admin';
      
      await client.query(
        `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          'Merchandise Request Approved',
          `Your request for ${request.requested_quantity} units of ${request.merchandise_name}${request.size ? ` (Size: ${request.size})` : ''} has been approved. ${review_notes ? `Notes: ${review_notes}` : 'The stock has been added to your inventory.'}`,
          ['Admin'],
          'Active',
          'Medium',
          request.requested_branch_id,
          req.user.userId,
        ]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Merchandise request approved successfully',
        data: updateResult.rows[0],
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
 * PUT /api/v1/merchandise-requests/:id/reject
 * Reject a merchandise request
 * Access: Superadmin only
 */
router.put(
  '/:id/reject',
  [
    param('id').isInt().withMessage('Request ID must be an integer'),
    body('review_notes').notEmpty().trim().withMessage('Rejection reason is required'),
    handleValidationErrors,
  ],
  requireRole('Superadmin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { review_notes } = req.body;

      // Get request details
      const requestResult = await dbQuery(
        'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1',
        [id]
      );

      if (requestResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Request not found',
        });
      }

      const request = requestResult.rows[0];

      // Check if request is still pending
      if (request.status !== 'Pending') {
        return res.status(400).json({
          success: false,
          message: `Cannot reject request with status: ${request.status}`,
        });
      }

      // Update request status to Rejected
      const result = await dbQuery(
        `UPDATE merchandiserequestlogtbl 
         SET status = 'Rejected', 
             reviewed_by = $1, 
             reviewed_at = CURRENT_TIMESTAMP, 
             review_notes = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $3
         RETURNING *`,
        [req.user.userId, review_notes, id]
      );

      // Create notification for Admin who made the request
      await dbQuery(
        `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          'Merchandise Request Rejected',
          `Your request for ${request.requested_quantity} units of ${request.merchandise_name}${request.size ? ` (Size: ${request.size})` : ''} has been rejected. Reason: ${review_notes}`,
          ['Admin'],
          'Active',
          'Medium',
          request.requested_branch_id,
          req.user.userId,
        ]
      );

      res.json({
        success: true,
        message: 'Merchandise request rejected',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/v1/merchandise-requests/:id/cancel
 * Cancel a pending merchandise request
 * Access: Admin (own requests only)
 */
router.put(
  '/:id/cancel',
  [
    param('id').isInt().withMessage('Request ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Get request details
      const requestResult = await dbQuery(
        'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1 AND requested_branch_id = $2',
        [id, req.user.branchId]
      );

      if (requestResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Request not found',
        });
      }

      const request = requestResult.rows[0];

      // Check if request is still pending
      if (request.status !== 'Pending') {
        return res.status(400).json({
          success: false,
          message: `Cannot cancel request with status: ${request.status}`,
        });
      }

      // Update request status to Cancelled
      const result = await dbQuery(
        `UPDATE merchandiserequestlogtbl 
         SET status = 'Cancelled', 
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $1
         RETURNING *`,
        [id]
      );

      res.json({
        success: true,
        message: 'Merchandise request cancelled',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/v1/merchandise-requests/:id
 * Delete a merchandise request (only if Cancelled or Rejected)
 * Access: Superadmin, Admin (own requests only)
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('Request ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      let sql = 'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1';
      const params = [id];

      // Admin can only delete their branch requests
      if (req.user.userType === 'Admin') {
        sql += ' AND requested_branch_id = $2';
        params.push(req.user.branchId);
      }

      const requestResult = await dbQuery(sql, params);

      if (requestResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Request not found',
        });
      }

      const request = requestResult.rows[0];

      // Only allow deletion of Cancelled or Rejected requests
      if (!['Cancelled', 'Rejected'].includes(request.status)) {
        return res.status(400).json({
          success: false,
          message: 'Can only delete Cancelled or Rejected requests',
        });
      }

      await dbQuery('DELETE FROM merchandiserequestlogtbl WHERE request_id = $1', [id]);

      res.json({
        success: true,
        message: 'Merchandise request deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

