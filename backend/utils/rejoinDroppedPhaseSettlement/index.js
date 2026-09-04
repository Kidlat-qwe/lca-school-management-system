/**
 * Rejoin after drop — payable amount + supersede open dropped-phase invoices (Policy A).
 *
 * Policy:
 * - Overdue but not dropped: invoice stays payable.
 * - Fully unpaid dropped phase: not payable on Invoice page; pay via Rejoin (later phase).
 * - Partially paid then dropped: remaining IS payable (settle first); then continue next phase as re_enrolled.
 * - Rejoin target phase must be **strictly after** the highest dropped phase
 *   (dropped Phase 2 → minimum target Phase 3), and blocked while partial remaining is open.
 * - Later-phase rejoin (fully unpaid drop path): charge full target-phase amount; supersede
 *   earlier fully unpaid dropped chains only (never write off partial remaining).
 * - Rejoin invoice due date = first session date of the target phase.
 *
 * @module utils/rejoinDroppedPhaseSettlement
 */

import {
  getChainFinancialSummary,
  parseTargetPhase,
} from '../balanceInvoice.js';
import { loadInstallmentProfilePhaseChains } from '../../lib/installmentPaymentEligibility.js';
import { parseAbsolutePhaseFromInvoice } from '../installmentPhaseRowMapping.js';
import { resolveProfilePhaseStart } from '../phaseInstallmentUtils.js';
import { coerceToManilaYmd } from '../dateUtils.js';

const EPSILON = 0.01;

const isCancelledStatus = (status) => {
  const s = String(status || '').trim().toLowerCase();
  return s === 'cancelled' || s === 'canceled';
};

const roundCurrency = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Due date for a rejoin invoice = first session date of the target class phase.
 * Returns YYYY-MM-DD (Manila) or null when no session exists.
 */
export async function resolveRejoinInvoiceDueDateYmd(client, { classId, phaseNumber }) {
  const cid = Number(classId);
  const phase = Number(phaseNumber);
  if (!cid || !Number.isFinite(phase) || phase < 1) return null;

  const result = await client.query(
    `SELECT TO_CHAR(
       TIMEZONE('Asia/Manila', MIN(scheduled_date)),
       'YYYY-MM-DD'
     ) AS first_session_ymd
     FROM classsessionstbl
     WHERE class_id = $1
       AND phase_number = $2`,
    [cid, phase]
  );

  const ymd =
    coerceToManilaYmd(result.rows[0]?.first_session_ymd, { fallbackToToday: false }) ||
    null;
  return ymd || null;
}

/**
 * Absolute class phase for a phase chain on an installment profile.
 */
export function resolveAbsolutePhaseForChain(chain, profile) {
  if (!chain || !profile) return null;
  const fromRep = parseAbsolutePhaseFromInvoice(chain.representative);
  if (fromRep != null) return fromRep;
  for (const inv of chain.invoices || []) {
    const p = parseAbsolutePhaseFromInvoice(inv);
    if (p != null) return p;
  }
  const phaseStart = resolveProfilePhaseStart(profile);
  // Fallback: local slot index is not on the chain object here — use remarks TARGET_PHASE only.
  const remarkPhase = parseTargetPhase(chain.representative?.remarks);
  if (remarkPhase != null) return remarkPhase;
  return phaseStart;
}

/**
 * Find open (remaining > 0) installment chain for an absolute class phase.
 *
 * @returns {Promise<null | { chain, summary, absolute_phase: number }>}
 */
export async function findOpenInstallmentChainForAbsolutePhase(client, profileId, absolutePhase) {
  const pid = Number(profileId);
  const phase = Number(absolutePhase);
  if (!pid || !Number.isFinite(phase) || phase < 1) return null;

  const { profile, phaseChains, chainByLocalPhase } = await loadInstallmentProfilePhaseChains(
    client,
    pid
  );
  if (!profile) return null;

  const phaseStart = resolveProfilePhaseStart(profile);
  const candidates = [];

  for (const [localPhase, chain] of chainByLocalPhase.entries()) {
    const abs = phaseStart + Number(localPhase) - 1;
    if (abs === phase) candidates.push(chain);
  }

  for (const chain of phaseChains) {
    let abs = parseAbsolutePhaseFromInvoice(chain.representative);
    if (abs == null) {
      for (const inv of chain.invoices || []) {
        abs = parseAbsolutePhaseFromInvoice(inv);
        if (abs != null) break;
      }
    }
    if (abs === phase) candidates.push(chain);
  }

  const seen = new Set();
  for (const chain of candidates) {
    const root = Number(chain.chain_root_id);
    if (!root || seen.has(root)) continue;
    seen.add(root);
    if (isCancelledStatus(chain.representative?.status)) continue;

    const summary = await getChainFinancialSummary(client, root);
    if (summary.remaining_on_leaf <= EPSILON) continue;

    const leafStatus = (
      await client.query(`SELECT status FROM invoicestbl WHERE invoice_id = $1`, [
        summary.leaf_invoice_id,
      ])
    ).rows[0]?.status;
    if (isCancelledStatus(leafStatus) || leafStatus === 'Paid') continue;

    return { chain, summary, absolute_phase: phase, phase_start: phaseStart };
  }

  return null;
}

