import express from 'express';
import { body, param } from 'express-validator';
import { verifyFirebaseToken, requireRole } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import {
  createFiuuInvoicePayment,
  createFiuuArPayment,
  getFiuuPaymentStatus,
  getPublicFiuuPayByToken,
  getPublicFiuuGoHtmlByToken,
  handleFiuuWebhookPayload,
  isFiuuConfigured,
  normalizeFiuuPostBody,
  formatIpnAckBody,
} from '../services/fiuu/fiuuPaymentService.js';
import { getFiuuFrontendReturnUrl } from '../services/fiuu/config.js';

const router = express.Router();

/**
 * GET /api/sms/payments/fiuu/config
 * Whether FIUU integration is available (no secrets exposed).
 */
router.get('/config', verifyFirebaseToken, (req, res) => {
  res.json({
    success: true,
    data: {
      enabled: isFiuuConfigured(),
      defaultChannel: process.env.FIUU_DEFAULT_CHANNEL || 'QRPH',
    },
  });
});

/**
 * GET /api/sms/payments/fiuu/go/:token
 * Unauthenticated — emailed Pay now opens this URL; HTML auto-POSTs to FIUU (same tab).
 */
router.get(
  '/go/:token',
  [param('token').isString().isLength({ min: 16, max: 128 }), handleValidationErrors],
  async (req, res, next) => {
    try {
      const html = await getPublicFiuuGoHtmlByToken(req.params.token);
      res.status(200).type('html').send(html);
    } catch (err) {
      if (err.statusCode) {
        return res
          .status(err.statusCode)
          .type('html')
          .send(
            `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;text-align:center;"><p>${String(
              err.message || 'Payment link error'
            ).replace(/</g, '')}</p></body></html>`
          );
      }
      next(err);
    }
  }
);

/**
 * GET /api/sms/payments/fiuu/public/:token
 * Unauthenticated JSON payload (optional CMS landing / diagnostics).
 */
router.get(
  '/public/:token',
  [param('token').isString().isLength({ min: 16, max: 128 }), handleValidationErrors],
  async (req, res, next) => {
    try {
      const data = await getPublicFiuuPayByToken(req.params.token);
      res.json({ success: true, data });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      next(err);
    }
  }
);

/**
 * POST /api/sms/payments/fiuu/create
 * Admin/Superadmin: start FIUU payment for an invoice (full balance).
 * Body: send_email=true emails CMS pay link; invoice stays unpaid until webhook.
 */
router.post(
  '/create',
  verifyFirebaseToken,
  requireRole('Superadmin', 'Admin'),
  [
    body('invoice_id').isInt().withMessage('invoice_id is required'),
    body('student_id').isInt().withMessage('student_id is required'),
    body('channel').optional().isString(),
    body('send_email').optional(),
    body('recipient_email').optional(),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const createdBy = req.user.userId || req.user.user_id;
      const data = await createFiuuInvoicePayment({
        invoice_id: parseInt(req.body.invoice_id, 10),
        student_id: parseInt(req.body.student_id, 10),
        created_by: createdBy,
        initiator_name: req.user.fullName || req.user.full_name,
        channel: req.body.channel,
        send_email: req.body.send_email === true || req.body.send_email === 'true',
        recipient_email: req.body.recipient_email,
      });
      res.status(201).json({ success: true, data });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      next(err);
    }
  }
);

/**
 * POST /api/sms/payments/fiuu/create-ar
 * Admin/Superadmin: create pending Merchandise/Package AR and FIUU payment.
 * send_email=true emails CMS pay link; AR stays Unverified until webhook.
 */
