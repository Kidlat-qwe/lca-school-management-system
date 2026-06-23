/**
 * Keep installment phase slots, generated_count, and TARGET_PHASE remarks aligned.
 * Prevents billing from skipping phases when the student was not dropped/rejoined.
 */
import { parseTargetPhase } from './balanceInvoice.js';
import {
  mapPhaseChainsToLocalSlots,
  parseAbsolutePhaseFromInvoice,
  sortChainsByBillingOrder,
} from './installmentPhaseRowMapping.js';
import { resolveProfilePhaseStart } from './phaseInstallmentUtils.js';

const REJOIN_REMARKS_RE = /REJOIN_PHASE:\d+/i;
const ADVANCE_PAYMENT_RE = /Advance payment\s*[—\-]\s*Phase\s*\d+/i;

export const isAdvancePaymentRemarks = (remarks) =>
  ADVANCE_PAYMENT_RE.test(String(remarks || ''));

export const isRejoinInvoiceRemarks = (remarks) =>
  REJOIN_REMARKS_RE.test(String(remarks || ''));

/**
 * Lowest profile-local phase (1..totalPhases) with no invoice chain mapped.
 * @param {Map<number, object>} chainByLocalPhase
 * @param {number|null} totalPhases
 * @returns {number|null}
 */
export function findNextUnbilledLocalPhase(chainByLocalPhase, totalPhases) {
  const limit =
    totalPhases != null && Number.isFinite(Number(totalPhases)) && Number(totalPhases) > 0
      ? Number(totalPhases)
      : Math.max(0, ...(chainByLocalPhase?.keys() || [])) + 1;

  for (let local = 1; local <= limit; local += 1) {
    if (!chainByLocalPhase?.has(local)) {
      return local;
    }
  }
  return null;
}

/**
 * generated_count such that getCurrentInstallmentPhaseNumber === next billable absolute phase.
 * @param {number} nextLocalPhase 1-based profile-local slot to bill next
 * @returns {number}
 */
export function generatedCountForNextLocalPhase(nextLocalPhase) {
  const n = parseInt(nextLocalPhase, 10);
  if (!Number.isFinite(n) || n < 1) return 0;
  return n - 1;
}

/**
 * Absolute class phases where the student has an active (non-removed) enrollment row.
 */
export async function loadActiveEnrollmentAbsolutePhases(db, studentId, classId) {
  if (!studentId || !classId) return new Set();

  const result = await db.query(
    `SELECT DISTINCT phase_number
     FROM classstudentstbl
     WHERE student_id = $1
       AND class_id = $2
       AND phase_number IS NOT NULL
       AND removed_at IS NULL`,
    [studentId, classId]
  );

  return new Set(
    result.rows
      .map((r) => parseInt(r.phase_number, 10))
      .filter((n) => Number.isFinite(n) && n > 0)
  );
}

/**
 * True when a later phase slot has an invoice but an earlier slot does not,
 * and the empty slot is not an intentional drop/rejoin skip or late-enrollment start.
 */
export function hasUnintentionalPhaseGap(
  chainByLocalPhase,
  profile,
  droppedAbsolutePhases = new Set(),
  activeEnrollmentAbsolutePhases = null
) {
  if (!chainByLocalPhase?.size) return false;

  const phaseStart = resolveProfilePhaseStart(profile);
  const totalPhases =
    profile?.total_phases != null ? parseInt(profile.total_phases, 10) : null;
  const maxLocal = Math.max(
    totalPhases || 0,
    ...[...chainByLocalPhase.keys()].map((k) => Number(k))
  );

  for (let local = 1; local <= maxLocal; local += 1) {
    if (chainByLocalPhase.has(local)) continue;
    const absolute = phaseStart + local - 1;
    if (droppedAbsolutePhases.has(absolute)) continue;

    // Student never enrolled this class phase (e.g. billing starts on phase 2).
    if (
      activeEnrollmentAbsolutePhases instanceof Set &&
      !activeEnrollmentAbsolutePhases.has(absolute)
    ) {
      continue;
    }

    for (let later = local + 1; later <= maxLocal; later += 1) {
      if (!chainByLocalPhase.has(later)) continue;
      const chain = chainByLocalPhase.get(later);
      const remarks = chain?.representative?.remarks;
      if (isRejoinInvoiceRemarks(remarks)) return false;
      return true;
    }
  }
  return false;
}

/**
 * Assign chains to slots 1..N in billing order (absolute phase, then issue_date).
 * Use when TARGET_PHASE mapping left unintentional gaps.
 */
export function mapPhaseChainsToSequentialSlots(phaseChains, profile) {
  const sorted = sortChainsByBillingOrder(phaseChains);

  const chainByLocalPhase = new Map();
  let slot = 1;
  for (const chain of sorted) {
    chainByLocalPhase.set(slot, chain);
    slot += 1;
  }
  return chainByLocalPhase;
}

/**
 * Pick TARGET_PHASE mapping or sequential remap for display / eligibility.
 */
export function resolvePhaseChainByLocalSlot(
  phaseChains,
  profile,
  { droppedAbsolutePhases = new Set(), activeEnrollmentAbsolutePhases = null } = {}
) {
  const targetMapped = mapPhaseChainsToLocalSlots(phaseChains, profile);
  if (
    !hasUnintentionalPhaseGap(
      targetMapped,
      profile,
      droppedAbsolutePhases,
      activeEnrollmentAbsolutePhases
    )
  ) {
    return { chainByLocalPhase: targetMapped, mapping_mode: 'target_phase' };
  }
  return {
    chainByLocalPhase: mapPhaseChainsToSequentialSlots(phaseChains, profile),
    mapping_mode: 'sequential_repair',
  };
}

