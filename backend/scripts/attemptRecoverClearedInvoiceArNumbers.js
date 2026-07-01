/**
 * Best-effort recovery of cleared invoice_ar_number without Neon PITR.
 * Sources (merged, deduped by invoice_id):
 *   1. Local files: --scan-dir paths, backend/scripts/.backups/*.txt|json
 *   2. Terminal / dry-run lines: INV-123 260456 ...
 *   3. DB: ack_receipt_id on invoice -> acknowledgement_receiptstbl.ack_receipt_number
 *   4. DB: payment on invoice shares payment_id with acknowledgement_receiptstbl
 *   5. DB: 6-digit AR in invoice.remarks or payment.remarks (AR:, AR #, etc.)
 *
 * Usage:
 *   node backend/scripts/attemptRecoverClearedInvoiceArNumbers.js
 *   node backend/scripts/attemptRecoverClearedInvoiceArNumbers.js --apply
 *   node backend/scripts/attemptRecoverClearedInvoiceArNumbers.js --export=backend/scripts/.backups/recovered-ar.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isApply = process.argv.includes('--apply');
const exportArg = process.argv.find((a) => a.startsWith('--export='));
const exportPath = exportArg ? exportArg.slice('--export='.length).trim() : '';
const scanDirs = process.argv
  .filter((a) => a.startsWith('--scan-dir='))
  .map((a) => a.slice('--scan-dir='.length).trim());

const AR_SIX = /^\d{6}$/;
const INV_LINE = /^INV-(\d+)\s+(\d{6})\b/i;

function parseDryRunText(raw) {
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.trim().match(INV_LINE);
    if (m) {
      out.push({
        invoice_id: Number(m[1]),
        invoice_ar_number: m[2],
        source: 'file',
      });
    }
    const parts = line.split('\t');
    if (parts.length >= 2 && /^INV-\d+$/i.test(parts[0])) {
      const ar = String(parts[1] || '').trim();
      if (AR_SIX.test(ar)) {
        out.push({
          invoice_id: Number(parts[0].replace(/^INV-/i, '')),
          invoice_ar_number: ar,
          source: 'file-tab',
        });
      }
    }
  }
  return out;
}

function parseJsonBackup(raw) {
  try {
    const data = JSON.parse(raw);
    const rows = Array.isArray(data) ? data : data?.rows || [];
    return rows
      .map((row) => ({
        invoice_id: Number(row.invoice_id ?? row.linked_invoice_id),
        invoice_ar_number: String(row.invoice_ar_number || '').trim(),
        source: 'json',
      }))
      .filter((r) => Number.isFinite(r.invoice_id) && AR_SIX.test(r.invoice_ar_number));
  } catch {
    return [];
  }
}

function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      walkFiles(full, acc);
    } else if (/\.(txt|json|log)$/i.test(ent.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function loadFromLocalFiles() {
  const defaultDirs = [
    path.join(__dirname, '.backups'),
    path.join(__dirname, '../../.cursor/projects'),
  ];
  const dirs = [...new Set([...scanDirs.map((d) => path.resolve(d)), ...defaultDirs])];
  const files = new Set();
  for (const dir of dirs) {
    for (const f of walkFiles(dir)) files.add(f);
  }
  files.add(path.join(__dirname, '.backups/ghost-ar-dry-run.txt'));

  const rows = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      if (file.toLowerCase().endsWith('.json')) {
        rows.push(...parseJsonBackup(raw).map((r) => ({ ...r, file })));
      } else {
        rows.push(...parseDryRunText(raw).map((r) => ({ ...r, file })));
      }
    } catch {
      /* skip unreadable */
    }
  }
  return rows;
}

function extractArFromText(text) {
  const s = String(text || '');
  const tagged = s.match(/(?:AR\s*#?|invoice_ar_number\s*[:=])\s*(\d{6})\b/i);
  if (tagged) return tagged[1];
  const isolated = s.match(/\b(2[0-9]{5})\b/);
  return isolated ? isolated[1] : null;
}

async function loadFromDatabase() {
  const rows = [];

  const ackReceiptId = await query(`
    SELECT i.invoice_id,
           TRIM(ar.ack_receipt_number) AS invoice_ar_number
    FROM invoicestbl i
    INNER JOIN acknowledgement_receiptstbl ar ON ar.ack_receipt_id = i.ack_receipt_id
    WHERE (i.invoice_ar_number IS NULL OR TRIM(i.invoice_ar_number) = '')
      AND TRIM(COALESCE(ar.ack_receipt_number, '')) ~ '^[0-9]{6}$'
  `);
  for (const r of ackReceiptId.rows) {
    rows.push({
      invoice_id: Number(r.invoice_id),
      invoice_ar_number: r.invoice_ar_number,
      source: 'db-ack_receipt_id',
    });
  }

  const sharedPayment = await query(`
    SELECT DISTINCT i.invoice_id,
           TRIM(ar.ack_receipt_number) AS invoice_ar_number
    FROM invoicestbl i
    INNER JOIN paymenttbl p ON p.invoice_id = i.invoice_id
      AND UPPER(TRIM(COALESCE(p.status, ''))) = 'COMPLETED'
    INNER JOIN acknowledgement_receiptstbl ar ON ar.payment_id = p.payment_id
    WHERE (i.invoice_ar_number IS NULL OR TRIM(i.invoice_ar_number) = '')
      AND TRIM(COALESCE(ar.ack_receipt_number, '')) ~ '^[0-9]{6}$'
  `);
  for (const r of sharedPayment.rows) {
    rows.push({
      invoice_id: Number(r.invoice_id),
      invoice_ar_number: r.invoice_ar_number,
      source: 'db-shared-payment',
    });
  }

  const remarks = await query(`
    SELECT i.invoice_id,
           i.remarks AS invoice_remarks,
           p.remarks AS payment_remarks
    FROM invoicestbl i
    LEFT JOIN LATERAL (
      SELECT remarks
      FROM paymenttbl
      WHERE invoice_id = i.invoice_id
        AND UPPER(TRIM(COALESCE(status, ''))) = 'COMPLETED'
      ORDER BY payment_id DESC
      LIMIT 1
    ) p ON TRUE
    WHERE (i.invoice_ar_number IS NULL OR TRIM(i.invoice_ar_number) = '')
  `);
  for (const r of remarks.rows) {
    const ar =
      extractArFromText(r.invoice_remarks) || extractArFromText(r.payment_remarks);
    if (ar && AR_SIX.test(ar)) {
      rows.push({
        invoice_id: Number(r.invoice_id),
        invoice_ar_number: ar,
        source: 'db-remarks',
      });
    }
  }

  return rows;
}

function mergeCandidates(allRows) {
  const byId = new Map();
  for (const row of allRows) {
    const id = Number(row.invoice_id);
    const ar = String(row.invoice_ar_number || '').trim();
    if (!Number.isFinite(id) || !AR_SIX.test(ar)) continue;
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, row);
      continue;
    }
    const priority = {
      file: 1,
      'file-tab': 1,
      json: 1,
      'db-ack_receipt_id': 3,
      'db-shared-payment': 3,
      'db-remarks': 2,
    };
    if ((priority[row.source] || 0) >= (priority[prev.source] || 0) && prev.invoice_ar_number !== ar) {
      row.conflict = `${prev.invoice_ar_number} vs ${ar}`;
    }
    if ((priority[row.source] || 0) > (priority[prev.source] || 0)) {
      byId.set(id, row);
    }
  }
  return [...byId.values()].sort((a, b) => a.invoice_id - b.invoice_id);
}