router.post(
  '/create-ar',
  verifyFirebaseToken,
  requireRole('Superadmin', 'Admin'),
  [
    body('ar_type').isIn(['Merchandise', 'Package']).withMessage('ar_type must be Merchandise or Package'),
    body('prospect_student_name').notEmpty().withMessage('prospect_student_name is required'),
    body('prospect_student_contact').notEmpty().withMessage('prospect_student_contact is required'),
    body('prospect_student_phone').notEmpty().withMessage('prospect_student_phone is required'),
    body('issue_date').notEmpty().withMessage('issue_date is required'),
    body('channel').optional().isString(),
    body('send_email').optional(),
    body('recipient_email').optional(),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const createdBy = req.user.userId || req.user.user_id;
      const userBranchId = req.user.branchId || req.user.branch_id || null;
      const data = await createFiuuArPayment({
        arPayload: req.body,
        created_by: createdBy,
        initiator_name: req.user.fullName || req.user.full_name,
        channel: req.body.channel,
        userBranchId,
        send_email: req.body.send_email === true || req.body.send_email === 'true',
        recipient_email: req.body.recipient_email,
      });
      res.status(201).json({ success: true, data });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      next(err);
    }
  }
);

/**
 * GET /api/sms/payments/fiuu/status/:orderid
 */
router.get(
  '/status/:orderid',
  verifyFirebaseToken,
  requireRole('Superadmin', 'Admin'),
  [param('orderid').notEmpty(), handleValidationErrors],
  async (req, res, next) => {
    try {
      const data = await getFiuuPaymentStatus(req.params.orderid);
      res.json({ success: true, data });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      next(err);
    }
  }
);

export default router;

/** Webhook router — mounted without Firebase auth at /api/webhooks/fiuu */
export const fiuuWebhookRouter = express.Router();

fiuuWebhookRouter.use(express.urlencoded({ extended: true }));

/** FIUU portal Check and browsers use GET/HEAD. Payment notifications use POST. */
function webhookHealth(_req, res) {
  res.status(200).type('text/plain').send('FIUU webhook endpoint OK');
}

async function respondWebhook(req, res) {
  try {
    const payload = normalizeFiuuPostBody(req.body);
    const result = await handleFiuuWebhookPayload(payload, { source: req.path });
    const isCallback = String(req.path || '').includes('callback');
    if (isCallback && result.ok) {
      return res.status(200).type('text/plain').send('CBTOKEN:MPSTATOK');
    }
    if (result.ipnEcho) {
      return res.status(result.ok ? 200 : result.httpStatus || 400).type('text/plain').send(result.ipnEcho);
    }
    return res.status(result.ok ? 200 : result.httpStatus || 400).json(result);
  } catch (err) {
    console.error('[fiuu-webhook] error:', err);
    return res.status(500).send('ERROR');
  }
}

fiuuWebhookRouter.get('/notify', webhookHealth);
fiuuWebhookRouter.head('/notify', webhookHealth);
fiuuWebhookRouter.post('/notify', respondWebhook);
fiuuWebhookRouter.get('/callback', webhookHealth);
fiuuWebhookRouter.head('/callback', webhookHealth);
fiuuWebhookRouter.post('/callback', respondWebhook);
fiuuWebhookRouter.get('/return', webhookHealth);
fiuuWebhookRouter.head('/return', webhookHealth);

fiuuWebhookRouter.post('/return', async (req, res) => {
  try {
    const payload = normalizeFiuuPostBody(req.body);
    await handleFiuuWebhookPayload(payload, { source: 'return' });
    const frontend = getFiuuFrontendReturnUrl();
    const orderid = encodeURIComponent(payload.orderid || '');
    if (frontend) {
      const sep = frontend.includes('?') ? '&' : '?';
      return res.redirect(`${frontend}${sep}fiuu_orderid=${orderid}&fiuu_status=${encodeURIComponent(payload.status || '')}`);
    }
    return res.send(`
      <!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment</title></head>
      <body style="font-family:sans-serif;padding:2rem;text-align:center">
        <h2>Payment received</h2>
        <p>Order: ${payload.orderid || ''}</p>
        <p>You may close this window and return to the CMS.</p>
      </body></html>
    `);
  } catch (err) {
    console.error('[fiuu-return] error:', err);
    return res.status(500).send('Payment return processing failed');
  }
});
