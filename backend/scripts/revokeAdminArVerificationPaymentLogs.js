/**
 * DEPRECATED — Do not use for current Payment Logs policy.
 *
 * This script reverts acknowledgement_receiptstbl to Submitted and clears verifier.
 * AR records should stay Verified/Applied; Admin-verified AR shows Pending on Payment Logs via API
 * (backend/lib/paymentLogArApproval.js).
 *
 * Use revokeAdminPaymentLogApprovals.js for paymenttbl only (Approved → Pending).
 */

import '../config/loadEnv.js';
import {
  columnExists,
  groupCountByYearMonth,
  previewAr,
  revertAr,
} from './lib/adminPaymentLogRevokeShared.js';

const HAS_APPLY = process.argv.includes('--apply');
const HAS_DRY_RUN = process.argv.includes('--dry-run');

if (HAS_APPLY && HAS_DRY_RUN) {
  console.error('Use either --dry-run or --apply, not both.');
  process.exit(1);
}

const APPLY = HAS_APPLY;
const DRY_RUN = !APPLY;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('DEPRECATED — reverts AR status in DB. Prefer paymentLogArApproval API + revokeAdminPaymentLogApprovals.js');
  process.exit(0);
}

async function main() {
  console.error('');
  console.error('WARNING: revokeAdminArVerificationPaymentLogs.js is DEPRECATED.');
  console.error('AR should remain Verified/Applied. Use revokeAdminPaymentLogApprovals.js for paymenttbl only.');
  console.error('');

  if (APPLY) {
    console.error('Aborting --apply. Remove this guard only if you intentionally need a DB AR revert.');
    process.exit(1);
  }

  const { getClient } = await import('../config/database.js');
  const client = await getClient();

  try {
    const hasVerifierCols = await columnExists(client, 'acknowledgement_receiptstbl', 'verified_by_user_id');
    const rows = await previewAr(client, hasVerifierCols);

    console.log('=== Preview only (deprecated AR revert script) ===');
    console.log(`Admin-verified AR rows: ${rows.length}`);
    console.log('These should show Pending on Payment Logs via API without changing acknowledgement_receiptstbl.');
    console.log('');

    for (const [ym, n] of groupCountByYearMonth(rows, 'issue_date')) {
      console.log(`  ${ym}: ${n}`);
    }
    console.log('');

    for (const row of rows) {
      console.log(
        `  AR-${row.ack_receipt_id} #${row.ack_receipt_number || '—'} | ${row.status} | ${row.verifier_name}`
      );
    }
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('Script failed:', err.message || err);
  process.exit(1);
});
