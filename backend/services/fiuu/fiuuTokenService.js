/**
 * FIUU payment token storage (tokenization / future MIT auto-debit).
 * Tokens come from notify/callback extraP after a successful Card (or enabled channel) pay.
 */
import { query } from '../../config/database.js';
import { upsertAutodebitConsentFromGateway } from './fiuuAutodebitConsent.js';

/**
 * Parse FIUU extraP (JSON string or object) from webhook payload.
 * @returns {Record<string, unknown>}
 */
export function parseFiuuExtraP(payload = {}) {
  let raw = payload.extraP ?? payload.ExtraP ?? payload.extrap ?? null;
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Extract token + card display fields from webhook payload / extraP.
 * @returns {{ token: string, custId: string, cardBrand: string, cardLast4: string, expMonth: string, expYear: string, extraP: object } | null}
 */
export function extractFiuuTokenFromWebhook(payload = {}) {
  const extraP = parseFiuuExtraP(payload);
  const token = String(
    extraP.token ?? extraP.Token ?? payload.token ?? payload.Token ?? ''
  ).trim();
  if (!token) return null;

  const custId = String(
    extraP.CustID ?? extraP.custID ?? extraP.custId ?? payload.CustID ?? ''
  ).trim();

  const bin4 = String(extraP.bin4 ?? extraP.last4 ?? extraP.card_last4 ?? '').trim();
  const bin = String(extraP.bin ?? '').trim();
  const cardLast4 =
    bin4 ||
    (bin.length >= 4 ? bin.slice(-4) : '') ||
    String(extraP.card_number ?? '').replace(/\D/g, '').slice(-4);

  return {
    token,
    custId,
    cardBrand: String(
      extraP.card_brand ?? extraP.cardBrand ?? extraP.brand ?? ''
    ).trim(),
    cardLast4,
    expMonth: String(extraP.expMonth ?? extraP.exp_month ?? '').trim().slice(0, 2),
    expYear: String(extraP.expYear ?? extraP.exp_year ?? '').trim().slice(0, 4),
    extraP,
  };
}

export function buildFiuuCustId(studentId) {
  const id = parseInt(studentId, 10);
  if (!Number.isFinite(id) || id <= 0) return '';
  return `PSMS-S-${id}`;
}

/**
 * Upsert active token for a student (revokes prior active tokens for that student).
 */
export async function saveFiuuPaymentToken({
  student_id,
  installmentinvoiceprofiles_id = null,
  branch_id = null,
  fiuu_token,
  fiuu_cust_id = null,
  card_brand = null,
  card_last4 = null,
  exp_month = null,
  exp_year = null,
  channel = null,
  source_orderid = null,
  source_tran_id = null,
  gateway_payment_id = null,
  invoice_id = null,
  consent_at = null,
  raw_extrap = null,
  created_by = null,
  client = null,
}) {
  const studentId = parseInt(student_id, 10);
  const token = String(fiuu_token || '').trim();
  if (!Number.isFinite(studentId) || studentId <= 0) {
    throw Object.assign(new Error('student_id is required to save FIUU token'), { statusCode: 400 });
  }
  if (!token) {
    throw Object.assign(new Error('fiuu_token is required'), { statusCode: 400 });
  }

  const run = async (q) => {
    await q(
      `UPDATE fiuu_payment_tokenstbl
       SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE student_id = $1 AND status = 'active' AND fiuu_token <> $2`,
      [studentId, token]
    );

    const existing = await q(
      `SELECT fiuu_payment_token_id FROM fiuu_payment_tokenstbl
       WHERE fiuu_token = $1 AND status = 'active'
       LIMIT 1`,
      [token]
    );
    if (existing.rows[0]) {
      const updated = await q(
        `UPDATE fiuu_payment_tokenstbl
         SET student_id = $2,
             installmentinvoiceprofiles_id = COALESCE($3, installmentinvoiceprofiles_id),
             branch_id = COALESCE($4, branch_id),
             fiuu_cust_id = COALESCE($5, fiuu_cust_id),
             card_brand = COALESCE($6, card_brand),
             card_last4 = COALESCE($7, card_last4),
             exp_month = COALESCE($8, exp_month),
             exp_year = COALESCE($9, exp_year),
             channel = COALESCE($10, channel),
             source_orderid = COALESCE($11, source_orderid),
             source_tran_id = COALESCE($12, source_tran_id),
             gateway_payment_id = COALESCE($13, gateway_payment_id),
             invoice_id = COALESCE($14, invoice_id),
             consent_at = COALESCE($15, consent_at),
             raw_extrap = COALESCE($16::jsonb, raw_extrap),
             updated_at = CURRENT_TIMESTAMP
         WHERE fiuu_payment_token_id = $1
         RETURNING *`,
        [
          existing.rows[0].fiuu_payment_token_id,
          studentId,
          installmentinvoiceprofiles_id,
          branch_id,
          fiuu_cust_id,
          card_brand,
          card_last4,
          exp_month,
          exp_year,
          channel,
          source_orderid,
          source_tran_id,
          gateway_payment_id,
          invoice_id,
          consent_at,
          raw_extrap ? JSON.stringify(raw_extrap) : null,
        ]
      );
      return updated.rows[0];
    }

    const inserted = await q(
      `INSERT INTO fiuu_payment_tokenstbl (
         student_id, installmentinvoiceprofiles_id, branch_id,
         fiuu_token, fiuu_cust_id, card_brand, card_last4, exp_month, exp_year,
         channel, source_orderid, source_tran_id, gateway_payment_id, invoice_id,
         status, consent_at, raw_extrap, created_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active',$15,$16::jsonb,$17
       )
       RETURNING *`,
      [
        studentId,
        installmentinvoiceprofiles_id,
        branch_id,
        token,
        fiuu_cust_id,
        card_brand,
        card_last4,
        exp_month,
        exp_year,
        channel,
        source_orderid,
        source_tran_id,
        gateway_payment_id,
        invoice_id,
        consent_at,
        raw_extrap ? JSON.stringify(raw_extrap) : null,
        created_by,
      ]
    );
    return inserted.rows[0];
  };

  if (client) {
    return run((text, params) => client.query(text, params));
  }
  return run(query);
}

/**
 * After FIUU success webhook: persist token if present in extraP.
 * Non-fatal — payment apply must not fail if token save fails.
 */
export async function captureFiuuTokenFromWebhook({
  gatewayRow,
  webhookPayload,
  client = null,
}) {
  const extracted = extractFiuuTokenFromWebhook(webhookPayload);
  if (!extracted) {
    return { saved: false, reason: 'no_token_in_extrap' };
  }

  const studentId = gatewayRow?.student_id;
  if (!studentId) {
    return { saved: false, reason: 'no_student_id' };
  }

  let profileId = null;
  if (gatewayRow.invoice_id) {
    try {
      const q = client
        ? (text, params) => client.query(text, params)
        : query;
      const inv = await q(
        `SELECT installmentinvoiceprofiles_id, branch_id FROM invoicestbl WHERE invoice_id = $1 LIMIT 1`,
        [gatewayRow.invoice_id]
      );
      profileId = inv.rows[0]?.installmentinvoiceprofiles_id || null;
      if (gatewayRow.branch_id == null && inv.rows[0]?.branch_id != null) {
        gatewayRow = { ...gatewayRow, branch_id: inv.rows[0].branch_id };
      }
    } catch (err) {
      console.warn('[fiuu-token] profile lookup failed:', err?.message || err);
    }
  }

  const meta =
    gatewayRow.metadata && typeof gatewayRow.metadata === 'object' ? gatewayRow.metadata : {};
  const consentAt =
    meta.save_card === true || meta.save_card === 'true' ? new Date() : new Date();

  try {
    const row = await saveFiuuPaymentToken({
      student_id: studentId,
      installmentinvoiceprofiles_id:
        profileId || meta.installmentinvoiceprofiles_id || null,
      branch_id: gatewayRow.branch_id || null,
      fiuu_token: extracted.token,
      fiuu_cust_id: extracted.custId || buildFiuuCustId(studentId),
      card_brand: extracted.cardBrand || null,
      card_last4: extracted.cardLast4 || null,
      exp_month: extracted.expMonth || null,
      exp_year: extracted.expYear || null,
      channel: webhookPayload.channel || gatewayRow.fiuu_channel || meta.channel || null,
      source_orderid: gatewayRow.orderid,
      source_tran_id: webhookPayload.tranID || null,
      gateway_payment_id: gatewayRow.gateway_payment_id,
      invoice_id: gatewayRow.invoice_id || null,
      consent_at: consentAt,
      raw_extrap: extracted.extraP,
      created_by: gatewayRow.created_by || null,
      client,
    });
    console.log(
      `[fiuu-token] Saved token for student ${studentId} (id=${row.fiuu_payment_token_id}, last4=${row.card_last4 || 'n/a'})`
    );

    // Bind token to class-scoped auto-debit consent when client opted in on pay link.
    if (meta.parent_autodebit_opt_in) {
      try {
        await upsertAutodebitConsentFromGateway({
          student_id: studentId,
          installmentinvoiceprofiles_id:
            profileId || meta.installmentinvoiceprofiles_id || null,
          class_id: meta.autodebit_class_id || null,
          class_name: meta.autodebit_class_name || null,
          package_id: meta.autodebit_package_id || null,
          branch_id: gatewayRow.branch_id || null,
          gateway_payment_id: gatewayRow.gateway_payment_id,
          fiuu_payment_token_id: row.fiuu_payment_token_id,
          staff_opt_in: true,
          staff_accepted_at: meta.autodebit_staff_accepted_at || new Date().toISOString(),
          staff_accepted_by: meta.autodebit_staff_accepted_by || null,
          parent_opt_in: true,
          parent_accepted_at: meta.parent_autodebit_accepted_at || new Date().toISOString(),
          parent_accepted_via: meta.parent_autodebit_accepted_via || 'pay_link',
          terms_version: meta.autodebit_terms_version || undefined,
          client,
        });
      } catch (consentErr) {
        console.error('[fiuu-token] consent bind failed:', consentErr?.message || consentErr);
      }
    }

    return { saved: true, token_id: row.fiuu_payment_token_id, row };
  } catch (err) {
    console.error('[fiuu-token] Save failed:', err?.message || err);
    return { saved: false, reason: 'save_error', error: err?.message || String(err) };
  }
}

export async function listFiuuPaymentTokensForStudent(studentId, { includeRevoked = false } = {}) {
  const id = parseInt(studentId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw Object.assign(new Error('student_id is required'), { statusCode: 400 });
  }
  const result = await query(
    `SELECT fiuu_payment_token_id, student_id, installmentinvoiceprofiles_id, branch_id,
            fiuu_cust_id, card_brand, card_last4, exp_month, exp_year, channel,
            source_orderid, source_tran_id, invoice_id, status, consent_at,
            created_at, updated_at, revoked_at
     FROM fiuu_payment_tokenstbl
     WHERE student_id = $1
       AND ($2::boolean OR status = 'active')
     ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at DESC`,
    [id, includeRevoked]
  );
  return result.rows.map(sanitizeTokenRow);
}

export async function getActiveFiuuPaymentTokenForStudent(studentId) {
  const id = parseInt(studentId, 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  const result = await query(
    `SELECT *
     FROM fiuu_payment_tokenstbl
     WHERE student_id = $1 AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [id]
  );
  return result.rows[0] || null;
}

export async function revokeFiuuPaymentToken(tokenId, { studentId = null } = {}) {
  const id = parseInt(tokenId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw Object.assign(new Error('token id is required'), { statusCode: 400 });
  }
  const params = [id];
  let sql = `UPDATE fiuu_payment_tokenstbl
              SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
              WHERE fiuu_payment_token_id = $1 AND status = 'active'`;
  if (studentId != null) {
    params.push(parseInt(studentId, 10));
    sql += ` AND student_id = $2`;
  }
  sql += ` RETURNING fiuu_payment_token_id, student_id, status, revoked_at`;
  const result = await query(sql, params);
  if (!result.rows[0]) {
    throw Object.assign(new Error('Active FIUU token not found'), { statusCode: 404 });
  }
  return sanitizeTokenRow(result.rows[0]);
}

function sanitizeTokenRow(row) {
  if (!row) return null;
  const { fiuu_token, raw_extrap, ...safe } = row;
  return {
    ...safe,
    has_token: Boolean(fiuu_token),
    // Never expose raw token to frontend list APIs
  };
}

/** Full row including token — backend MIT only, never send to browser. */
export async function getActiveFiuuPaymentTokenSecretForStudent(studentId) {
  return getActiveFiuuPaymentTokenForStudent(studentId);
}

/** Full row including token by primary key — backend MIT only. */
export async function getFiuuPaymentTokenSecretById(tokenId) {
  const id = parseInt(tokenId, 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  const result = await query(
    `SELECT *
     FROM fiuu_payment_tokenstbl
     WHERE fiuu_payment_token_id = $1 AND status = 'active'
     LIMIT 1`,
    [id]
  );
  return result.rows[0] || null;
}