/**
 * Resolve how much Rejoin should charge for the target phase.
 *
 * @returns {{ payable_amount: number, source: 'remaining'|'full_phase', open_chain: object|null }}
 */
export async function resolveRejoinPayableForPhase(client, {
  profileId,
  absolutePhase,
  fullPhaseAmount,
}) {
  const full = roundCurrency(fullPhaseAmount);
  const open = profileId
    ? await findOpenInstallmentChainForAbsolutePhase(client, profileId, absolutePhase)
    : null;

  if (open && open.summary.remaining_on_leaf > EPSILON) {
    return {
      payable_amount: roundCurrency(open.summary.remaining_on_leaf),
      source: 'remaining',
      open_chain: open,
      leaf_invoice_id: open.summary.leaf_invoice_id,
      root_invoice_id: open.summary.root_invoice_id,
      total_paid_in_chain: open.summary.total_paid_in_chain,
    };
  }

  return {
    payable_amount: full,
    source: 'full_phase',
    open_chain: null,
    leaf_invoice_id: null,
    root_invoice_id: null,
    total_paid_in_chain: 0,
  };
}

/**
 * Highest absolute dropped enrollment phase for student+class, or null.
 */
export async function resolveMaxDroppedEnrollmentPhase(client, { studentId, classId }) {
  const sid = Number(studentId);
  const cid = Number(classId);
  if (!sid || !cid) return null;

  const result = await client.query(
    `SELECT MAX(phase_number)::int AS max_dropped
     FROM classstudentstbl
     WHERE student_id = $1
       AND class_id = $2
       AND program_enrollment_status = 'dropped'`,
    [sid, cid]
  );
  const maxDropped = Number(result.rows[0]?.max_dropped);
  if (!Number.isFinite(maxDropped) || maxDropped < 1) return null;
  return maxDropped;
}

/**
 * Minimum allowed rejoin target = highest dropped phase + 1.
 * Returns null when the student has no dropped enrollment in the class.
 */
export async function resolveMinRejoinPhaseAfterDrop(client, { studentId, classId }) {
  const maxDropped = await resolveMaxDroppedEnrollmentPhase(client, { studentId, classId });
  if (maxDropped == null) return null;
  return maxDropped + 1;
}

/**
 * Open dropped phases that already have payment (partial-drop) and still have remaining.
 * Rejoin / later-phase continue must settle these first.
 *
 * @returns {Promise<Array<{ absolute_phase: number, remaining: number, leaf_invoice_id: number|null, total_paid: number }>>}
 */
export async function findOpenPartialDroppedPhases(client, {
  studentId,
  classId,
  profileId,
}) {
  const sid = Number(studentId);
  const cid = Number(classId);
  const pid = Number(profileId);
  if (!sid || !cid || !pid) return [];

  const droppedRes = await client.query(
    `SELECT DISTINCT COALESCE(phase_number, 0)::int AS phase_number
     FROM classstudentstbl
     WHERE student_id = $1
       AND class_id = $2
       AND program_enrollment_status = 'dropped'
       AND COALESCE(phase_number, 0) >= 1
     ORDER BY 1`,
    [sid, cid]
  );

  const open = [];
  for (const row of droppedRes.rows) {
    const absolutePhase = Number(row.phase_number);
    const activeExists = await client.query(
      `SELECT 1
       FROM classstudentstbl
       WHERE student_id = $1
         AND class_id = $2
         AND COALESCE(phase_number, 0) = $3
         AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'pending_enrollment')
         AND removed_at IS NULL
       LIMIT 1`,
      [sid, cid, absolutePhase]
    );
    if (activeExists.rows.length > 0) continue;

    const found = await findOpenInstallmentChainForAbsolutePhase(client, pid, absolutePhase);
    if (!found) continue;
    const paid = Number(found.summary.total_paid_in_chain || 0);
    const remaining = Number(found.summary.remaining_on_leaf || 0);
    if (paid > EPSILON && remaining > EPSILON) {
      open.push({
        absolute_phase: absolutePhase,
        remaining: roundCurrency(remaining),
        leaf_invoice_id: found.summary.leaf_invoice_id,
        total_paid: roundCurrency(paid),
      });
    }
  }

  return open;
}

