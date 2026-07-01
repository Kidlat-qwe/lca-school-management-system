/**
 * Backfill merchandise_release_logtbl from historical Merchandise AR rows.
 * Does not reconstruct package enrollment releases (no historical issuance log).
 *
 * Usage: node scripts/backfillMerchandiseReleaseLogFromAr.js
 *        node scripts/backfillMerchandiseReleaseLogFromAr.js --dry-run
 */

import '../config/loadEnv.js';
import { query, getClient } from '../config/database.js';
import {
  MERCH_RELEASE_SOURCE,
  buildMerchandiseArReleaseBatchId,
  insertMerchandiseReleaseLog,
  merchandiseReleaseLogTableExists,
} from '../lib/merchandiseReleaseLog.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const poolCheck = await query('SELECT 1');
  if (!poolCheck) return;

  if (!(await merchandiseReleaseLogTableExists({ query }))) {
    console.error('Run migration 117_create_merchandise_release_logtbl.sql first.');
    process.exit(1);
  }

  const arRes = await query(
    `SELECT ar.ack_receipt_id,
            ar.branch_id,
            ar.payment_id,
            ar.created_by,
            ar.merchandise_items_snapshot,
            ar.issue_date
     FROM acknowledgement_receiptstbl ar
     WHERE ar.ar_type = 'Merchandise'
       AND ar.merchandise_items_snapshot IS NOT NULL
       AND ar.status IN ('Paid', 'Applied', 'Verified')
     ORDER BY ar.ack_receipt_id ASC`
  );

  let insertedLines = 0;
  let skippedBatches = 0;

  const client = await getClient();
  try {
    for (const ar of arRes.rows) {
      const batchId = buildMerchandiseArReleaseBatchId(ar.ack_receipt_id);
      const exists = await client.query(
        `SELECT 1 FROM merchandise_release_logtbl WHERE release_batch_id = $1 LIMIT 1`,
        [batchId]
      );
      if (exists.rows.length > 0) {
        skippedBatches += 1;
        continue;
      }

      let items = ar.merchandise_items_snapshot;
      if (typeof items === 'string') {
        try {
          items = JSON.parse(items);
        } catch {
          items = [];
        }
      }
      if (!Array.isArray(items) || items.length === 0) continue;

      if (!dryRun) await client.query('BEGIN');

      for (const item of items) {
        const merchId = item.merchandise_id;
        const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
        if (!merchId) continue;

        if (dryRun) {
          console.log(
            `[dry-run] ${batchId} merch=${merchId} qty=${qty} date=${ar.issue_date}`
          );
        } else {
          await insertMerchandiseReleaseLog(client, {
            releaseBatchId: batchId,
            source: MERCH_RELEASE_SOURCE.MERCHANDISE_AR,
            merchandiseId: merchId,
            quantity: qty,
            branchId: ar.branch_id,
            merchandiseName: item.merchandise_name,
            size: item.size,
            ackReceiptId: ar.ack_receipt_id,
            paymentId: ar.payment_id,
            createdBy: ar.created_by,
          });
        }
        insertedLines += 1;
      }

      if (!dryRun) {
        await client.query(
          `UPDATE merchandise_release_logtbl
           SET released_at = ($1::date + TIME '12:00') AT TIME ZONE 'Asia/Manila'
           WHERE release_batch_id = $2`,
          [ar.issue_date, batchId]
        );
        await client.query('COMMIT');
      }
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.log(
    dryRun
      ? `Dry run complete. Would insert ~${insertedLines} line(s); skip ${skippedBatches} existing batch(es).`
      : `Backfill complete. Inserted ${insertedLines} line(s); skipped ${skippedBatches} existing batch(es).`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
