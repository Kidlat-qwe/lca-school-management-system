/**
 * Remove erroneous unapplied AR #261633 — Elisha Gianna J. Abulencia.
 * Moving up fee (May 2026) ₱3,500.00 | LCA Malolos | Verified, not applied.
 *
 * Safe because: invoice_id, payment_id, paired_ack_receipt_id are all null;
 * no merchandise release log; no invoice links.
 *
 * Run:
 *   node backend/scripts/removeAr261633ElishaAbulencia.js
 *   node backend/scripts/removeAr261633ElishaAbulencia.js --apply
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, '.backups');

const ACK_RECEIPT_ID = 196;
const ACK_RECEIPT_NUMBER = '261633';
const isApply = process.argv.includes('--apply');

async function assertSafeToDelete(client, row) {
  if (!row) throw new Error(`AR ${ACK_RECEIPT_NUMBER} not found`);
  if (Number(row.ack_receipt_id) !== ACK_RECEIPT_ID) {
    throw new Error(`AR number ${ACK_RECEIPT_NUMBER} maps to id ${row.ack_receipt_id}, expected ${ACK_RECEIPT_ID}`);
  }
  if (row.invoice_id != null || row.payment_id != null) {
    throw new Error('AR is linked to invoice/payment — refuse to delete');
  }
  if (String(row.status || '').trim().toUpperCase() === 'APPLIED') {
    throw new Error('AR status is Applied — refuse to delete');
  }

  const paired = await client.query(
    `SELECT ack_receipt_id FROM acknowledgement_receiptstbl WHERE paired_ack_receipt_id = $1 LIMIT 1`,
    [ACK_RECEIPT_ID]
  );
  if (paired.rows.length) {
    throw new Error(`Another AR pairs to this row (id ${paired.rows[0].ack_receipt_id})`);
  }

  const inv = await client.query(
    `SELECT invoice_id FROM invoicestbl WHERE ack_receipt_id = $1 LIMIT 1`,
    [ACK_RECEIPT_ID]
  );
  if (inv.rows.length) {
    throw new Error(`Invoice ${inv.rows[0].invoice_id} references this AR`);
  }

  const mrl = await client.query(
    `SELECT release_log_id FROM merchandise_release_logtbl WHERE ack_receipt_id = $1 LIMIT 1`,
    [ACK_RECEIPT_ID]
  );
  if (mrl.rows.length) {
    throw new Error(`Merchandise release log ${mrl.rows[0].release_log_id} references this AR`);
  }
}

async function main() {
  console.log(
    `\nRemove AR #${ACK_RECEIPT_NUMBER} (Elisha Gianna J. Abulencia)${isApply ? ' — APPLY' : ' — DRY RUN'}\n`
  );

  const client = await getClient();
  try {
    const row = (
      await client.query(`SELECT * FROM acknowledgement_receiptstbl WHERE ack_receipt_id = $1`, [
        ACK_RECEIPT_ID,
      ])
    ).rows[0];

    await assertSafeToDelete(client, row);

    console.log('Target AR:');
    console.table([
      {
        ack_receipt_id: row.ack_receipt_id,
        ack_receipt_number: row.ack_receipt_number,
        student: row.prospect_student_name,
        package: row.package_name_snapshot,
        amount: row.payment_amount,
        status: row.status,
        payment_method: row.payment_method,
        issue_date: String(row.issue_date).slice(0, 10),
        invoice_id: row.invoice_id,
        payment_id: row.payment_id,
      },
    ]);

    if (!isApply) {
      console.log('\nRe-run with --apply to delete this AR row.');
      return;
    }

    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(BACKUP_DIR, `ar-${ACK_RECEIPT_NUMBER}-delete-${stamp}.json`);
    fs.writeFileSync(
      backupPath,
      JSON.stringify({ deleted_at: new Date().toISOString(), row }, null, 2),
      'utf8'
    );
    console.log(`\nBackup written: ${backupPath}`);

    await client.query('BEGIN');
    const del = await client.query(
      `DELETE FROM acknowledgement_receiptstbl WHERE ack_receipt_id = $1`,
      [ACK_RECEIPT_ID]
    );
    await client.query('COMMIT');

    console.log(`\n✅ Deleted ${del.rowCount} acknowledgement receipt row(s).`);
    console.log('AR #261633 will no longer appear on the AR page.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFailed:', err.message || err);
    process.exit(1);
  });
