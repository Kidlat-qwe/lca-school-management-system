import express from 'express';
import { query as queryValidator } from 'express-validator';
import { verifyFirebaseToken } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { getNationalHolidaysInRange } from '../utils/holidayService.js';

const router = express.Router();

// All routes require authentication (token present)
router.use(verifyFirebaseToken);

/**
 * GET /api/sms/holidays/national?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 * Returns Philippines national holidays within the range.
 */
router.get(
  '/national',
  [
    queryValidator('start_date')
      .notEmpty()
      .withMessage('start_date is required')
      .isISO8601()
      .withMessage('start_date must be a valid date (YYYY-MM-DD)'),
    queryValidator('end_date')
      .notEmpty()
      .withMessage('end_date is required')
      .isISO8601()
      .withMessage('end_date must be a valid date (YYYY-MM-DD)'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { start_date, end_date } = req.query;
      const { holidays } = getNationalHolidaysInRange(start_date, end_date);

      res.json({
        success: true,
        data: holidays,
        meta: {
          start_date,
          end_date,
          total: holidays.length,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

