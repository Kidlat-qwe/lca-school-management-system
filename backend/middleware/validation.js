import { validationResult, body } from 'express-validator';

/**
 * Middleware to handle validation errors from express-validator
 */
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.error('❌ Validation errors:', errors.array());
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array(),
    });
  }
  next();
};

/** Nickname is optional; null/empty from JSON clients must not fail isString(). */
export const optionalNicknameValidator = body('nickname')
  .optional({ values: 'falsy' })
  .isString()
  .withMessage('Nickname must be a string');

