import express from 'express';
import { body, param } from 'express-validator';
import { verifyFirebaseToken, requireRole } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import {
  createFiuuInvoicePayment,
  getFiuuPaymentStatus,
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
 * POST /api/sms/payments/fiuu/create
 * Admin/Superadmin: start FIUU payment for an invoice (full balance).
 */
router.post(
  '/create',
  verifyFirebaseToken,
  requireRole('Superadmin', 'Admin'),
  [
    body('invoice_id').isInt().withMessage('invoice_id is required'),
    body('student_id').isInt().withMessage('student_id is required'),
    body('channel').optional().isString(),
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
