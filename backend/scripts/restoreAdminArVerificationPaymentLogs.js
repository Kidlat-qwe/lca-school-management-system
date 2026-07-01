/**
 * Restore Admin AR verification reverted by revokeAdminArVerificationPaymentLogs.js --apply
 * (production run 2026 — 5 rows).
 *
 * Re-applies status, verified_by_user_id, and verified_at on acknowledgement_receiptstbl.
 * For Applied rows with a linked payment_id, also re-syncs paymenttbl approval (same as AR verify API).
 *
 * Default: DRY RUN. Pass --apply to write.
 *
 * Usage:
 *   node scripts/restoreAdminArVerificationPaymentLogs.js --dry-run
 *   node scripts/restoreAdminArVerificationPaymentLogs.js --apply
 */

import '../config/loadEnv.js';

const HAS_APPLY = process.argv.includes('--apply');
const HAS_DRY_RUN = process.argv.includes('--dry-run');

if (HAS_APPLY && HAS_DRY_RUN) {
  console.error('Use either --dry-run or --apply, not both.');
  process.exit(1);
}

const APPLY = HAS_APPLY;
const DRY_RUN = !APPLY;

/** Snapshot from revokeAdminArVerificationPaymentLogs.js --apply output */
const RESTORE_SNAPSHOT = [
  {
    ack_receipt_id: 101,
    ack_receipt_number: '260861',
    status: 'Verified',
    verified_by_user_id: 92,
    verifier_name: 'Jabez Pascual',
    verified_at_manila: '2026-06-01 18:09:35',
    payment_id: null,
  },
  {
    ack_receipt_id: 69,
    ack_receipt_number: '260520',
    status: 'Verified',
    verified_by_user_id: 350,
    verifier_name: 'Rosalyn P. Hernandez',
    verified_at_manila: '2026-05-08 16:41:15',
    payment_id: null,
  },
  {
    ack_receipt_id: 68,
    ack_receipt_number: '260519',
    status: 'Verified',
    verified_by_user_id: 350,
    verifier_name: 'Rosalyn P. Hernandez',
    verified_at_manila: '2026-05-08 16:37:44',
    payment_id: null,
  },
  {
    ack_receipt_id: 67,
    ack_receipt_number: '260506',
    status: 'Applied',
    verified_by_user_id: 92,
    verifier_name: 'Jabez Pascual',
    verified_at_manila: '2026-05-07 17:21:47',
    payment_id: 736,
  },
  {
    ack_receipt_id: 50,
    ack_receipt_number: '260404',
    status: 'Applied',
    verified_by_user_id: 362,
    verifier_name: 'Hanna Zhandra Nina DR. Cruz',
    verified_at_manila: '2026-05-02 15:37:11',
    payment_id: 611,
  },
];

function printUsage() {
  console.log('Restore the 5 Admin-verified AR rows reverted on production.');
  console.log('');
  console.log('  node scripts/restoreAdminArVerificationPaymentLogs.js --dry-run');
  console.log('  node scripts/restoreAdminArVerificationPaymentLogs.js --apply');
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printUsage();
  process.exit(0);
}

async function columnExists(client, tableName, columnName) {
  const r = await client.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2
     LIMIT 1`,
    [tableName, columnName]
  );
  return r.rows.length > 0;
}

async function previewCurrent(client, ackReceiptId) {
  const r = await client.query(
    `SELECT ack_receipt_id, ack_receipt_number, status, verified_by_user_id,
            TO_CHAR(TIMEZONE('Asia/Manila', verified_at), 'YYYY-MM-DD HH24:MI:SS') AS verified_at_manila,
            payment_id, invoice_id
     FROM acknowledgement_receiptstbl
     WHERE ack_receipt_id = $1`,
    [ackReceiptId]
  );
  return r.rows[0] || null;
}

async function restoreRow(client, row, hasVerifierCols) {
  if (hasVerifierCols) {
    await client.query(
      `UPDATE acknowledgement_receiptstbl
       SET status = $1,
           verified_by_user_id = $2,
           verified_at = ($3::timestamp AT TIME ZONE 'Asia/Manila')
       WHERE ack_receipt_id = $4`,
      [row.status, row.verified_by_user_id, row.verified_at_manila, row.ack_receipt_id]
    );
  } else {
    await client.query(
      `UPDATE acknowledgement_receiptstbl
       SET status = $1
       WHERE ack_receipt_id = $2`,
      [row.status, row.ack_receipt_id]
    );
  }

  if (row.payment_id && row.status === 'Applied') {
    await client.query(
      `UPDATE paymenttbl
       SET approval_status = 'Approved',
           approved_by = $1,
           approved_at = COALESCE(approved_at, ($2::timestamp AT TIME ZONE 'Asia/Manila'))
       WHERE payment_id = $3
         AND COALESCE(approval_status, 'Pending') NOT IN ('Returned', 'Rejected')`,
      [row.verified_by_user_id, row.verified_at_manila, row.payment_id]
    );
  }
}

async function main() {
  const { getClient } = await import('../config/database.js');
  const client = await getClient();

  try {
    const hasVerifierCols = await columnExists(client, 'acknowledgement_receiptstbl', 'verified_by_user_id');

    console.log('');
    console.log('=== Restore Admin AR verification (5-row snapshot) ===');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
    console.log('');

    for (const snap of RESTORE_SNAPSHOT) {
      const cur = await previewCurrent(client, snap.ack_receipt_id);
      if (!cur) {
        console.log(`  AR-${snap.ack_receipt_id}: NOT FOUND — skip`);
        continue;
      }
      console.log(`  AR-${snap.ack_receipt_id} #${snap.ack_receipt_number}`);
      console.log(
        `    now: status=${cur.status} verifier=${cur.verified_by_user_id ?? '—'} at ${cur.verified_at_manila || '—'}`
      );
      console.log(
        `    → restore: status=${snap.status} verifier=${snap.verified_by_user_id} (${snap.verifier_name}) at ${snap.verified_at_manila}`
      );
      if (snap.payment_id) {
        console.log(`    → linked PAY-${snap.payment_id} approval sync if needed`);
      }
      console.log('');
    }

    if (DRY_RUN) {
      console.log('DRY RUN complete. Run with --apply to restore.');
      console.log('');
      return;
    }

    await client.query('BEGIN');
    try {
      let restored = 0;
      for (const snap of RESTORE_SNAPSHOT) {
        const cur = await previewCurrent(client, snap.ack_receipt_id);
        if (!cur) continue;
        await restoreRow(client, snap, hasVerifierCols);
        restored += 1;
      }
      await client.query('COMMIT');
      console.log(`Restored ${restored} acknowledgement receipt(s).`);
      console.log('Refresh Payment Logs — AR rows should show Approved again with verifier names.');
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
