/**
 * Remove merchandise request rows matching the Superadmin Merchandise → Requests
 * screenshot cleanup (Tool Kit / Moving Up Kit / Shirt / Backpack / School Uniform_Replacement).
 *
 * Production discovery (2026-08-24 dry-run):
 *   request_id 13,12 Tool Kit Delivered (Dev Pampanga)
 *   request_id 8 Moving Up Kit Delivered (Dev Malolos)
 *   request_id 7 Shirt Delivered (Dev Malolos)
 *   request_id 4 Backpack Delivered (Dev Malolos)
 *   request_id 2,1 School Uniform_Replacement Approved (Hanna Cruz / MJ Tamayo)
 *   Note: UI may show Approved as a green badge similar to Delivered.
 *
 * IMPORTANT:
 * - Delivered/Approved rows may have credited branch stock. This script deletes
 *   request log rows only; it does NOT reverse merchandisestbl quantities.
 *
 * Usage (from backend/):
 *   node scripts/removeMerchandiseRequestsScreenshotRows.js --production --dry-run
 *   node scripts/removeMerchandiseRequestsScreenshotRows.js --production --execute
 *
 * Default is dry-run unless --execute is passed.
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const isExecute = process.argv.includes('--execute');
const isDryRun = !isExecute || process.argv.includes('--dry-run');

/** Explicit IDs from production match to the screenshot (safe, exact). */
const TARGET_REQUEST_IDS = [13, 12, 8, 7, 4, 2, 1];

async function main() {
  const client = await getClient();

  try {
    const dbInfo = await client.query(
      `SELECT current_database() AS db, current_user AS db_user`
    );
    console.log('=== DB connection ===');
    console.log(dbInfo.rows[0]);
    console.log(`NODE_ENV=${process.env.NODE_ENV} DB_NAME=${process.env.DB_NAME}`);
    console.log(`Mode: ${isDryRun ? 'DRY-RUN (no deletes)' : 'EXECUTE (will DELETE)'}`);
    console.log(`Target request_ids: ${TARGET_REQUEST_IDS.join(', ')}`);
    console.log('');

    const result = await client.query(
      `
      SELECT
        r.request_id,
        r.merchandise_id,
        r.merchandise_name,
        r.size,
        r.requested_quantity,
        r.status,
        r.requested_branch_id,
        b.branch_name,
        req.full_name AS requested_by_name,
        rev.full_name AS reviewed_by_name,
        to_char(timezone('Asia/Manila', r.created_at::timestamptz), 'YYYY-MM-DD HH24:MI:SS') AS created_at_manila,
        r.inventory_request_id,
        r.inventory_external_reference
      FROM merchandiserequestlogtbl r
      INNER JOIN branchestbl b ON b.branch_id = r.requested_branch_id
      LEFT JOIN userstbl req ON req.user_id = r.requested_by
      LEFT JOIN userstbl rev ON rev.user_id = r.reviewed_by
      WHERE r.request_id = ANY($1::int[])
      ORDER BY r.request_id DESC
      `,
      [TARGET_REQUEST_IDS]
    );

    const rows = result.rows;
    const foundIds = new Set(rows.map((r) => r.request_id));
    const missing = TARGET_REQUEST_IDS.filter((id) => !foundIds.has(id));

    console.log(`=== Matched requests: ${rows.length} / ${TARGET_REQUEST_IDS.length} ===`);
    if (missing.length) {
      console.log(`Missing request_ids (already gone?): ${missing.join(', ')}`);
    }

    if (rows.length === 0) {
      console.log('No matching rows. Nothing to do.');
      return;
    }

    console.table(
      rows.map((r) => ({
        request_id: r.request_id,
        merchandise: r.merchandise_name,
        qty: r.requested_quantity,
        size: r.size,
        branch: r.branch_name,
        requested_by: r.requested_by_name,
        reviewed_by: r.reviewed_by_name,
        status: r.status,
        created_at_manila: r.created_at_manila,
        merchandise_id: r.merchandise_id,
      }))
    );

    console.log('');
    console.log('=== Stock impact note ===');
    for (const r of rows) {
      if (!r.merchandise_id) {
        console.log(
          `request_id=${r.request_id}: no merchandise_id — stock link unknown; qty=${r.requested_quantity}`
        );
        continue;
      }
      const stock = await client.query(
        `
        SELECT merchandise_id, merchandise_name, quantity, branch_id
        FROM merchandisestbl
        WHERE merchandise_id = $1
        `,
        [r.merchandise_id]
      );
      const s = stock.rows[0];
      if (!s) {
        console.log(
          `request_id=${r.request_id}: merchandise_id=${r.merchandise_id} not found in merchandisestbl`
        );
        continue;
      }
      console.log(
        `request_id=${r.request_id} [${r.status}]: current stock qty=${s.quantity} for "${s.merchandise_name}" ` +
          `(merchandise_id=${s.merchandise_id}, branch_id=${s.branch_id}); request qty=${r.requested_quantity}. ` +
          `Execute deletes the request row only (stock unchanged).`
      );
    }

    if (isDryRun) {
      console.log('');
      console.log('DRY-RUN complete. No rows deleted.');
      console.log('To delete these request rows only (no stock reversal):');
      console.log(
        '  node scripts/removeMerchandiseRequestsScreenshotRows.js --production --execute'
      );
      return;
    }

    await client.query('BEGIN');
    const ids = rows.map((r) => r.request_id);
    const del = await client.query(
      `DELETE FROM merchandiserequestlogtbl
       WHERE request_id = ANY($1::int[])
       RETURNING request_id, merchandise_name, status`,
      [ids]
    );
    await client.query('COMMIT');
    console.log('');
    console.log(`Deleted ${del.rows.length} request row(s):`);
    console.table(del.rows);
    console.log('WARNING: Branch stock was NOT reversed. Adjust stock manually if needed.');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('Script failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit();
  }
}

main();
