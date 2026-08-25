/**
 * FIUU installment auto-debit consent (class / profile scoped).
 * Auto-debit is optional and requires staff + parent Terms acceptance.
 */
import { query } from '../../config/database.js';

/** Bump when legal copy changes; old consents stay on their recorded version. */
export const FIUU_AUTODEBIT_TERMS_VERSION = '2026-03-25-v2';

export const FIUU_AUTODEBIT_TERMS_TITLE =
  'Automatic card payment for installment tuition (this class only)';

export const FIUU_AUTODEBIT_TERMS_BODY = [
  'If you turn this on, you authorize Little Champion Academy (via FIUU) to save your card as a secure token and charge it for future installment invoices for this class enrollment plan only.',
  'What happens next: after this payment succeeds, future installment invoices generated for this same class may be charged automatically to that linked card (when auto-debit is fully enabled).',
  'Charges apply only to unpaid installment invoices for this one class / installment profile. Other classes or programs for the same student are not included.',
  'Auto-debit is optional and stays OFF unless you turn it on and accept these Terms. You may leave it off and pay each invoice with a payment link instead.',
  'If an invoice is already paid, any old payment link will show as already paid and will not charge again.',
  'You or the school may disable auto-debit for this class at any time. Failed charges will fall back to a payment link notification.',
  'Card details are tokenized by FIUU. The school stores a payment token and card display info (brand / last four digits), not the full card number.',
].join('\n\n');

/**
 * Resolve installment + class context for an invoice.
 */
export async function resolveInvoiceAutodebitContext(invoiceId) {
  const id = parseInt(invoiceId, 10);
  if (!Number.isFinite(id) || id <= 0) return null;

  const result = await query(
    `SELECT i.invoice_id,
            i.installmentinvoiceprofiles_id,
            ip.student_id AS profile_student_id,
            ip.class_id,
            c.class_name,
            ip.is_active AS profile_is_active
     FROM invoicestbl i
     LEFT JOIN installmentinvoiceprofilestbl ip
       ON ip.installmentinvoiceprofiles_id = i.installmentinvoiceprofiles_id
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     WHERE i.invoice_id = $1
     LIMIT 1`,
    [id]
  );
  const row = result.rows[0];
  if (!row?.installmentinvoiceprofiles_id) {
    return {
      eligible: false,
      reason: 'full_payment_or_no_profile',
      invoice_id: id,
    };
  }

  return {
    eligible: true,
    invoice_id: id,
    installmentinvoiceprofiles_id: row.installmentinvoiceprofiles_id,
    class_id: row.class_id || null,
    class_name: row.class_name || null,
    student_id: row.profile_student_id || null,
    profile_is_active: row.profile_is_active !== false,
  };
}

/**
 * Package AR installment-like detection (no profile yet).
 */
export function isInstallmentLikePackage({ package_type, payment_option } = {}) {
  const type = String(package_type || '').toLowerCase();
  const option = String(payment_option || '').toLowerCase();
  return type === 'installment' || (type === 'phase' && option === 'installment');
}

export function buildAutodebitMetadataPatch({
  eligible,
  staff_opt_in = false,
  staff_terms_accepted = false,
  staff_accepted_by = null,
  parent_opt_in = false,
  parent_terms_accepted = false,
  parent_accepted_via = null,
  installmentinvoiceprofiles_id = null,
  class_id = null,
  class_name = null,
  package_id = null,
  terms_version = FIUU_AUTODEBIT_TERMS_VERSION,
} = {}) {
  if (!eligible) {
    return {
      autodebit_eligible: false,
      autodebit_offered: false,
      autodebit_staff_opt_in: false,
      parent_autodebit_decision: null,
    };
  }

  // School offers the choice on the client pay link; parent decides there.
  const offered = true;
  return {
    autodebit_eligible: true,
    autodebit_offered: offered,
    autodebit_terms_version: terms_version,
    // Kept for backward compatibility with /go gate checks.
    autodebit_staff_opt_in: offered,
    autodebit_staff_accepted_at: new Date().toISOString(),
    autodebit_staff_accepted_by: staff_accepted_by || null,
    installmentinvoiceprofiles_id: installmentinvoiceprofiles_id || null,
    autodebit_class_id: class_id || null,
    autodebit_class_name: class_name || null,
    autodebit_package_id: package_id || null,
    parent_autodebit_decision: parent_terms_accepted
      ? parent_opt_in
        ? 'accepted'
        : 'declined'
      : null,
    parent_autodebit_opt_in: Boolean(parent_opt_in) && Boolean(parent_terms_accepted),
    parent_autodebit_accepted_at: parent_terms_accepted ? new Date().toISOString() : null,
    parent_autodebit_accepted_via: parent_terms_accepted ? parent_accepted_via : null,
  };
}

/**
 * Upsert consent from a gateway payment after staff/parent decisions + optional token.
 */
