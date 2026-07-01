/**
 * Export invoice_id + invoice_ar_number from a Neon point-in-time branch
 * to restore values cleared by findAndClearInvoiceOnlyArGhostRows --apply.
 *
 * Prerequisite: In Neon console, create a branch restored to a timestamp
 * BEFORE the ghost clear --apply run. Copy that branch connection string.
 *
 * Usage:
 *   node backend/scripts/exportInvoiceArFromPitrBranch.js \
 *     --pitr-url="postgresql://..." \
 *     --out=backend/scripts/.backups/pitr-invoice-ar-export.json
 *
 * Then restore on production:
 *   node backend/scripts/restoreInvoiceArNumbersFromBackup.js \
 *     --file=backend/scripts/.backups/pitr-invoice-ar-export.json --apply
 *
 * Flags:
 *   --pitr-url=   Connection string for the PITR / restored Neon branch (required)
 *   --out=        Output JSON path (required)
 *   --only-missing  Only rows where current prod DB has NULL invoice_ar_number (default: true)
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';
import '../config/loadEnv.js';
import { query } from '../config/database.js';

const { Client } = pg;

const pitrUrlArg = process.argv.find((a) => a.startsWith('--pitr-url='));
const outArg = process.argv.find((a) => a.startsWith('--out='));
const onlyMissing = !process.argv.includes('--all');

const pitrUrl = pitrUrlArg ? pitrUrlArg.slice('--pitr-url='.length).trim() : '';
const outPath = outArg ? outArg.slice('--out='.length).trim() : '';

async function main() {
  if (!pitrUrl || !outPath) {
    console.error('Usage: --pitr-url=postgresql://... --out=path/to/export.json');
    process.exit(1);
  }

  const absOut = path.isAbsolute(outPath) ? outPath : path.resolve(process.cwd(), outPath);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });

  console.log('Connecting to PITR branch (read-only export)...');
  const pitrClient = new Client({
    connectionString: pitrUrl,
    ssl: pitrUrl.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
  });
  await pitrClient.connect();

  const pitrRes = await pitrClient.query(`
    SELECT invoice_id, TRIM(invoice_ar_number) AS invoice_ar_number
    FROM invoicestbl
    WHERE invoice_ar_number IS NOT NULL
      AND TRIM(invoice_ar_number) <> ''
      AND invoice_ar_number ~ '^[0-9]{6}$'
    ORDER BY invoice_id
  `);
  await pitrClient.end();

  console.log(`PITR branch: ${pitrRes.rows.length} invoice(s) with 6-digit invoice_ar_number`);

  let rows = pitrRes.rows.map((r) => ({
    invoice_id: Number(r.invoice_id),
    invoice_ar_number: String(r.invoice_ar_number).trim(),
  }));

  if (onlyMissing) {
    const prodRes = await query(`
      SELECT invoice_id, invoice_ar_number
      FROM invoicestbl
      WHERE invoice_id = ANY($1::int[])
    `, [rows.map((r) => r.invoice_id)]);

    const prodById = new Map(prodRes.rows.map((r) => [Number(r.invoice_id), r]));
    const before = rows.length;
    rows = rows.filter((row) => {
      const cur = prodById.get(row.invoice_id);
      if (!cur) return false;
      const existing = String(cur.invoice_ar_number || '').trim();
      return !existing;
    });
    console.log(`Production missing AR# (restorable from PITR): ${rows.length} of ${before}`);
  }

  const payload = {
    exported_at: new Date().toISOString(),
    source: 'neon_pitr_branch',
    count: rows.length,
    rows,
  };

  fs.writeFileSync(absOut, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\nWrote ${rows.length} row(s) to ${absOut}`);
  console.log(
    `Restore: node backend/scripts/restoreInvoiceArNumbersFromBackup.js --file="${outPath}" --apply`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
