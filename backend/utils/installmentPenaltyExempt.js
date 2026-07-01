import { parseAbsolutePhaseFromInvoice } from './installmentPhaseRowMapping.js';
import { resolveProfilePhaseStart } from './phaseInstallmentUtils.js';

/**
 * Profile-local phase slot (1..N) for an installment invoice chain.
 */
export const resolveLocalPhaseForInstallmentInvoice = async (client, { invoiceId, profileId }) => {
  const invRes = await client.query(
    `SELECT invoice_id, remarks, invoice_description, issue_date
     FROM invoicestbl
     WHERE invoice_id = $1`,
    [invoiceId]
  );
  if (!invRes.rows.length) return null;

  const inv = invRes.rows[0];
  const absolute = parseAbsolutePhaseFromInvoice(inv);
  if (absolute != null && Number.isFinite(absolute)) {
    const profileRes = await client.query(
      `SELECT phase_start FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
      [profileId]
    );
    const phaseStart = resolveProfilePhaseStart(profileRes.rows[0]);
    const local = absolute - phaseStart + 1;
    return local >= 1 ? local : null;
  }

  const listRes = await client.query(
    `SELECT invoice_id
     FROM invoicestbl
     WHERE installmentinvoiceprofiles_id = $1
       AND COALESCE(invoice_description, '') NOT ILIKE '%downpayment%'
     ORDER BY issue_date ASC NULLS LAST, invoice_id ASC`,
    [profileId]
  );
  const idx = listRes.rows.findIndex((r) => r.invoice_id === invoiceId);
  return idx >= 0 ? idx + 1 : null;
};

const resolveChainRootId = (invoiceRow) =>
  Number(invoiceRow?.invoice_chain_root_id || invoiceRow?.invoice_id);

/**
 * Penalty/overdue-exempt installment invoices:
 * - Downpayment invoice (when the plan has one)
 * - Profile-local phase 1 (first phase invoice), even when downpayment exists
 */
export const isInstallmentPenaltyExemptInvoice = async (client, { invoiceId, profileId }) => {
  if (!invoiceId || !profileId) return false;

  const profileRes = await client.query(
    `SELECT downpayment_invoice_id, phase_start
     FROM installmentinvoiceprofilestbl
     WHERE installmentinvoiceprofiles_id = $1`,
    [profileId]
  );
  const profile = profileRes.rows[0];
  if (!profile) return false;

  const invRes = await client.query(
    `SELECT invoice_id, invoice_chain_root_id, invoice_description, remarks
     FROM invoicestbl
     WHERE invoice_id = $1`,
    [invoiceId]
  );
  const inv = invRes.rows[0];
  if (!inv) return false;

  const chainRootId = resolveChainRootId(inv);
  const downpaymentId =
    profile.downpayment_invoice_id != null
      ? Number(profile.downpayment_invoice_id)
      : null;

  if (downpaymentId != null && (chainRootId === downpaymentId || Number(invoiceId) === downpaymentId)) {
    return true;
  }

  const localPhase = await resolveLocalPhaseForInstallmentInvoice(client, {
    invoiceId,
    profileId,
  });
  return localPhase === 1;
};

/**
 * Sync helper when plan position is already known (installment phases API).
 */
export const isPenaltyExemptByPlanPosition = ({ localPhaseNumber }) =>
  Number(localPhaseNumber) === 1;