/**
 * Block rejoin when a prior dropped phase still has partial remaining to settle.
 *
 * @returns {Promise<{ blocked: boolean, message: string|null, phases: Array }>}
 */
export async function getPartialDroppedSettleBlockBeforeRejoin(client, {
  studentId,
  classId,
  profileId,
}) {
  const phases = await findOpenPartialDroppedPhases(client, {
    studentId,
    classId,
    profileId,
  });
  if (!phases.length) {
    return { blocked: false, message: null, phases: [] };
  }
  const labels = phases
    .map((p) => `Phase ${p.absolute_phase} (₱${Number(p.remaining).toFixed(2)})`)
    .join(', ');
  return {
    blocked: true,
    phases,
    message:
      `Settle the remaining balance on the dropped phase(s) before rejoining: ${labels}. ` +
      `Use Pay Now on that phase in Student History → Installment.`,
  };
}

/**
 * True when the student has a dropped enrollment for class+phase and no active row.
 */
export async function isPhaseEnrollmentDroppedWithoutActive(client, {
  studentId,
  classId,
  absolutePhase,
}) {
  const sid = Number(studentId);
  const cid = Number(classId);
  const phase = Number(absolutePhase);
  if (!sid || !cid || !Number.isFinite(phase)) return false;

  const active = await client.query(
    `SELECT 1
     FROM classstudentstbl
     WHERE student_id = $1
       AND class_id = $2
       AND COALESCE(phase_number, 0) = $3
       AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'pending_enrollment')
       AND removed_at IS NULL
     LIMIT 1`,
    [sid, cid, phase]
  );
  if (active.rows.length > 0) return false;

  const dropped = await client.query(
    `SELECT 1
     FROM classstudentstbl
     WHERE student_id = $1
       AND class_id = $2
       AND COALESCE(phase_number, 0) = $3
       AND program_enrollment_status = 'dropped'
     LIMIT 1`,
    [sid, cid, phase]
  );
  return dropped.rows.length > 0;
}

/**
 * Mark an open invoice leaf (and optionally note the chain) as Cancelled / superseded by rejoin.
 */
async function supersedeInvoiceLeaf(client, {
  leafInvoiceId,
  rejoinPhase,
  rejoinInvoiceId = null,
  reason = 'Dropped phase superseded by rejoin (Policy A)',
}) {
  const leafId = Number(leafInvoiceId);
  if (!leafId) return false;

  const row = await client.query(
    `SELECT invoice_id, status, remarks, balance_invoice_id
     FROM invoicestbl WHERE invoice_id = $1 FOR UPDATE`,
    [leafId]
  );
  const inv = row.rows[0];
  if (!inv) return false;
  if (inv.balance_invoice_id) return false; // not a leaf
  if (String(inv.status) === 'Paid' || isCancelledStatus(inv.status)) return false;

  const tagParts = [
    'DROPPED_NOT_PAYABLE',
    `SUPERSEDED_BY_REJOIN_PHASE:${rejoinPhase}`,
    reason,
  ];
  if (rejoinInvoiceId) {
    tagParts.push(`SUPERSEDED_BY_INVOICE:${rejoinInvoiceId}`);
  }
  const tag = tagParts.join(';');
  const nextRemarks = [String(inv.remarks || '').trim(), tag].filter(Boolean).join(';');

  await client.query(
    `UPDATE invoicestbl
     SET status = 'Cancelled',
         remarks = $1
     WHERE invoice_id = $2`,
    [nextRemarks, leafId]
  );
  return true;
}

/**
 * Policy A: after (or as part of) rejoin, supersede open invoice chains for
 * dropped phases at or below the rejoin phase that still have remaining balance.
 *
 * - Same-phase rejoin: supersede that phase's open chain (new rejoin invoice collects remaining).
 * - Later-phase rejoin: supersede earlier open dropped-phase chains (write-off / not collectable).
 *
 * @returns {Promise<{ superseded_leaf_ids: number[] }>}
 */
