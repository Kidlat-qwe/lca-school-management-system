/**
 * Block recording payment on a later installment phase when an earlier phase
 * has a partial payment with an unsettled remaining balance on the same profile.
 *
 * @module lib/installmentPaymentEligibility
 */

import {
  getChainFinancialSummary,
  getChainRootInvoiceId,
  resolveInvoiceDisplayDescription,
} from '../utils/balanceInvoice.js';
import {
  mapPhaseChainsToLocalSlots,
  resolveChainProfileLocalPhase,
} from '../utils/installmentPhaseRowMapping.js';

const EPSILON = 0.01;

const isCancelledStatus = (status) => {
  const s = String(status || '').trim().toLowerCase();
  return s === 'cancelled' || s === 'canceled';
};

/**
 * Build phase chains for an installment profile (same grouping as phases API).
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {number} profileId
 * @returns {Promise<{ profile: object, downpaymentInvoiceId: number|null, phaseChains: object[], chainByLocalPhase: Map<number, object> }>}
 */
export async function loadInstallmentProfilePhaseChains(db, profileId) {
  const profileRes = await db.query(
    `SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
    [profileId]
  );
  const profile = profileRes.rows[0];
  if (!profile) {
    return {
      profile: null,
      downpaymentInvoiceId: null,
      phaseChains: [],
      chainByLocalPhase: new Map(),
    };
  }

  const downpaymentInvoiceId =
    profile.downpayment_invoice_id != null ? Number(profile.downpayment_invoice_id) : null;

  const invoicesResult = await db.query(
    `SELECT i.invoice_id,
            i.invoice_description,
            i.invoice_ar_number,
            i.amount,
            i.status,
            i.remarks,
            TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue_date,
            TO_CHAR(i.due_date, 'YYYY-MM-DD')   AS due_date,
            COALESCE(i.invoice_chain_root_id, i.invoice_id) AS chain_root_id,
            i.invoice_chain_root_id,
            i.parent_invoice_id,
            i.balance_invoice_id,
            COALESCE((
              SELECT SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.discount_amount, 0))
              FROM paymenttbl p
              WHERE p.invoice_id = i.invoice_id
                AND p.status = 'Completed'
                AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'
            ), 0)::numeric AS paid_total_for_invoice
     FROM invoicestbl i
     WHERE i.installmentinvoiceprofiles_id = $1
     ORDER BY i.issue_date ASC NULLS LAST, i.invoice_id ASC`,
    [profileId]
  );

  const chains = new Map();
  for (const inv of invoicesResult.rows) {
    const chainRoot = Number(inv.chain_root_id);
    if (!chains.has(chainRoot)) {
      chains.set(chainRoot, {
        chain_root_id: chainRoot,
        representative: inv,
        paid_amount: 0,
        invoices: [],
      });
    }
    const chain = chains.get(chainRoot);
    chain.invoices.push(inv);
    chain.paid_amount += Number(inv.paid_total_for_invoice || 0);
    const currentRep = chain.representative;
    if (
      (inv.issue_date || '') > (currentRep.issue_date || '') ||
      ((inv.issue_date || '') === (currentRep.issue_date || '') &&
        Number(inv.invoice_id) > Number(currentRep.invoice_id))
    ) {
      chain.representative = inv;
    }
  }

  const phaseChains = [];
  for (const chain of chains.values()) {
    if (downpaymentInvoiceId && chain.chain_root_id === downpaymentInvoiceId) {
      continue;
    }
    phaseChains.push(chain);
  }

  const chainByLocalPhase = mapPhaseChainsToLocalSlots(phaseChains, profile);

  return {
    profile,
    downpaymentInvoiceId,
    phaseChains,
    chainByLocalPhase,
  };
}

function findLocalPhaseForChainRoot(chainByLocalPhase, chainRootId) {
  const root = Number(chainRootId);
  for (const [localPhase, chain] of chainByLocalPhase.entries()) {
    if (Number(chain.chain_root_id) === root) {
      return localPhase;
    }
  }
  return null;
}

async function describeOpenPartialChain(client, chain, profile) {
  const summary = await getChainFinancialSummary(client, chain.chain_root_id);
  const hasPartial = summary.total_paid_in_chain >= EPSILON;
  const hasRemaining = summary.remaining_on_leaf >= EPSILON;
  if (!hasPartial || !hasRemaining) {
    return null;
  }

  const rep = chain.representative;
  const displayDescription = await resolveInvoiceDisplayDescription(client, rep);
  const localPhase = resolveChainProfileLocalPhase(chain, profile);
  const phaseStart = profile?.phase_start != null ? Number(profile.phase_start) : 1;
  const absolutePhase =
    localPhase != null && Number.isFinite(phaseStart)
      ? phaseStart + localPhase - 1
      : null;

  const payableId = summary.payable_invoice_id;
  const label =
    displayDescription ||
    rep?.invoice_description ||
    (rep?.invoice_ar_number ? String(rep.invoice_ar_number) : null) ||
    `INV-${payableId}`;

  return {
    chain_root_id: chain.chain_root_id,
    profile_local_phase: localPhase,
    absolute_phase: absolutePhase,
    phase_label:
      absolutePhase != null ? `Phase ${absolutePhase}` : localPhase != null ? `Phase ${localPhase}` : 'a prior phase',
    invoice_id: payableId,
    payable_invoice_id: payableId,
    display_description: label,
    remaining_balance: summary.remaining_on_leaf,
    total_paid: summary.total_paid_in_chain,
    status: rep?.status || null,
  };
}

/**
 * Prior-phase partial balances that block payment on the target invoice.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} client
 * @param {number|string} invoiceId
 * @returns {Promise<{ blocked: boolean, message: string|null, prior_balances: object[] }>}
 */
export async function getPriorPartialBalanceBlockers(client, invoiceId) {
  const invRes = await client.query(
    `SELECT invoice_id, installmentinvoiceprofiles_id, status, balance_invoice_id
     FROM invoicestbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const invoice = invRes.rows[0];
  if (!invoice?.installmentinvoiceprofiles_id) {
    return { blocked: false, message: null, prior_balances: [] };
  }

  if (isCancelledStatus(invoice.status) || String(invoice.status || '').trim() === 'Paid') {
    return { blocked: false, message: null, prior_balances: [] };
  }

  const profileId = Number(invoice.installmentinvoiceprofiles_id);
  const { profile, chainByLocalPhase } = await loadInstallmentProfilePhaseChains(client, profileId);
  if (!profile) {
    return { blocked: false, message: null, prior_balances: [] };
  }

  const currentChainRoot = await getChainRootInvoiceId(client, invoiceId);
  const currentLocalPhase = findLocalPhaseForChainRoot(chainByLocalPhase, currentChainRoot);

  const priorBalances = [];

  for (const [localPhase, chain] of chainByLocalPhase.entries()) {
    if (Number(chain.chain_root_id) === Number(currentChainRoot)) {
      continue;
    }

    const isPrior =
      currentLocalPhase != null
        ? localPhase < currentLocalPhase
        : Number(chain.chain_root_id) < Number(currentChainRoot);

    if (!isPrior) {
      continue;
    }

    const openPartial = await describeOpenPartialChain(client, chain, profile);
    if (openPartial) {
      priorBalances.push(openPartial);
    }
  }

  priorBalances.sort((a, b) => {
    const ap = a.profile_local_phase ?? 0;
    const bp = b.profile_local_phase ?? 0;
    return ap - bp;
  });

  if (priorBalances.length === 0) {
    return { blocked: false, message: null, prior_balances: [] };
  }

  const detailLines = priorBalances.map((p) => {
    const amt = Number(p.remaining_balance || 0).toFixed(2);
    return `${p.phase_label} (${p.display_description}, remaining ₱${amt})`;
  });

  const message =
    priorBalances.length === 1
      ? `This student has an unsettled balance from a partial payment on ${priorBalances[0].phase_label} (${priorBalances[0].display_description}). Settle that balance before recording payment on this invoice.`
      : `This student has unsettled balances from partial payments on earlier phases: ${detailLines.join('; ')}. Settle those balances before recording payment on this invoice.`;

  return {
    blocked: true,
    message,
    prior_balances: priorBalances,
  };
}

