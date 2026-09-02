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
  applyParentAutodebitDecisionOnPayToken,
  previewFiuuPaymentLinkEmail,
  handleFiuuWebhookPayload,
  isFiuuConfigured,
  normalizeFiuuPostBody,
  formatIpnAckBody,
} from '../services/fiuu/fiuuPaymentService.js';
import { getFiuuFrontendReturnUrl, isFiuuAutopayOtpEnabled } from '../services/fiuu/config.js';
import {
  listFiuuPaymentTokensForStudent,
  revokeFiuuPaymentToken,
} from '../services/fiuu/fiuuTokenService.js';
import {
  getAutodebitTermsPayload,
  resolveInvoiceAutodebitContext,
  listAutodebitConsentsForStudent,
  disableAutodebitConsent,
} from '../services/fiuu/fiuuAutodebitConsent.js';
import {
  startAutopayOtpVerification,
  sendAutopaySmsOtp,
  sendAutopayEmailVerification,
  verifyAutopayOtpCode,
  confirmAutopayEmailVerification,
  cancelAutopayOtpVerification,
  getAutopayOtpPageContext,
} from '../services/fiuu/fiuuAutopayOtpService.js';
import { buildAutopayOtpVerificationHtml } from '../services/fiuu/payLink.js';

const router = express.Router();

function applyFiuuGoPageCsp(res) {
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('Content-Security-Policy-Report-Only');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; form-action https: http:; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://static.cloudflareinsights.com; img-src https: http: data:; base-uri 'none'"
  );
}

function sendFiuuGoHtml(res, html, status = 200) {
  applyFiuuGoPageCsp(res);
  return res.status(status).type('html').send(html);
}