export async function supersedeOpenDroppedPhaseChainsForRejoin(client, {
  profileId,
  studentId,
  classId,
  rejoinPhase,
  rejoinInvoiceId = null,
}) {
  const pid = Number(profileId);
  const sid = Number(studentId);
  const cid = Number(classId);
  const phase = Number(rejoinPhase);
  const superseded = [];

  if (!pid || !sid || !cid || !Number.isFinite(phase)) {
    return { superseded_leaf_ids: superseded };
  }

  const { profile, phaseChains, chainByLocalPhase } = await loadInstallmentProfilePhaseChains(
    client,
    pid
  );
  if (!profile) return { superseded_leaf_ids: superseded };

  const phaseStart = resolveProfilePhaseStart(profile);
  const seenRoots = new Set();

  const considerChain = async (chain, absolutePhase) => {
    if (!chain || absolutePhase == null) return;
    if (absolutePhase > phase) return; // never touch future phases
    const root = Number(chain.chain_root_id);
    if (seenRoots.has(root)) return;
    seenRoots.add(root);

    const dropped = await isPhaseEnrollmentDroppedWithoutActive(client, {
      studentId: sid,
      classId: cid,
      absolutePhase,
    });
    if (!dropped) return;

    const summary = await getChainFinancialSummary(client, root);
    if (summary.remaining_on_leaf <= EPSILON) return;

    // Never write off partial-payment remaining — staff must settle that chain first.
    if (summary.total_paid_in_chain > EPSILON) return;

    const ok = await supersedeInvoiceLeaf(client, {
      leafInvoiceId: summary.leaf_invoice_id,
      rejoinPhase: phase,
      rejoinInvoiceId,
      reason:
        absolutePhase === phase
          ? 'Same-phase rejoin settled remaining on new rejoin invoice; prior leaf closed'
          : 'Policy A: earlier fully unpaid dropped phase written off on later-phase rejoin',
    });
    if (ok) superseded.push(Number(summary.leaf_invoice_id));
  };

  for (const [localPhase, chain] of chainByLocalPhase.entries()) {
    const abs = phaseStart + Number(localPhase) - 1;
    await considerChain(chain, abs);
  }

  for (const chain of phaseChains) {
    let abs = parseAbsolutePhaseFromInvoice(chain.representative);
    if (abs == null) {
      for (const inv of chain.invoices || []) {
        abs = parseAbsolutePhaseFromInvoice(inv);
        if (abs != null) break;
      }
    }
    await considerChain(chain, abs);
  }

  return { superseded_leaf_ids: superseded };
}

/**
 * Block Invoice-page / FIUU payment when the invoice's phase enrollment is dropped
 * and the chain still has remaining balance.
 *
 * @returns {Promise<{ blocked: boolean, message: string|null, absolute_phase: number|null }>}
 */
export async function getDroppedEnrollmentPaymentBlock(client, invoice) {
  if (!invoice?.invoice_id) {
    return { blocked: false, message: null, absolute_phase: null };
  }

  if (isCancelledStatus(invoice.status) || invoice.status === 'Paid') {
    return { blocked: false, message: null, absolute_phase: null };
  }

  if (invoice.balance_invoice_id) {
    return { blocked: false, message: null, absolute_phase: null };
  }

  const profileId = invoice.installmentinvoiceprofiles_id
    ? Number(invoice.installmentinvoiceprofiles_id)
    : null;
  if (!profileId) {
    return { blocked: false, message: null, absolute_phase: null };
  }

  const profileRes = await client.query(
    `SELECT installmentinvoiceprofiles_id, student_id, class_id, phase_start
     FROM installmentinvoiceprofilestbl
     WHERE installmentinvoiceprofiles_id = $1`,
    [profileId]
  );
  const profile = profileRes.rows[0];
  if (!profile?.student_id || !profile?.class_id) {
    return { blocked: false, message: null, absolute_phase: null };
  }

  let absolutePhase = parseAbsolutePhaseFromInvoice(invoice);
  if (absolutePhase == null) {
    const rootId = invoice.invoice_chain_root_id || invoice.invoice_id;
    const rootRes = await client.query(
      `SELECT remarks, invoice_description FROM invoicestbl WHERE invoice_id = $1`,
      [rootId]
    );
    absolutePhase = parseAbsolutePhaseFromInvoice(rootRes.rows[0] || invoice);
  }
  if (absolutePhase == null) {
    return { blocked: false, message: null, absolute_phase: null };
  }

  const dropped = await isPhaseEnrollmentDroppedWithoutActive(client, {
    studentId: profile.student_id,
    classId: profile.class_id,
    absolutePhase,
  });
  if (!dropped) {
    return { blocked: false, message: null, absolute_phase: absolutePhase };
  }

  const summary = await getChainFinancialSummary(client, invoice.invoice_id);
  if (summary.remaining_on_leaf <= EPSILON) {
    return { blocked: false, message: null, absolute_phase: absolutePhase };
  }

  // Partial-drop: remaining must be payable so staff can settle before next-phase continue.
  if (summary.total_paid_in_chain > EPSILON) {
    return {
      blocked: false,
      message: null,
      absolute_phase: absolutePhase,
      settle_partial_drop: true,
    };
  }

  return {
    blocked: true,
    absolute_phase: absolutePhase,
    message:
      `Phase ${absolutePhase} enrollment is dropped. This invoice is not payable from the Invoice page. ` +
      `Use Student History → Installment → Rejoin to settle and re-enroll.`,
  };
}
