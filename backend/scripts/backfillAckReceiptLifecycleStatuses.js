/**
 * One-off script: normalize legacy package AR statuses to new lifecycle.
 *
 * Lifecycle target:
 *   Submitted -> Verified -> Applied
 *
 * Backfill rules:
 * - ar_type='Package' AND status='Enrolled' => Applied
 * - ar_type='Package' AND status='Paid' AND (invoice_id IS NOT NULL OR payment_id IS NOT NULL) => Applied
 * - ar_type='Package' AND status='Paid' AND invoice_id IS NULL AND payment_id IS NULL => Submitted
 *
 * Usage:
 *   node backend/scripts/backfillAckReceiptLifecycleStatuses.js --dry-run
 *   node backend/scripts/backfillAckReceiptLifecycleStatuses.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const isApply = process.argv.includes('--apply');
const isDryRun = !isApply;

async function runUpdate(client, label, sql, params = []) {
  const res = await client.query(sql, params);
  return { label, count: res.rowCount || 0 };
}

async function main() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const checks = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE ar_type = 'Package' AND status = 'Enrolled') AS enrolled_count,
         COUNT(*) FILTER (WHERE ar_type = 'Package' AND status = 'Paid' AND (invoice_id IS NOT NULL OR payment_id IS NOT NULL)) AS paid_linked_count,
         COUNT(*) FILTER (WHERE ar_type = 'Package' AND status = 'Paid' AND invoice_id IS NULL AND payment_id IS NULL) AS paid_unlinked_count
       FROM acknowledgement_receiptstbl`
    );
    const baseline = checks.rows[0] || {};

    console.log('Legacy AR lifecycle baseline:');
    console.log(`- Package status=Enrolled: ${baseline.enrolled_count || 0}`);
    console.log(`- Package status=Paid (linked): ${baseline.paid_linked_count || 0}`);
    console.log(`- Package status=Paid (unlinked): ${baseline.paid_unlinked_count || 0}`);

    const updates = [];
    updates.push(
      await runUpdate(
        client,
        'Enrolled -> Applied',
        `UPDATE acknowledgement_receiptstbl
         SET status = 'Applied'
         WHERE ar_type = 'Package' AND status = 'Enrolled'`
      )
    );
    updates.push(
      await runUpdate(
        client,
        'Paid(linked) -> Applied',
        `UPDATE acknowledgement_receiptstbl
         SET status = 'Applied'
         WHERE ar_type = 'Package'
           AND status = 'Paid'
           AND (invoice_id IS NOT NULL OR payment_id IS NOT NULL)`
      )
    );
    updates.push(
      await runUpdate(
        client,
        'Paid(unlinked) -> Submitted',
        `UPDATE acknowledgement_receiptstbl
         SET status = 'Submitted'
         WHERE ar_type = 'Package'
           AND status = 'Paid'
           AND invoice_id IS NULL
           AND payment_id IS NULL`
      )
    );

    if (isDryRun) {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN ONLY (no data changed).');
    } else {
      await client.query('COMMIT');
      console.log('\nBackfill applied successfully.');
    }

    updates.forEach((u) => {
      console.log(`- ${u.label}: ${u.count}`);
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Backfill failed. Transaction rolled back.');
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

