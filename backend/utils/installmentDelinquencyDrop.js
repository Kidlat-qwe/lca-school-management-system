/**
 * Installment delinquency auto-drop — shared by the daily job and plan/phases API sync.
 *
 * @module utils/installmentDelinquencyDrop
 */

import { getChainFinancialSummary, getChainRootInvoiceId } from './balanceInvoice.js';
import { formatYmdLocal, parseYmdToLocalNoon } from './dateUtils.js';
import { getEffectiveSettings, SETTINGS_DEFINITIONS } from './settingsService.js';
import { resolveLocalPhaseForInstallmentInvoice } from './installmentPenaltyExempt.js';
import { resolveProfilePhaseStart } from './phaseInstallmentUtils.js';

const EPSILON = 0.01;

const getDefaultBillingSettings = () => ({
  installment_final_dropoff_days: {
    value: SETTINGS_DEFINITIONS.installment_final_dropoff_days.defaultValue,
    scope: 'default',
  },
});

const addDaysLocalNoon = (dateObj, days) => {
  const baseYmd = formatYmdLocal(dateObj);
  const base = parseYmdToLocalNoon(baseYmd);
  if (!base) return null;
  const d = new Date(base);
  d.setDate(d.getDate() + (Number(days) || 0));
  return d;
};

const isOnOrAfterDate = (a, b) => {
  const ay = a ? formatYmdLocal(a) : null;
  const by = b ? formatYmdLocal(b) : null;
  if (!ay || !by) return false;
  return ay >= by;
};

/**
 * @param {import('pg').PoolClient} client
 * @param {{ invoiceId: number|string, profileId: number|string }} params
 * @returns {Promise<number|null>} absolute class phase_number
 */
