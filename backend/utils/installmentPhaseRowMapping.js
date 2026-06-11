/**
 * Map installment invoice chains to profile-local phase slots (1..total_phases)
 * for the Student History / Installment Plan phases table.
 */
import { parseTargetPhase } from './balanceInvoice.js';
import { resolveProfilePhaseStart } from './phaseInstallmentUtils.js';

/**
 * Resolve absolute class phase number from a single invoice row.
 * @param {{ remarks?: string, invoice_description?: string }} invoice
 * @returns {number|null}
 */
export function parseAbsolutePhaseFromInvoice(invoice) {
  if (!invoice) return null;

  const fromRemarks = parseTargetPhase(invoice.remarks);
  if (fromRemarks != null && Number.isFinite(fromRemarks)) {
    return fromRemarks;
  }

  const advMatch = String(invoice.remarks || '').match(
    /Advance payment\s*[—\-]\s*Phase\s*(\d+)/i
  );
  if (advMatch) {
    const n = parseInt(advMatch[1], 10);
    if (Number.isFinite(n)) return n;
  }

  const desc = String(invoice.invoice_description || '');
  if (!/^INV-\d+$/i.test(desc.trim())) {
    const descMatch = desc.match(/Phase\s*(\d+)/i);
    if (descMatch) {
      const n = parseInt(descMatch[1], 10);
      if (Number.isFinite(n)) return n;
    }
  }

  return null;
}

/**
 * Profile-local phase slot (1-based) for a chain of invoices.
 * @param {{ representative?: object, invoices?: object[] }} chain
 * @param {{ phase_start?: number|null }} profile
 * @returns {number|null}
 */
export function resolveChainProfileLocalPhase(chain, profile) {
  if (!chain) return null;

  const phaseStart = resolveProfilePhaseStart(profile);
  const candidates = [
    chain.representative,
    ...(Array.isArray(chain.invoices) ? chain.invoices : []),
  ].filter(Boolean);

  for (const inv of candidates) {
    const absolute = parseAbsolutePhaseFromInvoice(inv);
    if (absolute == null) continue;
    const local = absolute - phaseStart + 1;
    if (local >= 1) return local;
  }

  return null;
}

export function sortChainsByBillingOrder(chains) {
  return [...(chains || [])].sort((a, b) => {
    const aIssue = String(a.representative?.issue_date || '').slice(0, 10);
    const bIssue = String(b.representative?.issue_date || '').slice(0, 10);
    if (aIssue && bIssue && aIssue !== bIssue) {
      return aIssue.localeCompare(bIssue);
    }
    if (aIssue && !bIssue) return -1;
    if (!aIssue && bIssue) return 1;
    const aDue = String(a.representative?.due_date || '').slice(0, 10);
    const bDue = String(b.representative?.due_date || '').slice(0, 10);
    if (aDue && bDue && aDue !== bDue) {
      return aDue.localeCompare(bDue);
    }
    return Number(a.chain_root_id) - Number(b.chain_root_id);
  });
}

/**
 * When adjacent generated phase rows have issue_date out of order, swap
 * issue_date and due_date only. Invoice, payment, and paid_amount stay on
 * the TARGET_PHASE slot so paid status is not moved with billing dates.
 *
 * @param {Array<object>} phases
 * @param {(invoiceStatus: string, dueDate: string|null) => string} [computeStatus]
 * @returns {Array<object>}
 */
export function normalizeAdjacentPhaseDisplayDates(phases, computeStatus) {
  if (!Array.isArray(phases) || phases.length < 2) {
    return phases;
  }

  const out = phases.map((p) => ({ ...p }));

  for (let i = 0; i < out.length - 1; i += 1) {
    const a = out[i];
    const b = out[i + 1];
    if (!a?.is_generated || !b?.is_generated) continue;

    const issueA = String(a.issue_date || '').slice(0, 10);
    const issueB = String(b.issue_date || '').slice(0, 10);
    if (!issueA || !issueB || issueA <= issueB) continue;

    [a.issue_date, b.issue_date] = [b.issue_date, a.issue_date];
    [a.due_date, b.due_date] = [b.due_date, a.due_date];

    if (typeof computeStatus === 'function') {
      for (const row of [a, b]) {
        if (row.status === 'Paid' || row.status === 'Cancelled') continue;
        row.status = computeStatus('pending', row.due_date);
      }
    }
  }

  return out;
}

/**
 * Assign each phase chain to a profile-local phase number.
 * Uses TARGET_PHASE / remarks / description when present; otherwise assigns
 * by billing issue_date (earliest cycle = lower phase slot), not invoice_id.
 *
 * @param {Array<{ chain_root_id: number, representative: object, invoices: object[] }>} phaseChains
 * @param {{ phase_start?: number|null, total_phases?: number|null }} profile
 * @returns {Map<number, object>} localPhaseNumber -> chain
 */
export function isAdvancePaymentInvoice(invoice) {
  return /Advance payment\s*[—\-]\s*Phase\s*\d+/i.test(String(invoice?.remarks || ''));
}

export function mapPhaseChainsToLocalSlots(phaseChains, profile) {
  const sorted = [...(phaseChains || [])].sort(
    (a, b) => Number(a.chain_root_id) - Number(b.chain_root_id)
  );

  const chainByLocalPhase = new Map();
  const withoutPhaseHint = [];

  for (const chain of sorted) {
    const local = resolveChainProfileLocalPhase(chain, profile);
    if (local != null && !chainByLocalPhase.has(local)) {
      chainByLocalPhase.set(local, chain);
    } else {
      withoutPhaseHint.push(chain);
    }
  }

  const fallbackSorted = sortChainsByBillingOrder(withoutPhaseHint);
  let nextSlot = 1;
  for (const chain of fallbackSorted) {
    while (chainByLocalPhase.has(nextSlot)) nextSlot += 1;
    chainByLocalPhase.set(nextSlot, chain);
    nextSlot += 1;
  }

  return chainByLocalPhase;
}

const PHASE_OUTSTANDING_EPSILON = 0.009;

/**
 * True when a profile-local installment phase slot has no remaining balance
 * (paid, skipped gap, or fully settled generated invoice).
 *
 * @param {object|null|undefined} phase
 * @returns {boolean}
 */
export function isInstallmentPlanSlotAddressed(phase) {
  if (!phase) return false;
  if (phase.plan_slot_addressed === true) return true;

  const status = String(phase.status || '').toLowerCase();
  if (status.includes('skipped') || phase.billing_kind === 'skipped_gap') {
    return true;
  }
  if (status === 'paid' || status === 'paid all') {
    return true;
  }

  if (!phase.is_generated) {
    return false;
  }

  const amount = phase.amount != null ? Number(phase.amount) : null;
  const paid = Number(phase.paid_amount || 0);
  if (amount != null) {
    return Math.max(0, amount - paid) <= PHASE_OUTSTANDING_EPSILON;
  }

  return paid > PHASE_OUTSTANDING_EPSILON && status === 'paid';
}

/**
 * @param {Array<object>} phases
 * @returns {Array<object>}
 */
export function annotateInstallmentPhasePlanSlots(phases) {
  if (!Array.isArray(phases)) return [];
  return phases.map((phase) => ({
    ...phase,
    plan_slot_addressed: isInstallmentPlanSlotAddressed(phase),
  }));
}