/**
 * Block advance-pay when any profile-local phase before phase_index has open partial balance.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} client
 * @param {number} profileId
 * @param {number} phaseIndex - 1-based profile-local phase index
 */
export async function getAdvancePayPriorPartialBlockers(client, profileId, phaseIndex) {
  const phaseIdx = parseInt(phaseIndex, 10);
  if (!Number.isFinite(phaseIdx) || phaseIdx < 1) {
    return { blocked: false, message: null, prior_balances: [] };
  }

  const { profile, chainByLocalPhase } = await loadInstallmentProfilePhaseChains(client, profileId);
  if (!profile) {
    return { blocked: false, message: null, prior_balances: [] };
  }

  const priorBalances = [];

  for (const [localPhase, chain] of chainByLocalPhase.entries()) {
    if (localPhase >= phaseIdx) {
      continue;
    }
    const openPartial = await describeOpenPartialChain(client, chain, profile);
    if (openPartial) {
      priorBalances.push(openPartial);
    }
  }

  if (priorBalances.length === 0) {
    return { blocked: false, message: null, prior_balances: [] };
  }

  const detailLines = priorBalances.map((p) => {
    const amt = Number(p.remaining_balance || 0).toFixed(2);
    return `${p.phase_label} (${p.display_description}, remaining ₱${amt})`;
  });

  const message =
    `Cannot record advance payment for phase ${phaseIdx}. The student has unsettled partial-payment balance on: ${detailLines.join('; ')}. Settle those balances first.`;

  return {
    blocked: true,
    message,
    prior_balances: priorBalances,
  };
}

/**
 * Combined eligibility for recording payment on an installment invoice.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} client
 * @param {number|string} invoiceId
 */
export async function evaluateInstallmentPaymentEligibility(client, invoiceId) {
  const prior = await getPriorPartialBalanceBlockers(client, invoiceId);
  return {
    prior_partial_balance_block: prior,
    can_record_payment: !prior.blocked,
  };
}
