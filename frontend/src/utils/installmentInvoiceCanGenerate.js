/**
 * Installment Invoice Logs: when "Generate invoice" should be available.
 * - Unenrolled / inactive profile: no generation
 * - Phase progress complete (e.g. 2/2): no generation
 */
export function canGenerateInstallmentInvoice(row) {
  if (!row) return false;
  if (row.can_generate_installment === true) return true;
  if (row.can_generate_installment === false) return false;
  if (row.profile_is_active === false) return false;
  const total = row.total_phases != null ? parseInt(String(row.total_phases), 10) : null;
  if (total == null || Number.isNaN(total) || total <= 0) return true;
  const progress = parseInt(String(row.display_phase_progress ?? 0), 10) || 0;
  return progress < total;
}

/** @returns {'unenrolled' | 'complete' | null} */
export function installmentGenerateBlockedReason(row) {
  if (!row) return 'unenrolled';
  if (row.profile_is_active === false) return 'unenrolled';
  const total = row.total_phases != null ? parseInt(String(row.total_phases), 10) : null;
  if (total == null || Number.isNaN(total) || total <= 0) return null;
  const progress = parseInt(String(row.display_phase_progress ?? 0), 10) || 0;
  if (progress >= total) return 'complete';
  return null;
}
