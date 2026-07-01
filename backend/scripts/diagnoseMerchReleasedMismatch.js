/**
 * Compare monthly dashboard merchandise count vs detail loader for a month.
 * Usage: node scripts/diagnoseMerchReleasedMismatch.js [YYYY-MM]
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';
import {
  loadMerchandiseReleasedDetails,
  merchandiseReleaseLogTableExists,
  parseMerchPendingFromRemarks,
} from '../lib/merchandiseReleaseLog.js';

const monthKey = process.argv[2] || '2026-06';
const [y, m] = monthKey.split('-').map(Number);
const monthStart = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
const monthEnd = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);

const meta = await query(
  `SELECT table_schema, table_name
   FROM information_schema.tables
   WHERE table_name ILIKE '%merchandise_release%'`
);
console.log('information_schema rows:', meta.rows);

const exists1 = await merchandiseReleaseLogTableExists(query);
const exists2 = await merchandiseReleaseLogTableExists(query);
console.log('merchandiseReleaseLogTableExists after connect:', exists1, exists2);

try {
  const dash = await query(
    `SELECT COALESCE(SUM(mrl.quantity),0) AS qty,
            COUNT(DISTINCT mrl.release_batch_id)::bigint AS events
     FROM merchandise_release_logtbl mrl
     WHERE TIMEZONE('Asia/Manila', mrl.released_at)::date >= $1::date
       AND TIMEZONE('Asia/Manila', mrl.released_at)::date < $2::date`,
    [monthStart, monthEnd]
  );
  console.log('dashboard-style June count:', dash.rows[0]);
} catch (e) {
  console.log('dashboard query error:', e.message);
}

const details = await loadMerchandiseReleasedDetails(query, {
  branchFilter: null,
  dateFrom: monthStart,
  dateToExclusive: monthEnd,
});
console.log('detail rows:', details.rows.length);
console.log('detail summary:', details.summary);

const payId = process.argv[3];
if (payId) {
  const inv = await query(
    `SELECT i.invoice_id, LEFT(i.remarks, 2000) AS remarks
     FROM paymenttbl p
     INNER JOIN invoicestbl i ON i.invoice_id = p.invoice_id
     WHERE p.payment_id = $1`,
    [payId]
  );
  const remarks = inv.rows[0]?.remarks || '';
  console.log('invoice remarks snippet:', remarks.slice(0, 400));
  const normalized = parseMerchPendingFromRemarks(remarks);
  console.log('normalized pending lines:', normalized.length, normalized.map((l) => `${l.merchandise_name} ${l.category || ''} ${l.size || ''}`));
  const byPay = await query(
    `SELECT release_log_id, merchandise_id, merchandise_name, size, category, quantity, payment_id
     FROM merchandise_release_logtbl WHERE payment_id = $1 ORDER BY release_log_id`,
    [payId]
  );
  console.log(`rows for payment ${payId}:`, byPay.rows);
}

const total = await query('SELECT COUNT(*)::int AS n FROM merchandise_release_logtbl');
console.log('total log rows (all time):', total.rows[0]?.n);

process.exit(0);