export async function upsertAutodebitConsentFromGateway({
  student_id,
  installmentinvoiceprofiles_id = null,
  class_id = null,
  class_name = null,
  package_id = null,
  branch_id = null,
  gateway_payment_id = null,
  fiuu_payment_token_id = null,
  staff_opt_in = false,
  staff_accepted_at = null,
  staff_accepted_by = null,
  parent_opt_in = false,
  parent_accepted_at = null,
  parent_accepted_via = null,
  terms_version = FIUU_AUTODEBIT_TERMS_VERSION,
  client = null,
}) {
  const studentId = parseInt(student_id, 10);
  if (!Number.isFinite(studentId) || studentId <= 0) {
    return { saved: false, reason: 'no_student_id' };
  }

  const bothOptIn = Boolean(parent_opt_in);
  const bothAccepted = Boolean(parent_accepted_at);
  // Enabled when the client (parent) opts in on the pay link; staff only offers the choice.
  const shouldEnable = bothOptIn && bothAccepted;
  const status = shouldEnable ? 'active' : 'pending';

  const run = (text, params) => (client ? client.query(text, params) : query(text, params));

  // Prefer existing active/pending row for this profile.
  let existing = null;
  if (installmentinvoiceprofiles_id) {
    const found = await run(
      `SELECT * FROM fiuu_autodebit_consentstbl
       WHERE installmentinvoiceprofiles_id = $1
         AND status IN ('pending', 'active')
       ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at DESC
       LIMIT 1`,
      [installmentinvoiceprofiles_id]
    );
    existing = found.rows[0] || null;
  } else if (gateway_payment_id) {
    const found = await run(
      `SELECT * FROM fiuu_autodebit_consentstbl
       WHERE gateway_payment_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [gateway_payment_id]
    );
    existing = found.rows[0] || null;
  }

  if (existing) {
    const updated = await run(
      `UPDATE fiuu_autodebit_consentstbl
       SET student_id = $2,
           installmentinvoiceprofiles_id = COALESCE($3, installmentinvoiceprofiles_id),
           class_id = COALESCE($4, class_id),
           package_id = COALESCE($5, package_id),
           branch_id = COALESCE($6, branch_id),
           gateway_payment_id = COALESCE($7, gateway_payment_id),
           fiuu_payment_token_id = COALESCE($8, fiuu_payment_token_id),
           status = $9,
           enabled = $10,
           terms_version = $11,
           staff_opt_in = $12,
           staff_accepted_at = COALESCE($13, staff_accepted_at),
           staff_accepted_by = COALESCE($14, staff_accepted_by),
           parent_opt_in = $15,
           parent_accepted_at = COALESCE($16, parent_accepted_at),
           parent_accepted_via = COALESCE($17, parent_accepted_via),
           class_name_snapshot = COALESCE($18, class_name_snapshot),
           updated_at = CURRENT_TIMESTAMP
       WHERE fiuu_autodebit_consent_id = $1
       RETURNING *`,
      [
        existing.fiuu_autodebit_consent_id,
        studentId,
        installmentinvoiceprofiles_id,
        class_id,
        package_id,
        branch_id,
        gateway_payment_id,
        fiuu_payment_token_id,
        status,
        shouldEnable,
        terms_version,
        Boolean(staff_opt_in),
        staff_accepted_at,
        staff_accepted_by,
        Boolean(parent_opt_in),
        parent_accepted_at,
        parent_accepted_via,
        class_name,
      ]
    );
    return { saved: true, row: updated.rows[0] };
  }

  const inserted = await run(
    `INSERT INTO fiuu_autodebit_consentstbl (
       student_id, installmentinvoiceprofiles_id, class_id, package_id, branch_id,
       gateway_payment_id, fiuu_payment_token_id, status, enabled, terms_version,
       staff_opt_in, staff_accepted_at, staff_accepted_by,
       parent_opt_in, parent_accepted_at, parent_accepted_via, class_name_snapshot
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
     )
     RETURNING *`,
    [
      studentId,
      installmentinvoiceprofiles_id,
      class_id,
      package_id,
      branch_id,
      gateway_payment_id,
      fiuu_payment_token_id,
      status,
      shouldEnable,
      terms_version,
      Boolean(staff_opt_in),
      staff_accepted_at,
      staff_accepted_by,
      Boolean(parent_opt_in),
      parent_accepted_at,
      parent_accepted_via,
      class_name,
    ]
  );
  return { saved: true, row: inserted.rows[0] };
}

export async function disableAutodebitConsent(consentId, { disabled_by = null, reason = null } = {}) {
  const id = parseInt(consentId, 10);
  const result = await query(
    `UPDATE fiuu_autodebit_consentstbl
     SET status = 'disabled',
         enabled = false,
         disabled_at = CURRENT_TIMESTAMP,
         disabled_by = $2,
         disabled_reason = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE fiuu_autodebit_consent_id = $1
       AND status IN ('pending', 'active')
     RETURNING *`,
    [id, disabled_by, reason]
  );
  if (!result.rows[0]) {
    throw Object.assign(new Error('Auto-debit consent not found'), { statusCode: 404 });
  }
  return result.rows[0];
}

export async function getActiveAutodebitConsentForProfile(profileId) {
  const id = parseInt(profileId, 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  const result = await query(
    `SELECT *
     FROM fiuu_autodebit_consentstbl
     WHERE installmentinvoiceprofiles_id = $1
       AND status = 'active'
       AND enabled = true
     ORDER BY created_at DESC
     LIMIT 1`,
    [id]
  );
  return result.rows[0] || null;
}

export async function listAutodebitConsentsForStudent(studentId) {
  const id = parseInt(studentId, 10);
  const result = await query(
    `SELECT c.fiuu_autodebit_consent_id, c.student_id, c.installmentinvoiceprofiles_id,
            c.class_id, c.package_id, c.status, c.enabled, c.terms_version,
            c.staff_opt_in, c.parent_opt_in, c.class_name_snapshot,
            c.created_at, c.updated_at, c.disabled_at,
            cl.class_name
     FROM fiuu_autodebit_consentstbl c
     LEFT JOIN classestbl cl ON cl.class_id = c.class_id
     WHERE c.student_id = $1
     ORDER BY c.created_at DESC`,
    [id]
  );
  return result.rows;
}

export function getAutodebitTermsPayload() {
  return {
    terms_version: FIUU_AUTODEBIT_TERMS_VERSION,
    title: FIUU_AUTODEBIT_TERMS_TITLE,
    body: FIUU_AUTODEBIT_TERMS_BODY,
  };
}
