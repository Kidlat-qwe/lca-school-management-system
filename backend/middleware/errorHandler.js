/**
 * Global error handling middleware
 */
export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);
  console.error('Error details:', {
    name: err.name,
    message: err.message,
    code: err.code,
    detail: err.detail,
    constraint: err.constraint,
    table: err.table,
    column: err.column,
    stack: err.stack
  });

  // Inventory / RHET upstream errors (safety net if route used next(error))
  if (err?.name === 'InventoryApiError') {
    return res.status(err.status || 502).json({
      success: false,
      message: err.message || 'RHET Inventory request failed',
      error: { code: err.code || 'INVENTORY_API_ERROR' },
    });
  }

  // Database errors (PostgreSQL SQLSTATE is always 5 chars, e.g. 23505).
  // Do NOT treat InventoryApiError.code values like NETWORK_ERROR as DB errors.
  if (typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code)) {
    switch (err.code) {
      case '23505': // Unique violation
        return res.status(409).json({
          success: false,
          message: 'Duplicate entry. This record already exists.',
          error: err.detail,
        });
      case '23503': // Foreign key violation
        return res.status(400).json({
          success: false,
          message: 'Referenced record does not exist.',
          error: err.detail,
        });
      case '23502': // Not null violation
        return res.status(400).json({
          success: false,
          message: 'Required field is missing.',
          error: err.column,
        });
      case '23514': // Check constraint violation
        return res.status(400).json({
          success: false,
          message:
            err.constraint === 'check_request_type' || err.constraint === 'check_type'
              ? 'This uniform type is not allowed by the database yet. Apply migration 137_allow_uniform_set_type.sql (allows Set), then retry.'
              : 'A database check constraint was violated. Please verify the submitted values.',
          error:
            process.env.NODE_ENV === 'development'
              ? `${err.message}${err.constraint ? ` [${err.constraint}]` : ''}`
              : err.constraint || 'check_violation',
          code: err.code,
        });
      case '42P01': // Undefined table
        return res.status(500).json({
          success: false,
          message: 'Database table does not exist. Please ensure the database schema is set up correctly.',
          error: process.env.NODE_ENV === 'development' ? err.message : 'Database schema error',
        });
      case '42P07': // Duplicate table
        return res.status(500).json({
          success: false,
          message: 'Database table already exists.',
          error: process.env.NODE_ENV === 'development' ? err.message : 'Database schema error',
        });
      default:
        return res.status(500).json({
          success: false,
          message: 'Database error occurred',
          error: process.env.NODE_ENV === 'development' 
            ? `${err.message}${err.detail ? ` (${err.detail})` : ''}${err.code ? ` [Code: ${err.code}]` : ''}` 
            : 'Internal server error',
          code: err.code,
        });
    }
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: err.errors || err.message,
    });
  }

  // Default error response
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
};

/**
 * 404 Not Found handler
 */
export const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
};

