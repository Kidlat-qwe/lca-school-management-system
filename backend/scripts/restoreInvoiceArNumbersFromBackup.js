/**
 * Restore invoicestbl.invoice_ar_number after findAndClearInvoiceOnlyArGhostRows --apply.
 *
 * Usage:
 *   node backend/scripts/restoreInvoiceArNumbersFromBackup.js --file=path/to/backup.json
 *   node backend/scripts/restoreInvoiceArNumbersFromBackup.js --file=path/to/dry-run-export.txt
 *
 * Backup JSON format (written automatically on future --apply runs):
 *   [{ "invoice_id": 898, "invoice_ar_number": "260558" }, ...]
 *
 * Dry-run export: tab-separated lines from findAndClearInvoiceOnlyArGhostRows.js
 *   INV-898\t260558\t...
 *
 * Flags:
 *   --dry-run   preview only (default)
 *   --apply     write invoice_ar_number back
 */

import fs from 'fs';
import path from 'path';
import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const isApply = process.argv.includes('--apply');
const fileArg = process.argv.find((a) => a.startsWith('--file='));
const filePath = fileArg ? fileArg.slice('--file='.length).trim() : '';

function parseBackupJson(raw) {
  const data = JSON.parse(raw);
  const rows = Array.isArray(data) ? data : data?.rows || [];
  return rows
    .map((row) => ({
      invoice_id: Number(row.invoice_id ?? row.linked_invoice_id),
      invoice_ar_number: String(row.invoice_ar_number || '').trim(),
    }))
    .filter((row) => Number.isFinite(row.invoice_id) && row.invoice_id > 0 && row.invoice_ar_number);
}

function parseDryRunExport(raw) {
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('===') || trimmed.startsWith('Filters:')) continue;
    if (trimmed.startsWith('INVOICE\t') || trimmed.startsWith('Dry run') || trimmed.startsWith('Total line')) continue;
    if (trimmed.startsWith('Cleared ') || trimmed.startsWith('These rows')) continue;
    if (trimmed.startsWith('🔧') || trimmed.startsWith('📊') || trimmed.startsWith('✅')) continue;
    if (trimmed.startsWith('Executed query') || trimmed.startsWith('text:')) continue;

    const invMatch = trimmed.match(/^INV-(\d+)\s+(\d{6})\s+/i);
    if (invMatch) {
      out.push({
        invoice_id: Number(invMatch[1]),
        invoice_ar_number: invMatch[2],
      });
      continue;
    }

    const parts = trimmed.split('\t');
    if (parts.length >= 2 && /^INV-\d+$/i.test(parts[0])) {
      const ar = String(parts[1] || '').trim();
      if (/^\d{6}$/.test(ar)) {
        out.push({
          invoice_id: Number(parts[0].replace(/^INV-/i, '')),
          invoice_ar_number: ar,
        });
      }
    }
  }
  return out;
}

function dedupeRows(rows) {
  const map = new Map();
  for (const row of rows) {
    map.set(row.invoice_id, row.invoice_ar_number);
  }
  return [...map.entries()].map(([invoice_id, invoice_ar_number]) => ({
    invoice_id,
    invoice_ar_number,
  }));
}

async function main() {
  if (!filePath) {
    console.error('Provide --file=path/to/backup.json or dry-run export .txt');
    process.exit(1);
  }

  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(abs)) {
    console.error(`File not found: ${abs}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(abs, 'utf8');
  let rows = [];
  if (abs.toLowerCase().endsWith('.json')) {
    rows = parseBackupJson(raw);
  } else {
    rows = parseDryRunExport(raw);
  }
  rows = dedupeRows(rows);

  console.log(isApply ? '=== APPLY: restore invoice_ar_number ===' : '=== DRY RUN: restore invoice_ar_number ===');
  console.log(`Source: ${abs}`);
  console.log(`Parsed ${rows.length} invoice AR mapping(s).\n`);

  if (rows.length === 0) {
    console.log('No rows parsed. Check file format.');
    process.exit(1);
  }

  const client = await getClient();
  try {
    const ids = rows.map((r) => r.invoice_id);
    const current = await client.query(
      `SELECT invoice_id,
              invoice_ar_number,
              status
       FROM invoicestbl
       WHERE invoice_id = ANY($1::int[])
       ORDER BY invoice_id`,
      [ids]
    );
    const byId = new Map(current.rows.map((r) => [Number(r.invoice_id), r]));

    let restorable = 0;
    let skippedHasAr = 0;
    let skippedMissingInvoice = 0;
    let conflict = 0;

    for (const row of rows) {
      const cur = byId.get(row.invoice_id);
      if (!cur) {
        skippedMissingInvoice += 1;
        continue;
      }
      const existing = String(cur.invoice_ar_number || '').trim();
      if (existing && existing !== row.invoice_ar_number) {
        conflict += 1;
        console.warn(
          `CONFLICT INV-${row.invoice_id}: DB has ${existing}, backup has ${row.invoice_ar_number} — skipped`
        );
        continue;
      }
      if (existing === row.invoice_ar_number) {
        skippedHasAr += 1;
        continue;
      }
      restorable += 1;
    }

    console.log(`Restorable: ${restorable}`);
    console.log(`Already set (same AR#): ${skippedHasAr}`);
    console.log(`Invoice not found: ${skippedMissingInvoice}`);
    console.log(`Conflict (different AR# already set): ${conflict}`);

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to restore.');
      return;
    }

    if (restorable < 1) {
      console.log('\nNothing to restore.');
      return;
    }

    await client.query('BEGIN');
    let updated = 0;
    for (const row of rows) {
      const cur = byId.get(row.invoice_id);
      if (!cur) continue;
      const existing = String(cur.invoice_ar_number || '').trim();
      if (existing && existing !== row.invoice_ar_number) continue;
      if (existing === row.invoice_ar_number) continue;

      const res = await client.query(
        `UPDATE invoicestbl
         SET invoice_ar_number = $1
         WHERE invoice_id = $2
           AND (invoice_ar_number IS NULL OR TRIM(invoice_ar_number) = '')`,
        [row.invoice_ar_number, row.invoice_id]
      );
      updated += res.rowCount || 0;
    }
    await client.query('COMMIT');
    console.log(`\nRestored invoice_ar_number on ${updated} invoice(s).`);
    console.log('Ghost "Invoice payment (no AR record)" rows may reappear on the AR page when searching.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
