/**
 * Revoke Payment Logs approvals on paymenttbl that were approved by Admin users.
 *
 * Applies only to paymenttbl (Approved → Pending), e.g. PAY-736, PAY-611 (Cash).
 *
 * Admin-verified Acknowledgement Receipt rows are NOT reverted in acknowledgement_receiptstbl
 * (AR stays Verified/Applied). Those show Pending Approval on Payment Logs via API
 * (see backend/lib/paymentLogArApproval.js).
 *
 * Scope: all branches, all dates (no year/month filter).
 *
 * Default: DRY RUN. Pass --apply to write.
 *
 * Usage:
 *   node scripts/revokeAdminPaymentLogApprovals.js
 *   node scripts/revokeAdminPaymentLogApprovals.js --dry-run
 *   node scripts/revokeAdminPaymentLogApprovals.js --apply
 */

import '../config/loadEnv.js';
import {
  columnExists,
  groupCountByYearMonth,
  listAdminAccounts,
  previewAr,
  previewPayments,
  revertPayments,
} from './lib/adminPaymentLogRevokeShared.js';

const HAS_APPLY = process.argv.includes('--apply');
const HAS_DRY_RUN = process.argv.includes('--dry-run');

if (HAS_APPLY && HAS_DRY_RUN) {
  console.error('Use either --dry-run or --apply, not both.');
  process.exit(1);
}

const APPLY = HAS_APPLY;
const DRY_RUN = !APPLY;

function printUsage() {
  console.log('Revoke Admin approvals on paymenttbl (Payment Logs).');
  console.log('');
  console.log('  node scripts/revokeAdminPaymentLogApprovals.js [--dry-run|--apply]');
  console.log('');
  console.log('Admin-verified AR rows are listed for reference only — AR status is not changed.');
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printUsage();
  process.exit(0);
}

async function main() {
  const { getClient } = await import('../config/database.js');
  const client = await getClient();

  try {
    const hasVerifierCols = await columnExists(client, 'acknowledgement_receiptstbl', 'verified_by_user_id');
    const admins = await listAdminAccounts(client);
    const payRows = await previewPayments(client);
    const arRows = await previewAr(client, hasVerifierCols);

    console.log('');
    console.log('=== Revoke Admin Payment Logs approvals (paymenttbl) ===');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no database changes)' : 'APPLY (will update paymenttbl only)'}`);
    console.log('Scope: all branches, all dates (no year/month filter)');
    console.log('');

    console.log(`--- Admin accounts (${admins.length}) ---`);
    for (const a of admins) {
      console.log(`  • ${a.full_name || '(no name)'} (user_id=${a.user_id})`);
    }
    console.log('');

    console.log('--- Summary ---');
    console.log(`  paymenttbl rows to revoke (Approved → Pending): ${payRows.length}`);
    console.log(
      `  Admin-verified AR rows (informational — AR stays Verified/Applied; Payment Logs Pending via API): ${arRows.length}`
    );
    console.log('');

    if (payRows.length) {
      console.log('--- By issue month (payments) ---');
      for (const [ym, n] of groupCountByYearMonth(payRows, 'issue_date')) {
        console.log(`  ${ym}: ${n}`);
      }
      console.log('');
      console.log('--- paymenttbl (Approved → Pending on --apply) ---');
      for (const row of payRows) {
        console.log(
          `  PAY-${row.payment_id} | issue ${row.issue_date} | INV-${row.invoice_id ?? '?'} | ${row.branch_name} | ${row.payment_method || '—'}`
        );
        console.log(`    by ${row.approver_name} (approved ${row.approved_at_manila || '—'})`);
      }
      console.log('');
    }

    if (arRows.length) {
      console.log('--- Admin-verified Acknowledgement Receipt (no DB revert) ---');
      for (const [ym, n] of groupCountByYearMonth(arRows, 'issue_date')) {
        console.log(`  ${ym}: ${n} AR row(s)`);
      }
      console.log('');
      for (const row of arRows) {
        console.log(
          `  AR-${row.ack_receipt_id} #${row.ack_receipt_number || '—'} | issue ${row.issue_date} | ${row.branch_name} | ${row.status}`
        );
        console.log(
          `    ${row.prospect_student_name || '—'} | by ${row.verifier_name} | Payment Logs: Pending Approval (API)`
        );
      }
      console.log('');
    }

    if (!payRows.length && !arRows.length) {
      console.log('Nothing found — no Admin paymenttbl approvals and no Admin-verified AR rows.');
      console.log('');
      return;
    }

    if (DRY_RUN) {
      console.log('DRY RUN complete. No changes were made.');
      if (payRows.length) {
        console.log('To revoke paymenttbl approvals, run:');
        console.log('  node scripts/revokeAdminPaymentLogApprovals.js --apply');
      }
      console.log('');
      return;
    }

    if (!payRows.length) {
      console.log('No paymenttbl rows to update. AR rows were not modified.');
      console.log('');
      return;
    }

    await client.query('BEGIN');
    try {
      const payReverted = await revertPayments(client);
      await client.query('COMMIT');

      console.log('--- APPLY complete ---');
      console.log(`  paymenttbl reverted: ${payReverted}`);
      console.log('  acknowledgement_receiptstbl: unchanged (Verified/Applied preserved)');
      console.log('');
      console.log('Refresh Payment Logs — Cash/bank payments should show Pending; AR lines use API Pending for Admin verifiers.');
      console.log('');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('Script failed:', err.message || err);
  process.exit(1);
});