export async function resolveAbsolutePhaseForInstallmentInvoice(client, { invoiceId, profileId }) {
  const localPhase = await resolveLocalPhaseForInstallmentInvoice(client, { invoiceId, profileId });
  if (localPhase == null || !Number.isFinite(Number(localPhase))) return null;

  const profileRes = await client.query(
    `SELECT phase_start FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
    [profileId]
  );
  const phaseStart = resolveProfilePhaseStart(profileRes.rows[0]);
  return phaseStart + Number(localPhase) - 1;
}

async function loadFinalDropoffDays(client, branchId) {
  try {
    const effective = await getEffectiveSettings(
      client,
      ['installment_final_dropoff_days'],
      branchId != null ? Number(branchId) : null
    );
    const days = Number(effective.installment_final_dropoff_days?.value);
    return Number.isFinite(days)
      ? days
      : SETTINGS_DEFINITIONS.installment_final_dropoff_days.defaultValue;
  } catch {
    return SETTINGS_DEFINITIONS.installment_final_dropoff_days.defaultValue;
  }
}

/**
 * @returns {Promise<{ eligible: boolean, reason?: string, summary?: object, finalDropoffDays?: number }>}
 */
export async function evaluateDelinquencyDropForChain(client, { chainRootId, dueDate, branchId }) {
  if (!chainRootId || !dueDate) {
    return { eligible: false, reason: 'missing_chain_or_due_date' };
  }

  const summary = await getChainFinancialSummary(client, chainRootId);
  if (summary.remaining_on_leaf <= EPSILON) {
    return { eligible: false, reason: 'settled', summary };
  }

  const hasPartialPayment =
    summary.total_paid_in_chain > EPSILON && summary.remaining_on_leaf > EPSILON;
  if (hasPartialPayment) {
    return { eligible: false, reason: 'partial_payment', summary };
  }

  const finalDropoffDays = await loadFinalDropoffDays(client, branchId);
  const dropoffThreshold = addDaysLocalNoon(dueDate, finalDropoffDays);
  const today = new Date();
  if (!dropoffThreshold || !isOnOrAfterDate(today, dropoffThreshold)) {
    return { eligible: false, reason: 'before_dropoff_threshold', summary, finalDropoffDays };
  }

  return { eligible: true, summary, finalDropoffDays };
}

/**
 * Mark student dropped for an absolute class phase (update active row or insert drop marker).
 *
 * @returns {Promise<boolean>} true when a row was created or updated
 */
export async function applyDelinquencyDropForAbsolutePhase(
  client,
  { studentId, classId, absolutePhase, finalDropoffDays, dueDateYmd = null }
) {
  const sid = Number(studentId);
  const cid = Number(classId);
  const phase = Number(absolutePhase);
  if (!sid || !cid || !Number.isFinite(phase) || phase < 1) return false;

  const reason = `Installment delinquency (>= ${finalDropoffDays} days after due date${
    dueDateYmd ? ` ${dueDateYmd}` : ''
  })`;

  const updateRes = await client.query(
    `UPDATE classstudentstbl
     SET program_enrollment_status = 'dropped',
         removed_at = CURRENT_TIMESTAMP,
         removed_reason = $1,
         removed_by = $2
     WHERE class_id = $3
       AND student_id = $4
       AND COALESCE(phase_number, 1) = $5
       AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'pending_enrollment', 'reserved')
       AND removed_at IS NULL`,
    [reason, 'System', cid, sid, phase]
  );

  if ((updateRes.rowCount || 0) > 0) {
    return true;
  }

  const existingDropped = await client.query(
    `SELECT classstudent_id
     FROM classstudentstbl
     WHERE class_id = $1
       AND student_id = $2
       AND COALESCE(phase_number, 1) = $3
       AND program_enrollment_status = 'dropped'
     LIMIT 1`,
    [cid, sid, phase]
  );
  if (existingDropped.rows.length > 0) {
    return false;
  }

  await client.query(
    `INSERT INTO classstudentstbl (
       student_id, class_id, enrolled_by, phase_number,
       program_enrollment_status, enrolled_at, removed_at, removed_reason, removed_by
     )
     VALUES ($1, $2, $3, $4, 'dropped', CURRENT_TIMESTAMP - INTERVAL '1 second', CURRENT_TIMESTAMP, $5, $6)`,
    [sid, cid, 'System (Installment delinquency)', phase, reason, 'System']
  );
  return true;
}

/**
 * Apply drop for one overdue installment invoice chain when eligible.
 *
 * @returns {Promise<{ applied: boolean, absolutePhase?: number|null, reason?: string }>}
 */
export async function applyDelinquencyDropForInvoiceChain(
  client,
  { invoiceId, profileId, studentId, classId, branchId, dueDate }
) {
  const chainRootId = await getChainRootInvoiceId(client, invoiceId);
  const evaluation = await evaluateDelinquencyDropForChain(client, {
    chainRootId,
    dueDate,
    branchId,
  });

  if (!evaluation.eligible) {
    return { applied: false, reason: evaluation.reason };
  }

  const absolutePhase = await resolveAbsolutePhaseForInstallmentInvoice(client, {
    invoiceId: chainRootId,
    profileId,
  });

  if (absolutePhase == null) {
    return { applied: false, reason: 'phase_unresolved' };
  }

  const applied = await applyDelinquencyDropForAbsolutePhase(client, {
    studentId,
    classId,
    absolutePhase,
    finalDropoffDays: evaluation.finalDropoffDays,
    dueDateYmd: dueDate ? formatYmdLocal(dueDate) : null,
  });

  return { applied, absolutePhase, reason: applied ? 'dropped' : 'already_dropped' };
}

/**
 * Sync auto-drops for all overdue unpaid chains on one installment profile (plan view).
 *
 * @returns {Promise<{ dropsApplied: number, scanned: number }>}
 */
export async function syncInstallmentDelinquencyDropsForProfile(client, profileId) {
  const profileRes = await client.query(
    `SELECT installmentinvoiceprofiles_id, student_id, class_id, branch_id
     FROM installmentinvoiceprofilestbl
     WHERE installmentinvoiceprofiles_id = $1`,
    [profileId]
  );
  const profile = profileRes.rows[0];
  if (!profile?.student_id || !profile?.class_id) {
    return { dropsApplied: 0, scanned: 0 };
  }

  const invoicesRes = await client.query(
    `SELECT DISTINCT ON (COALESCE(i.invoice_chain_root_id, i.invoice_id))
            i.invoice_id,
            COALESCE(i.invoice_chain_root_id, i.invoice_id) AS chain_root_id,
            i.due_date,
            i.status
     FROM invoicestbl i
     WHERE i.installmentinvoiceprofiles_id = $1
       AND i.status NOT IN ('Paid', 'Cancelled')
       AND i.due_date IS NOT NULL
       AND i.due_date < CURRENT_DATE
     ORDER BY COALESCE(i.invoice_chain_root_id, i.invoice_id), i.invoice_id DESC`,
    [profileId]
  );

  let dropsApplied = 0;
  const scanned = invoicesRes.rows.length;

  for (const row of invoicesRes.rows) {
    const result = await applyDelinquencyDropForInvoiceChain(client, {
      invoiceId: row.chain_root_id,
      profileId,
      studentId: profile.student_id,
      classId: profile.class_id,
      branchId: profile.branch_id,
      dueDate: row.due_date,
    });
    if (result.applied) dropsApplied += 1;
  }

  return { dropsApplied, scanned };
}