function sendFiuuGoErrorHtml(res, err, fallback = 'Request error') {
  applyFiuuGoPageCsp(res);
  const status = err?.statusCode || 500;
  return res
    .status(status)
    .type('html')
    .send(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;text-align:center;"><p>${String(
        err?.message || fallback
      ).replace(/</g, '')}</p></body></html>`
    );
}

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
      autodebitTerms: getAutodebitTermsPayload(),
    },
  });
});

/**
 * GET /api/sms/payments/fiuu/autodebit-context/:invoiceId
 * Whether this invoice can offer class-scoped auto-debit.
 */
router.get(
  '/autodebit-context/:invoiceId',
  verifyFirebaseToken,
  requireRole('Superadmin', 'Admin'),
  [param('invoiceId').isInt(), handleValidationErrors],
  async (req, res, next) => {
    try {
      const data = await resolveInvoiceAutodebitContext(req.params.invoiceId);
      res.json({
        success: true,
        data: {
          ...(data || { eligible: false }),
          terms: getAutodebitTermsPayload(),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/sms/payments/fiuu/go/:token
 * Unauthenticated — emailed Pay now opens this URL; HTML auto-POSTs to FIUU (same tab).
 */
router.get(
  '/go/:token',
  [param('token').isString().isLength({ min: 16, max: 128 }), handleValidationErrors],
  async (req, res, next) => {
    try {
      const ready = String(req.query?.ready || '') === '1';
      const html = await getPublicFiuuGoHtmlByToken(req.params.token, { allowFiuuAutoPost: ready });
      return sendFiuuGoHtml(res, html);
    } catch (err) {
      if (err.statusCode) {
        return sendFiuuGoErrorHtml(res, err, 'Payment link error');
      }
      next(err);
    }
  }
);

/**
 * POST /api/sms/payments/fiuu/go/:token/autopay-otp
 * Start AutoPay SMS/email verification after parent accepts Terms on /go.
 */
router.post(
  '/go/:token/autopay-otp',
  express.urlencoded({ extended: true }),
  [param('token').isString().isLength({ min: 16, max: 128 }), handleValidationErrors],
  async (req, res, next) => {
    try {
      const token = req.params.token;
      if (!isFiuuAutopayOtpEnabled()) {
        await applyParentAutodebitDecisionOnPayToken(token, {
          decision: 'accept',
          terms_accepted: true,
          skipOtpCheck: true,
        });
        return res.redirect(303, `${req.baseUrl}/go/${encodeURIComponent(token)}?ready=1`);
      }
      const ctx = await startAutopayOtpVerification(token);
      return sendFiuuGoHtml(res, buildAutopayOtpVerificationHtml(ctx));
    } catch (err) {
      if (err.statusCode) return sendFiuuGoErrorHtml(res, err);
      next(err);
    }
  }
);

/**
 * GET /api/sms/payments/fiuu/go/:token/autopay-otp/confirm-email
 * Parent clicks Verify in email → finalize AutoPay → redirect to /go.
 */
router.get(
  '/go/:token/autopay-otp/confirm-email',
  [param('token').isString().isLength({ min: 16, max: 128 }), handleValidationErrors],
  async (req, res, next) => {
    try {
      const token = req.params.token;
      await confirmAutopayEmailVerification(token, {
        exp: req.query?.exp,
        sig: req.query?.sig,
      });
      return res.redirect(303, `${req.baseUrl}/go/${encodeURIComponent(token)}?ready=1`);
    } catch (err) {
      if (err.statusCode) return sendFiuuGoErrorHtml(res, err);
      next(err);
    }
  }
);

/**
 * GET /api/sms/payments/fiuu/go/:token/autopay-otp
 * Show AutoPay verification page (mobile or email OTP — enter code on page).
 */
router.get(
  '/go/:token/autopay-otp',
  [param('token').isString().isLength({ min: 16, max: 128 }), handleValidationErrors],
  async (req, res, next) => {
    try {
      const token = req.params.token;
      const mode = String(req.query?.mode || '').toLowerCase() === 'email' ? 'email' : 'sms';
      const ctx = await getAutopayOtpPageContext(token, { mode });
      if (ctx.verified) {
        return res.redirect(303, `${req.baseUrl}/go/${encodeURIComponent(token)}?ready=1`);
      }
      const sent = String(req.query?.sent || '') === '1';
      return sendFiuuGoHtml(res, buildAutopayOtpVerificationHtml(ctx, { sent }));
    } catch (err) {
      if (err.statusCode) return sendFiuuGoErrorHtml(res, err);
      next(err);
    }
  }
);

router.post(
  '/go/:token/autopay-otp/send',
  express.urlencoded({ extended: true }),
  [param('token').isString().isLength({ min: 16, max: 128 }), handleValidationErrors],
  async (req, res, next) => {
    try {
      const token = req.params.token;
      const channel = String(req.body?.channel || 'sms').toLowerCase();
      if (channel === 'email') {
        await sendAutopayEmailVerification(token, req.body?.email);
        return res.redirect(
          303,
          `${req.baseUrl}/go/${encodeURIComponent(token)}/autopay-otp?mode=email&sent=1`
        );
      }
      await sendAutopaySmsOtp(token, req.body?.mobile);
      return res.redirect(
        303,
        `${req.baseUrl}/go/${encodeURIComponent(token)}/autopay-otp?mode=sms&sent=1`
      );
    } catch (err) {
      try {
        const channel = String(req.body?.channel || 'sms').toLowerCase();
        const ctx = await getAutopayOtpPageContext(req.params.token, {
          mode: channel === 'email' ? 'email' : 'sms',
        });
        return sendFiuuGoHtml(
          res,
          buildAutopayOtpVerificationHtml(
            {
              ...ctx,
              enteredMobile:
                channel === 'sms'
                  ? String(req.body?.mobile || ctx.enteredMobile || ctx.suggestedMobile || '')
                  : ctx.enteredMobile,
              enteredEmail:
                channel === 'email'
                  ? String(req.body?.email || ctx.enteredEmail || ctx.suggestedEmail || '')
                  : ctx.enteredEmail,
            },
            {
              error: err?.message || 'Could not send verification. Try email instead.',
            }
          )
        );
      } catch {
        return sendFiuuGoErrorHtml(res, err, 'Verification error');
      }
    }
  }
);

router.post(
  '/go/:token/autopay-otp/verify',
  express.urlencoded({ extended: true }),
  [param('token').isString().isLength({ min: 16, max: 128 }), handleValidationErrors],
  async (req, res, next) => {
    try {
      const token = req.params.token;
      await verifyAutopayOtpCode(token, req.body?.code);
      return res.redirect(303, `${req.baseUrl}/go/${encodeURIComponent(token)}?ready=1`);
    } catch (err) {
      if (err.statusCode) {
        try {
          const ctx = await getAutopayOtpPageContext(req.params.token);
          return sendFiuuGoHtml(
            res,
            buildAutopayOtpVerificationHtml(ctx, { error: err.message, sent: true })
          );
        } catch {
          return sendFiuuGoErrorHtml(res, err);
        }
      }
      next(err);
    }
  }
);

router.post(
  '/go/:token/autopay-otp/cancel',
  express.urlencoded({ extended: true }),
  [param('token').isString().isLength({ min: 16, max: 128 }), handleValidationErrors],
  async (req, res, next) => {
    try {
      const token = req.params.token;
      await cancelAutopayOtpVerification(token);
      await applyParentAutodebitDecisionOnPayToken(token, {
        decision: 'decline',
        terms_accepted: true,
        skipOtpCheck: true,
      });
      return res.redirect(303, `${req.baseUrl}/go/${encodeURIComponent(token)}`);
    } catch (err) {
      if (err.statusCode) return sendFiuuGoErrorHtml(res, err);
      next(err);
    }
  }
);

/**
 * POST /api/sms/payments/fiuu/go/:token/consent
 * Parent accept/decline auto-debit on emailed pay link, then redirect back to /go.
 */
router.post(
  '/go/:token/consent',
  express.urlencoded({ extended: true }),
  [param('token').isString().isLength({ min: 16, max: 128 }), handleValidationErrors],
  async (req, res, next) => {
    try {
      const decision = String(req.body?.decision || '').toLowerCase();
      const termsAccepted =
        req.body?.terms_accepted === '1' ||
        req.body?.terms_accepted === true ||
        req.body?.terms_accepted === 'true';
      await applyParentAutodebitDecisionOnPayToken(req.params.token, {
        decision: decision === 'accept' ? 'accept' : 'decline',
        terms_accepted: termsAccepted || decision === 'decline',
      });
      const redirectTo = `${req.baseUrl}/go/${encodeURIComponent(req.params.token)}?ready=1`;
      return res.redirect(303, redirectTo);
    } catch (err) {
      if (err.statusCode) return sendFiuuGoErrorHtml(res, err, 'Consent error');
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
    body('pay_link_expires_on').optional().isString(),
    body('disable_after_payment').optional(),
    body('send_copy_to_me').optional(),
    body('tip_amount').optional(),
    body('discount_amount').optional(),
    body('autodebit_opt_in').optional(),
    body('autodebit_terms_accepted').optional(),
    body('parent_terms_accepted').optional(),
    body('parent_opt_in').optional(),
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
        pay_link_expires_on: req.body.pay_link_expires_on,
        disable_after_payment:
          req.body.disable_after_payment === undefined
            ? true
            : req.body.disable_after_payment === true ||
              req.body.disable_after_payment === 'true',
        send_copy_to_me:
          req.body.send_copy_to_me === true || req.body.send_copy_to_me === 'true',
        staff_email: req.user.email,
        tip_amount: req.body.tip_amount,
        discount_amount: req.body.discount_amount,
        autodebit_opt_in:
          req.body.autodebit_opt_in === true || req.body.autodebit_opt_in === 'true',
        autodebit_terms_accepted:
          req.body.autodebit_terms_accepted === true ||
          req.body.autodebit_terms_accepted === 'true',
        parent_terms_accepted:
          req.body.parent_terms_accepted === true ||
          req.body.parent_terms_accepted === 'true',
        parent_opt_in:
          req.body.parent_opt_in === true || req.body.parent_opt_in === 'true',
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
 * POST /api/sms/payments/fiuu/preview-email
 * Admin/Superadmin: HTML preview of payment-link email (no send, no gateway row).
 */
router.post(
  '/preview-email',
  verifyFirebaseToken,
  requireRole('Superadmin', 'Admin'),
  [body('mode').optional().isIn(['invoice', 'ar']), handleValidationErrors],
  async (req, res, next) => {
    try {
      const data = await previewFiuuPaymentLinkEmail({
        ...req.body,
        mode: req.body.mode || 'invoice',
        invoice_id: req.body.invoice_id != null ? parseInt(req.body.invoice_id, 10) : undefined,
        student_id: req.body.student_id != null ? parseInt(req.body.student_id, 10) : undefined,
        branch_id: req.body.branch_id != null ? parseInt(req.body.branch_id, 10) : undefined,
        send_copy_to_me:
          req.body.send_copy_to_me === true || req.body.send_copy_to_me === 'true',
        staff_email: req.user.email,
      });
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
    body('pay_link_expires_on').optional().isString(),
    body('disable_after_payment').optional(),
    body('send_copy_to_me').optional(),
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
        pay_link_expires_on: req.body.pay_link_expires_on,
        disable_after_payment:
          req.body.disable_after_payment === undefined
            ? true
            : req.body.disable_after_payment === true ||
              req.body.disable_after_payment === 'true',
        send_copy_to_me:
          req.body.send_copy_to_me === true || req.body.send_copy_to_me === 'true',
        staff_email: req.user.email,
        autodebit_opt_in:
          req.body.autodebit_opt_in === true || req.body.autodebit_opt_in === 'true',
        autodebit_terms_accepted:
          req.body.autodebit_terms_accepted === true ||
          req.body.autodebit_terms_accepted === 'true',
        parent_terms_accepted:
          req.body.parent_terms_accepted === true ||
          req.body.parent_terms_accepted === 'true',
        parent_opt_in:
          req.body.parent_opt_in === true || req.body.parent_opt_in === 'true',
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
 * GET /api/sms/payments/fiuu/tokens/:studentId
 * List saved FIUU card tokens for a student (never returns raw token).
 */
router.get(
  '/tokens/:studentId',
  verifyFirebaseToken,
  requireRole('Superadmin', 'Admin'),
  [param('studentId').isInt(), handleValidationErrors],
  async (req, res, next) => {
    try {
      const includeRevoked =
        req.query.include_revoked === 'true' || req.query.include_revoked === '1';
      const data = await listFiuuPaymentTokensForStudent(req.params.studentId, {
        includeRevoked,
      });
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
 * GET /api/sms/payments/fiuu/autodebit-consents/:studentId
 */
router.get(
  '/autodebit-consents/:studentId',
  verifyFirebaseToken,
  requireRole('Superadmin', 'Admin'),
  [param('studentId').isInt(), handleValidationErrors],
  async (req, res, next) => {
    try {
      const data = await listAutodebitConsentsForStudent(req.params.studentId);
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
 * POST /api/sms/payments/fiuu/autodebit-consents/:consentId/disable
 */
router.post(
  '/autodebit-consents/:consentId/disable',
  verifyFirebaseToken,
  requireRole('Superadmin', 'Admin'),
  [param('consentId').isInt(), body('reason').optional().isString(), handleValidationErrors],
  async (req, res, next) => {
    try {
      const data = await disableAutodebitConsent(req.params.consentId, {
        disabled_by: req.user.userId || req.user.user_id,
        reason: req.body.reason || 'Disabled by staff',
      });
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
 * POST /api/sms/payments/fiuu/tokens/:tokenId/revoke
 * Revoke an active saved FIUU token (staff-initiated).
 */
router.post(
  '/tokens/:tokenId/revoke',
  verifyFirebaseToken,
  requireRole('Superadmin', 'Admin'),
  [
    param('tokenId').isInt(),
    body('student_id').optional().isInt(),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const data = await revokeFiuuPaymentToken(req.params.tokenId, {
        studentId: req.body.student_id != null ? parseInt(req.body.student_id, 10) : null,
      });
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
