/**
 * Remove false package merchandise release log rows created when stock quantity
 * was NULL/0 but issuance still logged a release (pre effectiveMerchandiseQuantity fix).
 *
 * After delete, the line returns to Pending issue (MERCH_PENDING still on invoice).
 *
 * Run:
 *   node backend/scripts/repairFalsePackageMerchReleaseNullQty.js
 *   node backend/scripts/repairFalsePackageMerchReleaseNullQty.js --payment-id=516
 *   node backend/scripts/repairFalsePackageMerchReleaseNullQty.js --payment-id=516 --merchandise-name=Workbooks --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { effectiveMerchandiseQuantity } from '../lib/merchandiseReleaseLog.js';

const isApply = process.argv.includes('--apply');

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const paymentIdArg = argValue('payment-id');
const merchNameArg = argValue('merchandise-name');

async function main() {
  console.log(
    `\nRepair false package merch releases (null/zero stock logged as issued)` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'}`);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const params = ['package_enroll'];
    let extra = '';
    if (paymentIdArg) {
      params.push(Number(paymentIdArg));
      extra += ` AND mrl.payment_id = $${params.length}`;
    }
    if (merchNameArg) {
      params.push(merchNameArg);
      extra += ` AND mrl.merchandise_name ILIKE $${params.length}`;
    }

    const res = await client.query(
      `SELECT mrl.release_log_id, mrl.payment_id, mrl.merchandise_id, mrl.merchandise_name,
              mrl.quantity AS release_qty, mrl.student_id, mrl.class_id, mrl.package_id, mrl.released_at,
              m.quantity AS stock_qty, m.item_name, m.sku, m.branch_id
       FROM merchandise_release_logtbl mrl
       INNER JOIN merchandisestbl m ON m.merchandise_id = mrl.merchandise_id
       WHERE mrl.source = $1
         AND m.item_name IS NOT NULL
         AND TRIM(m.item_name) <> ''
         ${extra}
       ORDER BY mrl.release_log_id`,
      params
    );

    const targets = res.rows.filter((row) => {
      const onHand = effectiveMerchandiseQuantity({ quantity: row.stock_qty });
      // False release: no stock on hand and CMS never decremented (quantity still null).
      const neverDeducted =
        row.stock_qty === null || row.stock_qty === undefined || row.stock_qty === '';
      return onHand <= 0 && neverDeducted;
    });

    if (!targets.length) {
      console.log('No false release rows matched.');
      await client.query('ROLLBACK');
      return;
    }

    console.table(
      targets.map((r) => ({
        release_log_id: r.release_log_id,
        payment_id: r.payment_id,
        merchandise_name: r.merchandise_name,
        item_name: r.item_name,
        student_id: r.student_id,
        released_at: r.released_at,
      }))
    );

    if (!isApply) {
      console.log(`\nDry run — ${targets.length} row(s) would be deleted. Re-run with --apply.`);
      await client.query('ROLLBACK');
      return;
    }

    const ids = targets.map((r) => r.release_log_id);
    const del = await client.query(
      `DELETE FROM merchandise_release_logtbl WHERE release_log_id = ANY($1::int[])`,
      [ids]
    );
    await client.query('COMMIT');
    console.log(`\nDeleted ${del.rowCount ?? 0} false release log row(s).`);
    console.log('Workbooks (and similar) should now appear on Pending issue after refresh.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('\nFAILED:', err.message || err);
  process.exit(1);
});