async function main() {
  console.log(
    isApply
      ? '=== APPLY: best-effort recover invoice_ar_number ==='
      : '=== DRY RUN: best-effort recover invoice_ar_number ==='
  );

  const fileRows = loadFromLocalFiles();
  console.log(`Local files: ${fileRows.length} mapping(s) parsed`);

  const dbRows = await loadFromDatabase();
  console.log(`Database heuristics: ${dbRows.length} mapping(s)`);

  const merged = mergeCandidates([...fileRows, ...dbRows]);
  console.log(`Merged unique candidates: ${merged.length}\n`);

  const bySource = {};
  for (const r of merged) bySource[r.source] = (bySource[r.source] || 0) + 1;
  console.log('By source:', bySource);

  if (merged.length === 0) {
    console.log('\nNo recoverable mappings found.');
    return;
  }

  const ids = merged.map((r) => r.invoice_id);
  const current = await query(
    `SELECT invoice_id, invoice_ar_number FROM invoicestbl WHERE invoice_id = ANY($1::int[])`,
    [ids]
  );
  const curMap = new Map(current.rows.map((r) => [Number(r.invoice_id), r]));

  const usedAr = await query(
    `SELECT invoice_id, invoice_ar_number FROM invoicestbl
     WHERE invoice_ar_number = ANY($1::text[])`,
    [[...new Set(merged.map((r) => r.invoice_ar_number))]]
  );
  const arTaken = new Map(
    usedAr.rows.map((r) => [String(r.invoice_ar_number).trim(), Number(r.invoice_id)])
  );

  let restorable = 0;
  let alreadySet = 0;
  let conflictDb = 0;
  let arNumberTaken = 0;
  let missingInvoice = 0;

  const toApply = [];
  for (const row of merged) {
    const cur = curMap.get(row.invoice_id);
    if (!cur) {
      missingInvoice += 1;
      continue;
    }
    const existing = String(cur.invoice_ar_number || '').trim();
    if (existing === row.invoice_ar_number) {
      alreadySet += 1;
      continue;
    }
    if (existing && existing !== row.invoice_ar_number) {
      conflictDb += 1;
      continue;
    }
    const holder = arTaken.get(row.invoice_ar_number);
    if (holder != null && holder !== row.invoice_id) {
      arNumberTaken += 1;
      continue;
    }
    restorable += 1;
    toApply.push(row);
  }

  console.log(`\nRestorable (NULL AR# now): ${restorable}`);
  console.log(`Already set (same AR#): ${alreadySet}`);
  console.log(`Invoice has different AR#: ${conflictDb}`);
  console.log(`AR# already used by another invoice: ${arNumberTaken}`);
  console.log(`Invoice not found: ${missingInvoice}`);

  if (toApply.length > 0) {
    console.log('\nSample (up to 15):');
    for (const row of toApply.slice(0, 15)) {
      console.log(`  INV-${row.invoice_id} -> ${row.invoice_ar_number} (${row.source})`);
    }
  }

  if (exportPath) {
    const abs = path.isAbsolute(exportPath)
      ? exportPath
      : path.resolve(process.cwd(), exportPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(
      abs,
      JSON.stringify({ exported_at: new Date().toISOString(), count: toApply.length, rows: toApply }, null, 2),
      'utf8'
    );
    console.log(`\nExported ${toApply.length} row(s) to ${abs}`);
  }

  if (!isApply) {
    console.log('\nDry run only. Re-run with --apply to write recovered AR numbers.');
    return;
  }

  if (toApply.length < 1) {
    console.log('\nNothing to apply.');
    return;
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    let updated = 0;
    for (const row of toApply) {
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
    console.log(`\nRecovered invoice_ar_number on ${updated} invoice(s).`);
    console.log(
      `Remaining cleared rows need Neon PITR or full dry-run backup (${881 - updated} approx. from original clear).`
    );
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
