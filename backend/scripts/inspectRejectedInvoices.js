import '../config/loadEnv.js';
import pool from '../config/database.js';

const ids = [346, 397, 536, 674];
for (const id of ids) {
  const inv = await pool.query(
    'SELECT invoice_id, status, amount FROM invoicestbl WHERE invoice_id = $1',
    [id]
  );
  const pays = await pool.query(
    `SELECT payment_id, status, approval_status, payable_amount,
            TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI') AS created
     FROM paymenttbl WHERE invoice_id = $1 ORDER BY payment_id`,
    [id]
  );
  console.log('\n=== Invoice', id, '===');
  console.log(inv.rows[0]);
  console.table(pays.rows);
}
await pool.end();
