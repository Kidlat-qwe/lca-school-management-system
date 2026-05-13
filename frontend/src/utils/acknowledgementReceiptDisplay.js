/**
 * Display helpers for rows from GET /acknowledgement-receipts when migration 109
 * adds paired Downpayment + Phase 1 (`list_*` fields from joined phase row).
 */

export function getArListLineTotal(r) {
  const v = r?.list_line_total_amount;
  if (v != null && v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return Number(r?.payment_amount || 0) + Number(r?.tip_amount || 0);
}

export function getArListPackagePrimaryLabel(r) {
  return r?.list_package_primary_label || r?.package_name_snapshot || r?.package_name || 'N/A';
}

export function getArListCombinedPackageAmount(r) {
  const v = r?.list_combined_package_amount;
  if (v != null && v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return Number(r?.package_amount_snapshot || 0);
}