/**
 * Replace or append TARGET_PHASE in remarks.
 */
export function rewriteTargetPhaseInRemarks(remarks, absolutePhase) {
  const text = String(remarks || '').trim();
  const phase = parseInt(absolutePhase, 10);
  if (!Number.isFinite(phase) || phase < 1) return text;

  if (/TARGET_PHASE:\d+/i.test(text)) {
    return text.replace(/TARGET_PHASE:\d+/i, `TARGET_PHASE:${phase}`);
  }
  if (ADVANCE_PAYMENT_RE.test(text)) {
    return text.replace(
      /Advance payment\s*[—\-]\s*Phase\s*\d+/i,
      `Advance payment — Phase ${phase}`
    );
  }
  return text ? `${text};TARGET_PHASE:${phase}` : `TARGET_PHASE:${phase}`;
}

/**
 * Persist TARGET_PHASE alignment for chains that were shifted to sequential slots.
 * @returns {Promise<{ updated: number, details: object[] }>}
 */
export async function repairProfileTargetPhaseAlignment(client, profile, phaseChains, options = {}) {
  const {
    dryRun = false,
    droppedAbsolutePhases = new Set(),
    activeEnrollmentAbsolutePhases = null,
  } = options;
  const phaseStart = resolveProfilePhaseStart(profile);
  const targetMapped = mapPhaseChainsToLocalSlots(phaseChains, profile);

  if (
    !hasUnintentionalPhaseGap(
      targetMapped,
      profile,
      droppedAbsolutePhases,
      activeEnrollmentAbsolutePhases
    )
  ) {
    return { updated: 0, details: [] };
  }

  const sequential = mapPhaseChainsToSequentialSlots(phaseChains, profile);
  const details = [];
  let updated = 0;

  for (const [localSlot, chain] of sequential.entries()) {
    const expectedAbsolute = phaseStart + Number(localSlot) - 1;
    const rep = chain.representative;
    const currentAbsolute = parseAbsolutePhaseFromInvoice(rep);
    if (currentAbsolute === expectedAbsolute) continue;

    const newRemarks = rewriteTargetPhaseInRemarks(rep?.remarks, expectedAbsolute);
    details.push({
      invoice_id: rep?.invoice_id,
      from_absolute: currentAbsolute,
      to_absolute: expectedAbsolute,
      local_slot: Number(localSlot),
    });

    if (!dryRun && rep?.invoice_id) {
      await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
        newRemarks,
        rep.invoice_id,
      ]);
      updated += 1;
    } else if (dryRun) {
      updated += 1;
    }
  }

  const syncedCount = sequential.size;

  if (!dryRun && syncedCount !== parseInt(profile.generated_count || 0, 10)) {
    await client.query(
      `UPDATE installmentinvoiceprofilestbl SET generated_count = $1 WHERE installmentinvoiceprofiles_id = $2`,
      [syncedCount, profile.installmentinvoiceprofiles_id]
    );
  }

  return { updated, synced_generated_count: syncedCount, details };
}

/**
 * Load absolute phase numbers where the student was dropped on this class.
 */
export async function loadDroppedAbsolutePhasesForProfile(db, studentId, classId) {
  if (!studentId || !classId) return new Set();

  const result = await db.query(
    `SELECT DISTINCT phase_number
     FROM classstudentstbl
     WHERE student_id = $1
       AND class_id = $2
       AND LOWER(TRIM(COALESCE(program_enrollment_status, ''))) = 'dropped'`,
    [studentId, classId]
  );

  return new Set(
    result.rows
      .map((r) => parseInt(r.phase_number, 10))
      .filter((n) => Number.isFinite(n) && n > 0)
  );
}

/**
 * Sync profile.generated_count to the next unbilled TARGET_PHASE slot (billing truth).
 */
export async function syncInstallmentGeneratedCountToNextUnbilled(
  client,
  profileId,
  { phaseChains = null } = {}
) {
  const profileRes = await client.query(
    `SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
    [profileId]
  );
  const profile = profileRes.rows[0];
  if (!profile) return null;

  let chains = phaseChains;
  if (!chains) {
    const { loadInstallmentProfilePhaseChains } = await import(
      '../lib/installmentPaymentEligibility.js'
    );
    const loaded = await loadInstallmentProfilePhaseChains(client, profileId);
    chains = loaded.phaseChains;
  }

  const chainByLocalPhase = mapPhaseChainsToLocalSlots(chains, profile);
  const nextLocal = findNextUnbilledLocalPhase(
    chainByLocalPhase,
    profile.total_phases != null ? parseInt(profile.total_phases, 10) : null
  );
  const syncedCount =
    nextLocal != null
      ? generatedCountForNextLocalPhase(nextLocal)
      : profile.total_phases != null
        ? parseInt(profile.total_phases, 10)
        : chainByLocalPhase.size;

  const stored = parseInt(profile.generated_count || 0, 10) || 0;
  if (stored === syncedCount) {
    return { profile, generated_count: syncedCount, changed: false };
  }

  await client.query(
    `UPDATE installmentinvoiceprofilestbl SET generated_count = $1 WHERE installmentinvoiceprofiles_id = $2`,
    [syncedCount, profileId]
  );

  return {
    profile: { ...profile, generated_count: syncedCount },
    generated_count: syncedCount,
    changed: true,
    previous_generated_count: stored,
  };
}
